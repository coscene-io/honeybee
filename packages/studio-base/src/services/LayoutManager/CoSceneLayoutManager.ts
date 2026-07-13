// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import * as _ from "lodash-es";
import { v4 as uuidv4 } from "uuid";

import { MutexLocked } from "@foxglove/den/async";
import Logger from "@foxglove/log";
import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import {
  ILayoutManager,
  LayoutManagerChangeEvent,
  LayoutManagerEventTypes,
} from "@foxglove/studio-base/services/CoSceneILayoutManager";
import {
  ILayoutStorage,
  ISO8601Timestamp,
  Layout,
  layoutAppearsDeleted,
  layoutIsProject,
  LayoutPermission,
  layoutPermissionIsProject,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";
import { replaceNullWithUndefined } from "@foxglove/studio-base/util/coscene";

import { NamespacedLayoutStorage } from "./CoSceneNamespacedLayoutStorage";
import WriteThroughLayoutCache from "./CoSceneWriteThroughLayoutCache";
import computeLayoutSyncOperations, { SyncOperation } from "./coSceneComputeLayoutSyncOperations";
import { isLayoutEqual } from "./compareLayouts";
import { migratePanelsState } from "../migrateLayout";

const log = Logger.getLogger(__filename);

class RemoteLayoutConflictError extends Error {
  public readonly layoutId: LayoutID;

  public constructor(layoutId: LayoutID) {
    super(`Layout ${layoutId} has changed on the server; local changes were not saved.`);
    this.name = "RemoteLayoutConflictError";
    this.layoutId = layoutId;
  }
}

function remoteConflictError(id: LayoutID): RemoteLayoutConflictError {
  return new RemoteLayoutConflictError(id);
}

function expectedRemoteTimestamps(layout: Layout): {
  expectedSavedAt?: ISO8601Timestamp | undefined;
  expectedUpdatedAt?: ISO8601Timestamp | undefined;
} {
  // Backend writes are not atomic compare-and-set; these timestamps are only a best-effort hint.
  return layout.syncInfo
    ? {
        expectedSavedAt: layout.syncInfo.lastRemoteSavedAt,
        expectedUpdatedAt: layout.syncInfo.lastRemoteUpdatedAt,
      }
    : {};
}

function localLayoutSyncSnapshotMatches(currentLayout: Layout, operationLayout: Layout): boolean {
  return (
    currentLayout.syncInfo?.status === operationLayout.syncInfo?.status &&
    currentLayout.syncInfo?.lastRemoteSavedAt === operationLayout.syncInfo?.lastRemoteSavedAt &&
    currentLayout.syncInfo?.lastRemoteUpdatedAt === operationLayout.syncInfo?.lastRemoteUpdatedAt &&
    currentLayout.name === operationLayout.name &&
    currentLayout.folder === operationLayout.folder &&
    isLayoutEqual(currentLayout.baseline.data, operationLayout.baseline.data)
  );
}

function workingDataEqual(left: Layout["working"], right: Layout["working"]): boolean {
  if (left == undefined || right == undefined) {
    return left === right;
  }
  return isLayoutEqual(left.data, right.data);
}

async function updateRemoteLayout(
  remote: IRemoteLayoutStorage,
  params: Parameters<IRemoteLayoutStorage["updateLayout"]>[0],
): Promise<RemoteLayout> {
  const response = await remote.updateLayout(params);

  switch (response.status) {
    case "success":
      return response.newLayout;
    case "conflict":
      throw remoteConflictError(params.id);
  }
}

export default class CoSceneLayoutManager implements ILayoutManager {
  public static readonly LOCAL_STORAGE_NAMESPACE = "local";
  public static readonly REMOTE_STORAGE_NAMESPACE_PREFIX = "remote-";

  /**
   * All access to storage is wrapped in a mutex to prevent multi-step operations (such as reading
   * and then writing a single layout, or writing one and deleting another) from getting
   * interleaved.
   */
  #local: MutexLocked<NamespacedLayoutStorage>;

  // backup remote layouts to local, when user is offline
  #backupLocal: MutexLocked<NamespacedLayoutStorage> | undefined;

  #remote: IRemoteLayoutStorage | undefined;

  public readonly supportsSharing: boolean;

  #emitter = new EventEmitter<LayoutManagerEventTypes>();

  #busyCount = 0;

  #pendingOverwriteEditRevisions = new Map<LayoutID, Map<number, number>>();
  #savedEditRevisions = new Map<LayoutID, number>();

  #trackPendingOverwrite(id: LayoutID, editRevision: number | undefined): () => void {
    if (editRevision == undefined) {
      return () => {};
    }
    const revisions = this.#pendingOverwriteEditRevisions.get(id) ?? new Map<number, number>();
    revisions.set(editRevision, (revisions.get(editRevision) ?? 0) + 1);
    this.#pendingOverwriteEditRevisions.set(id, revisions);
    return () => {
      const count = revisions.get(editRevision) ?? 0;
      if (count <= 1) {
        revisions.delete(editRevision);
      } else {
        revisions.set(editRevision, count - 1);
      }
      if (revisions.size === 0) {
        this.#pendingOverwriteEditRevisions.delete(id);
      }
    };
  }

  #editWasSuperseded(id: LayoutID, editRevision: number | undefined): boolean {
    if (editRevision == undefined) {
      return false;
    }
    const savedRevision = this.#savedEditRevisions.get(id);
    if (savedRevision != undefined && savedRevision >= editRevision) {
      return true;
    }
    const pendingRevisions = this.#pendingOverwriteEditRevisions.get(id);
    if (pendingRevisions) {
      for (const pendingRevision of pendingRevisions.keys()) {
        if (pendingRevision > editRevision) {
          return true;
        }
      }
    }
    return false;
  }

  #recordSavedEditRevision(id: LayoutID, editRevision: number | undefined): void {
    if (editRevision == undefined) {
      return;
    }
    this.#savedEditRevisions.set(
      id,
      Math.max(editRevision, this.#savedEditRevisions.get(id) ?? editRevision),
    );
  }

  async #runWithBusyStatus<Ret>(body: () => Promise<Ret>): Promise<Ret> {
    try {
      this.#busyCount++;
      this.#emitter.emit("busychange");
      return await body();
    } finally {
      this.#busyCount--;
      this.#emitter.emit("busychange");
    }
  }

  // eslint-disable-next-line no-restricted-syntax
  public get isBusy(): boolean {
    return this.#busyCount > 0;
  }

  public isOnline = false;

  public error: undefined | Error = undefined;

  public projectName: string | undefined;
  public userName: string | undefined;
  #currentUser: User | undefined;

  // eslint-disable-next-line @foxglove/no-boolean-parameters
  public setOnline(online: boolean): void {
    this.isOnline = online;
    this.#emitter.emit("onlinechange");
  }

  public setError(error: undefined | Error): void {
    this.error = error;
    this.#emitter.emit("errorchange");
  }

  public constructor({
    local,
    remote,
    currentUser,
  }: {
    local: ILayoutStorage;
    remote: IRemoteLayoutStorage | undefined;
    currentUser: User | undefined;
  }) {
    this.#remote = remote;
    this.supportsSharing = remote != undefined;
    this.projectName = remote?.projectName;
    this.userName = remote?.userName;
    this.#currentUser = currentUser;

    const parents: string[] = [];
    if (this.userName) {
      parents.push(this.userName);
    }

    if (this.projectName) {
      parents.push(this.projectName);
    }

    if (parents.length === 0 && remote == undefined) {
      parents.push("");
    }

    this.#local = new MutexLocked(
      new NamespacedLayoutStorage(
        new WriteThroughLayoutCache(local),
        remote
          ? CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX + remote.namespace
          : CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
        parents,
        {
          migrateUnnamespacedLayouts: true,

          // Convert existing local layouts into cloud personal layouts
          importFromNamespace: remote ? CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE : undefined,
        },
      ),
    );

    if (remote) {
      this.#backupLocal = new MutexLocked(
        new NamespacedLayoutStorage(
          new WriteThroughLayoutCache(local),
          CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
          parents,
          {
            migrateUnnamespacedLayouts: true,

            // Convert existing local layouts into cloud personal layouts
            importFromNamespace: CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
          },
        ),
      );
    }
  }

  public on<E extends EventEmitter.EventNames<LayoutManagerEventTypes>>(
    name: E,
    listener: EventEmitter.EventListener<LayoutManagerEventTypes, E>,
  ): void {
    this.#emitter.on(name, listener);
  }
  public off<E extends EventEmitter.EventNames<LayoutManagerEventTypes>>(
    name: E,
    listener: EventEmitter.EventListener<LayoutManagerEventTypes, E>,
  ): void {
    this.#emitter.off(name, listener);
  }

  #notifyChangeListeners(event: LayoutManagerChangeEvent) {
    queueMicrotask(() => this.#emitter.emit("change", event));
  }

  public async getLayouts(): Promise<readonly Layout[]> {
    return await this.#local.runExclusive(async (local) => {
      const layouts = await local.list();
      return layouts.filter((layout) => !layoutAppearsDeleted(layout));
    });
  }

  public async getLayout({ id }: { id: LayoutID }): Promise<Layout | undefined> {
    const existingLocal = await this.#local.runExclusive(async (local) => {
      return await local.get(id);
    });

    if (existingLocal) {
      if (layoutAppearsDeleted(existingLocal)) {
        return undefined;
      }

      try {
        existingLocal.baseline.data = replaceNullWithUndefined(
          existingLocal.baseline.data,
        ) as LayoutData;
      } catch (err) {
        throw new Error(`Invalid layout baseline data for ${existingLocal.id}: ${err}`);
      }

      if (existingLocal.working?.data) {
        try {
          existingLocal.working.data = replaceNullWithUndefined(
            existingLocal.working.data,
          ) as LayoutData;
        } catch (err) {
          throw new Error(`Invalid layout working data for ${existingLocal.id}: ${err}`);
        }
      }

      return existingLocal;
    }

    log.debug(`No local layout id:${id}.`);

    // If we are offline, there's nothing else we can do to load the layout
    if (!this.isOnline) {
      log.debug("CoSceneLayoutManager offline");
      return undefined;
    }

    log.debug(`Attempting to fetch from remote id:${id}`);
    // We couldn't find an existing local layout for our id, so we attempt to load the remote one
    const remoteLayout = await this.#remote?.getLayout(id);

    if (!remoteLayout) {
      log.debug(`No remote layout with id:${id}`);
      return undefined;
    }

    return await this.#local.runExclusive(async (local) => {
      // Layout sync may have happened while we fetched the remote layout.
      // We see if we have the layout locally and use that before caching the fetched remote layout.
      const localLayout = await local.get(id);
      if (localLayout) {
        log.debug(`Local layout loaded while fetching remote id:${id}`);
        return localLayout;
      }

      log.debug(`Adding layout to cache from getLayout: ${remoteLayout.id}`);
      return await local.put({
        id: remoteLayout.id,
        parent: remoteLayout.parent,
        folder: remoteLayout.folder,
        name: remoteLayout.name,
        permission: remoteLayout.permission,
        baseline: {
          data: remoteLayout.data,
          savedAt: remoteLayout.savedAt,
          modifier: remoteLayout.modifier,
          modifierNickname: remoteLayout.modifierNickname,
        },
        working: undefined,
        syncInfo: {
          status: "tracked",
          lastRemoteSavedAt: remoteLayout.savedAt,
          lastRemoteUpdatedAt: remoteLayout.updatedAt,
        },
      });
    });
  }

  public async saveNewLayout({
    folder,
    name,
    data: unmigratedData,
    permission,
  }: {
    folder: string;
    name: string;
    data: LayoutData;
    permission: LayoutPermission;
  }): Promise<Layout> {
    return await this.#runWithBusyStatus(async () => {
      const parent =
        permission === "PERSONAL_WRITE" ? (this.userName ?? "") : (this.projectName ?? "");

      const data = migratePanelsState(unmigratedData);
      if (layoutPermissionIsProject(permission)) {
        if (!this.#remote) {
          throw new Error("Shared layouts are not supported without remote layout storage");
        }
        if (!this.isOnline) {
          throw new Error("Cannot share a layout while offline");
        }

        const newLayout = await this.#remote.saveNewLayout({
          id: `${parent}/layouts/${uuidv4()}` as LayoutID,
          parent,
          folder,
          name,
          data,
          permission,
        });

        const result = await this.#local.runExclusive(
          async (local) =>
            await local.put({
              id: newLayout.id,
              parent: newLayout.parent,
              folder: newLayout.folder,
              name: newLayout.name,
              permission: newLayout.permission,
              baseline: {
                data: newLayout.data,
                savedAt: newLayout.savedAt,
                modifier: newLayout.modifier,
                modifierNickname: newLayout.modifierNickname,
              },
              working: undefined,
              syncInfo: {
                status: "tracked",
                lastRemoteSavedAt: newLayout.savedAt,
                lastRemoteUpdatedAt: newLayout.updatedAt,
              },
            }),
        );
        this.#notifyChangeListeners({ type: "change", updatedLayout: undefined });
        return result;
      }

      const newLayout = await this.#local.runExclusive(
        async (local) =>
          await local.put({
            id: `${parent}/layouts/${uuidv4()}` as LayoutID,
            parent,
            folder,
            name,
            permission,
            baseline: {
              data,
              savedAt: new Date().toISOString() as ISO8601Timestamp,
              modifier: this.#currentUser?.userId ? `users/${this.#currentUser.userId}` : undefined,
              modifierNickname: this.#currentUser?.nickName,
            },
            working: undefined,
            syncInfo: this.#remote
              ? {
                  status: "new",
                  lastRemoteSavedAt: undefined,
                  lastRemoteUpdatedAt: undefined,
                }
              : undefined,
          }),
      );
      this.#notifyChangeListeners({ type: "change", updatedLayout: newLayout });
      return newLayout;
    });
  }

  public async updateLayout({
    id,
    name,
    folder,
    data: unmigratedData,
    editRevision,
  }: {
    id: LayoutID;
    name?: string | undefined;
    folder?: string | undefined;
    data?: LayoutData | undefined;
    editRevision?: number | undefined;
  }): Promise<Layout | undefined> {
    return await this.#runWithBusyStatus(async () => {
      const now = new Date().toISOString() as ISO8601Timestamp;
      const data = unmigratedData == undefined ? undefined : migratePanelsState(unmigratedData);

      const snapshot = await this.#local.runExclusive(async (local) => {
        const localLayout = await local.get(id);
        if (!localLayout) {
          // if this layout is record recommended layout, this error is expected
          // because the layout will be deleted when the user plays another record
          return undefined;
        }
        if (this.#editWasSuperseded(id, editRevision)) {
          return { type: "superseded" as const, layout: localLayout };
        }

        // If the modifications result in the same layout data, set the working copy to undefined so
        // the layout appears unmodified.
        const newWorking =
          data == undefined
            ? localLayout.working
            : isLayoutEqual(localLayout.baseline.data, data)
              ? undefined
              : { data, savedAt: now };
        const nameChanged = name != undefined && name !== localLayout.name;
        const folderChanged = folder != undefined && folder !== localLayout.folder;
        const metadataChanged = nameChanged || folderChanged;

        // Renames of shared layouts go directly to the server.
        if (metadataChanged && layoutIsProject(localLayout)) {
          return { type: "project-metadata" as const, localLayout, newWorking };
        }

        const isUpdateSavedAt =
          this.#remote != undefined &&
          metadataChanged &&
          localLayout.syncInfo != undefined &&
          localLayout.syncInfo.status !== "new";

        const updatedLayout = await local.put({
          ...localLayout,
          name: name ?? localLayout.name,
          folder: folder ?? localLayout.folder,
          working: newWorking,

          // If the name is being changed, we will need to upload to the server with a new savedAt
          baseline: isUpdateSavedAt
            ? {
                ...localLayout.baseline,
                savedAt: now,
                modifier: localLayout.baseline.modifier,
                modifierNickname: localLayout.baseline.modifierNickname,
              }
            : localLayout.baseline,
          syncInfo: isUpdateSavedAt
            ? {
                status: "updated",
                lastRemoteSavedAt: localLayout.syncInfo?.lastRemoteSavedAt,
                lastRemoteUpdatedAt: localLayout.syncInfo?.lastRemoteUpdatedAt,
              }
            : localLayout.syncInfo,
        });

        return { type: "local" as const, layout: updatedLayout };
      });

      if (!snapshot) {
        return undefined;
      }

      if (snapshot.type === "superseded") {
        return snapshot.layout;
      }

      if (snapshot.type === "local") {
        this.#notifyChangeListeners({
          type: "change",
          updatedLayout: snapshot.layout,
          source: "update",
        });
        return snapshot.layout;
      }

      const remote = this.#remote;
      if (!remote) {
        throw new Error("Shared layouts are not supported without remote layout storage");
      }
      if (!this.isOnline) {
        throw new Error("Cannot update a shared layout while offline");
      }

      const updatedBaseline = await updateRemoteLayout(remote, {
        id,
        name,
        folder,
        parent: snapshot.localLayout.parent,
        ...expectedRemoteTimestamps(snapshot.localLayout),
      });

      const result = await this.#local.runExclusive(async (local) => {
        const latestLayout = await local.get(id);
        if (!latestLayout) {
          throw new Error(`Cannot update layout ${id} because it does not exist`);
        }
        if (!localLayoutSyncSnapshotMatches(latestLayout, snapshot.localLayout)) {
          return latestLayout;
        }

        const working = workingDataEqual(latestLayout.working, snapshot.localLayout.working)
          ? snapshot.newWorking
          : latestLayout.working;
        return await local.put({
          ...latestLayout,
          parent: updatedBaseline.parent,
          name: updatedBaseline.name,
          folder: updatedBaseline.folder,
          baseline: {
            data: updatedBaseline.data,
            savedAt: updatedBaseline.savedAt,
            modifier: updatedBaseline.modifier,
            modifierNickname: updatedBaseline.modifierNickname,
          },
          working,
          syncInfo: {
            status: "tracked",
            lastRemoteSavedAt: updatedBaseline.savedAt,
            lastRemoteUpdatedAt: updatedBaseline.updatedAt,
          },
        });
      });

      this.#notifyChangeListeners({ type: "change", updatedLayout: result, source: "update" });
      return result;
    });
  }

  public async deleteLayout({ id }: { id: LayoutID }): Promise<void> {
    await this.#runWithBusyStatus(async () => {
      const snapshot = await this.#local.runExclusive(async (local) => await local.get(id));
      if (!snapshot) {
        throw new Error(`Cannot update layout ${id} because it does not exist`);
      }

      const shouldDeleteRemote =
        layoutIsProject(snapshot) && snapshot.syncInfo?.status !== "remotely-deleted";
      if (shouldDeleteRemote) {
        const remote = this.#remote;
        if (!remote) {
          throw new Error("Shared layouts are not supported without remote layout storage");
        }
        if (!this.isOnline) {
          throw new Error("Cannot delete a shared layout while offline");
        }
        if (!(await remote.deleteLayout(id, expectedRemoteTimestamps(snapshot)))) {
          log.debug(`Deleting shared layout ${id} which was already absent in remote storage`);
        }
      }

      const didDelete = await this.#local.runExclusive(async (local) => {
        const currentLayout = await local.get(id);
        if (!currentLayout) {
          return false;
        }

        if (
          shouldDeleteRemote &&
          (!localLayoutSyncSnapshotMatches(currentLayout, snapshot) ||
            !workingDataEqual(currentLayout.working, snapshot.working))
        ) {
          return false;
        }

        if (this.#remote && !layoutIsProject(currentLayout)) {
          await local.put({
            ...currentLayout,
            working: {
              data: currentLayout.working?.data ?? currentLayout.baseline.data,
              savedAt: new Date().toISOString() as ISO8601Timestamp,
            },
            syncInfo: {
              status: "locally-deleted",
              lastRemoteSavedAt: currentLayout.syncInfo?.lastRemoteSavedAt,
              lastRemoteUpdatedAt: currentLayout.syncInfo?.lastRemoteUpdatedAt,
            },
          });
        } else {
          await local.delete(id);
        }
        return true;
      });

      if (didDelete) {
        this.#notifyChangeListeners({ type: "delete", layoutId: id });
      }
    });
  }

  public async overwriteLayout({
    id,
    data: unmigratedData,
    editRevision,
  }: {
    id: LayoutID;
    data?: LayoutData;
    editRevision?: number;
  }): Promise<Layout> {
    const finishPendingOverwrite = this.#trackPendingOverwrite(id, editRevision);
    const overwritePromise = this.#runWithBusyStatus(async () => {
      const now = new Date().toISOString() as ISO8601Timestamp;
      const data = unmigratedData == undefined ? undefined : migratePanelsState(unmigratedData);

      const snapshot = await this.#local.runExclusive(async (local) => {
        const localLayout = await local.get(id);
        if (!localLayout) {
          throw new Error(`Cannot overwrite layout ${id} because it does not exist`);
        }

        const dataToSave = data ?? localLayout.working?.data ?? localLayout.baseline.data;

        if (layoutIsProject(localLayout)) {
          if (!this.#remote) {
            throw new Error("Shared layouts are not supported without remote layout storage");
          }
          if (!this.isOnline) {
            throw new Error("Cannot save a shared layout while offline");
          }

          const layoutForSave = await local.put({
            ...localLayout,
            working: isLayoutEqual(localLayout.baseline.data, dataToSave)
              ? undefined
              : { data: dataToSave, savedAt: now },
          });
          this.#recordSavedEditRevision(id, editRevision);

          return { type: "project" as const, dataToSave, layoutForSave };
        }

        const latestLayout = await local.get(id);
        if (!latestLayout) {
          throw new Error(`Cannot overwrite layout ${id} because it does not exist`);
        }
        const layout = await local.put({
          ...latestLayout,
          baseline: {
            data: dataToSave,
            savedAt: now,
            modifier: latestLayout.baseline.modifier,
            modifierNickname: latestLayout.baseline.modifierNickname,
          },
          working: undefined,
          syncInfo:
            this.#remote && latestLayout.syncInfo?.status !== "new"
              ? {
                  status: "updated",
                  lastRemoteSavedAt: latestLayout.syncInfo?.lastRemoteSavedAt,
                  lastRemoteUpdatedAt: latestLayout.syncInfo?.lastRemoteUpdatedAt,
                }
              : latestLayout.syncInfo,
        });
        this.#recordSavedEditRevision(id, editRevision);

        return { type: "local" as const, layout };
      });

      if (snapshot.type === "local") {
        this.#notifyChangeListeners({
          type: "change",
          updatedLayout: snapshot.layout,
          source: "overwrite",
        });
        return snapshot.layout;
      }

      const remote = this.#remote;
      if (!remote) {
        throw new Error("Shared layouts are not supported without remote layout storage");
      }
      if (!this.isOnline) {
        throw new Error("Cannot save a shared layout while offline");
      }

      const updatedBaseline = await updateRemoteLayout(remote, {
        id,
        parent: snapshot.layoutForSave.parent,
        data: snapshot.dataToSave,
        ...expectedRemoteTimestamps(snapshot.layoutForSave),
      });
      this.#recordSavedEditRevision(id, editRevision);

      const result = await this.#local.runExclusive(async (local) => {
        const latestLayout = await local.get(id);
        if (!latestLayout) {
          throw new Error(`Cannot overwrite layout ${id} because it does not exist`);
        }
        if (!localLayoutSyncSnapshotMatches(latestLayout, snapshot.layoutForSave)) {
          return latestLayout;
        }

        const working =
          latestLayout.working == undefined ||
          isLayoutEqual(latestLayout.working.data, snapshot.dataToSave)
            ? undefined
            : latestLayout.working;
        return await local.put({
          ...latestLayout,
          baseline: {
            data: updatedBaseline.data,
            savedAt: updatedBaseline.savedAt,
            modifier: updatedBaseline.modifier,
            modifierNickname: updatedBaseline.modifierNickname,
          },
          working,
          syncInfo: {
            status: "tracked",
            lastRemoteSavedAt: updatedBaseline.savedAt,
            lastRemoteUpdatedAt: updatedBaseline.updatedAt,
          },
        });
      });

      this.#notifyChangeListeners({ type: "change", updatedLayout: result, source: "overwrite" });
      return result;
    });
    return await overwritePromise.finally(finishPendingOverwrite);
  }

  public async revertLayout({
    id,
    editRevision,
  }: {
    id: LayoutID;
    editRevision?: number;
  }): Promise<Layout> {
    return await this.#runWithBusyStatus(async () => {
      const result = await this.#local.runExclusive(async (local) => {
        const layout = await local.get(id);
        if (!layout) {
          throw new Error(`Cannot revert layout id ${id} because it does not exist`);
        }
        const revertedLayout = await local.put({
          ...layout,
          working: undefined,
        });
        this.#recordSavedEditRevision(id, editRevision);
        if (layoutAppearsDeleted(revertedLayout)) {
          await local.delete(id);
          return { layout: revertedLayout, deleted: true };
        }
        return { layout: revertedLayout, deleted: false };
      });
      if (result.deleted) {
        this.#notifyChangeListeners({ type: "delete", layoutId: id });
      } else {
        this.#notifyChangeListeners({
          type: "change",
          updatedLayout: result.layout,
          source: "revert",
        });
      }
      return result.layout;
    });
  }

  public async makePersonalCopy({ id, name }: { id: LayoutID; name: string }): Promise<Layout> {
    return await this.#runWithBusyStatus(async () => {
      const now = new Date().toISOString() as ISO8601Timestamp;

      const result = await this.#local.runExclusive(async (local) => {
        const layout = await local.get(id);
        if (!layout) {
          throw new Error(
            `Cannot make a personal copy of layout id ${id} because it does not exist`,
          );
        }

        const parent = this.userName ?? "";
        const newLayout = await local.put({
          id: `${parent}/layouts/${uuidv4()}` as LayoutID,
          parent,
          folder: layout.folder,
          name,
          permission: "PERSONAL_WRITE",
          baseline: {
            data: layout.working?.data ?? layout.baseline.data,
            savedAt: now,
            modifier: layout.baseline.modifier,
            modifierNickname: layout.baseline.modifierNickname,
          },
          working: undefined,
          syncInfo: { status: "new", lastRemoteSavedAt: now, lastRemoteUpdatedAt: now },
        });
        await local.put({ ...layout, working: undefined });
        return newLayout;
      });
      this.#notifyChangeListeners({ type: "change", updatedLayout: undefined });
      return result;
    });
  }

  /** Ensures at most one sync operation is in progress at a time */
  #currentSync?: Promise<void>;

  /**
   * Attempt to synchronize the local cache with remote storage. At minimum this incurs a fetch of
   * the cached and remote layout lists; it may also involve modifications to the cache, remote
   * storage, or both.
   */
  public async syncWithRemote(abortSignal: AbortSignal): Promise<void> {
    await this.#runWithBusyStatus(async () => {
      if (this.#currentSync) {
        log.debug("Layout sync is already in progress");
        await this.#currentSync;
        return;
      }
      const start = performance.now();
      try {
        log.debug("Starting layout sync");
        this.#currentSync = this.#syncWithRemoteImpl(abortSignal);
        await this.#currentSync;
        this.#notifyChangeListeners({ type: "change", updatedLayout: undefined });
        if (this.error) {
          this.setError(undefined);
        }
      } catch (error) {
        this.setError(error);
        throw error;
      } finally {
        this.#currentSync = undefined;
        log.debug(`Completed sync in ${((performance.now() - start) / 1000).toFixed(2)}s`);
      }
    });
  }

  async #syncWithRemoteImpl(abortSignal: AbortSignal): Promise<void> {
    if (!this.#remote || !this.isOnline) {
      return;
    }

    const [localLayouts, remoteLayouts] = await Promise.all([
      this.#local.runExclusive(async (local) => await local.list()),
      this.#remote.getLayouts(),
    ]);
    if (abortSignal.aborted) {
      return;
    }

    const syncOperations = computeLayoutSyncOperations(localLayouts, remoteLayouts);
    const [localOps, remoteOps] = _.partition(
      syncOperations,
      (op): op is typeof op & { local: true } => op.local,
    );
    await Promise.all([
      this.#performLocalSyncOperations(localOps, abortSignal),
      this.#performRemoteSyncOperations(remoteOps, abortSignal),
      this.#performBackupLocalSyncOperations(localOps, abortSignal),
    ]);
  }

  async #performLocalSyncOperations(
    operations: readonly (SyncOperation & { local: true })[],
    abortSignal: AbortSignal,
  ): Promise<void> {
    await this.#performLocalSyncOperationsInStorage(this.#local, operations, abortSignal);
  }

  async #performLocalSyncOperationsInStorage(
    storage: MutexLocked<NamespacedLayoutStorage>,
    operations: readonly (SyncOperation & { local: true })[],
    abortSignal: AbortSignal,
    options: { backupPersonalOnly?: boolean; emitDeleteNotifications?: boolean } = {},
  ): Promise<void> {
    await storage.runExclusive(async (local) => {
      for (const operation of operations) {
        if (abortSignal.aborted) {
          return;
        }
        switch (operation.type) {
          case "mark-deleted": {
            const localLayout = await local.get(operation.localLayout.id);
            if (!localLayout) {
              break;
            }
            if (!localLayoutSyncSnapshotMatches(localLayout, operation.localLayout)) {
              break;
            }
            log.debug(`Marking layout as remotely deleted: ${localLayout.id}`);
            await local.put({
              ...localLayout,
              syncInfo: {
                status: "remotely-deleted",
                lastRemoteSavedAt: undefined,
                lastRemoteUpdatedAt: undefined,
              },
            });
            break;
          }

          case "delete-local": {
            const localLayout = await local.get(operation.localLayout.id);
            if (!localLayout) {
              break;
            }
            if (
              (options.backupPersonalOnly !== true &&
                !localLayoutSyncSnapshotMatches(localLayout, operation.localLayout)) ||
              localLayout.syncInfo?.status === "updated"
            ) {
              break;
            }
            if (
              localLayout.working != undefined &&
              localLayout.syncInfo?.status !== "locally-deleted"
            ) {
              await local.put({
                ...localLayout,
                syncInfo: {
                  status: "remotely-deleted",
                  lastRemoteSavedAt: undefined,
                  lastRemoteUpdatedAt: undefined,
                },
              });
              break;
            }
            log.debug(
              `Deleting local layout ${localLayout.id}, whose sync status was ${localLayout.syncInfo?.status}`,
            );
            await local.delete(localLayout.id);
            if (options.emitDeleteNotifications !== false) {
              this.#notifyChangeListeners({ type: "delete", layoutId: localLayout.id });
            }
            break;
          }

          case "add-to-cache": {
            const { remoteLayout } = operation;
            if (
              options.backupPersonalOnly === true &&
              remoteLayout.permission !== "PERSONAL_WRITE"
            ) {
              break;
            }
            const existingLayout = await local.get(remoteLayout.id);
            if (existingLayout != undefined && options.backupPersonalOnly !== true) {
              break;
            }
            log.debug(`Adding layout to cache: ${remoteLayout.id}`);
            await local.put({
              id: remoteLayout.id,
              folder: remoteLayout.folder,
              name: remoteLayout.name,
              permission: remoteLayout.permission,
              baseline: {
                data: remoteLayout.data,
                savedAt: remoteLayout.savedAt,
                modifier: remoteLayout.modifier,
                modifierNickname: remoteLayout.modifierNickname,
              },
              working: undefined,
              syncInfo: {
                status: "tracked",
                lastRemoteSavedAt: remoteLayout.savedAt,
                lastRemoteUpdatedAt: remoteLayout.updatedAt,
              },
              parent: remoteLayout.parent,
            });
            break;
          }

          case "update-baseline": {
            const { remoteLayout } = operation;
            if (
              options.backupPersonalOnly === true &&
              remoteLayout.permission !== "PERSONAL_WRITE"
            ) {
              break;
            }
            const localLayout = await local.get(operation.localLayout.id);
            if (!localLayout?.syncInfo) {
              break;
            }
            if (
              (options.backupPersonalOnly !== true &&
                !localLayoutSyncSnapshotMatches(localLayout, operation.localLayout)) ||
              localLayout.syncInfo.status === "updated"
            ) {
              break;
            }
            log.debug(`Updating baseline for ${localLayout.id}`);
            await local.put({
              id: remoteLayout.id,
              folder: remoteLayout.folder,
              name: remoteLayout.name,
              permission: remoteLayout.permission,
              baseline: {
                data: remoteLayout.data,
                savedAt: remoteLayout.savedAt,
                modifier: remoteLayout.modifier,
                modifierNickname: remoteLayout.modifierNickname,
              },
              working: localLayout.working,
              syncInfo: {
                status: localLayout.syncInfo.status,
                lastRemoteSavedAt: remoteLayout.savedAt,
                lastRemoteUpdatedAt: remoteLayout.updatedAt,
              },
              parent: remoteLayout.parent,
            });
            break;
          }
        }
      }
    });
  }

  async #performRemoteSyncOperations(
    operations: readonly (SyncOperation & { local: false })[],
    abortSignal: AbortSignal,
  ): Promise<void> {
    const remote = this.#remote;
    if (!remote) {
      return;
    }

    // Any necessary local cleanups are performed all at once after the server operations, so the
    // server ops can be done without blocking other local sync operations.
    type CleanupFunction = (local: NamespacedLayoutStorage) => Promise<boolean>;

    const cleanupResults = await Promise.allSettled(
      operations.map(async (operation): Promise<CleanupFunction> => {
        switch (operation.type) {
          case "delete-remote": {
            const { localLayout } = operation;
            log.debug(`Deleting remote layout ${localLayout.id}`);
            if (
              !(await remote.deleteLayout(localLayout.id, expectedRemoteTimestamps(localLayout)))
            ) {
              log.warn(`Deleting layout ${localLayout.id} which was not present in remote storage`);
            }
            return async (local) => {
              if (abortSignal.aborted) {
                return false;
              }
              const currentLayout = await local.get(localLayout.id);
              if (currentLayout?.syncInfo?.status === localLayout.syncInfo?.status) {
                await local.delete(localLayout.id);
                return true;
              }
              return false;
            };
          }

          case "upload-new": {
            const { localLayout } = operation;
            log.debug(`Uploading new layout ${localLayout.id}`);
            const newBaseline = await remote.saveNewLayout({
              id: localLayout.id,
              parent: localLayout.parent,
              folder: localLayout.folder,
              name: localLayout.name,
              data: localLayout.baseline.data,
              permission: localLayout.permission,
            });
            return async (local) => {
              // Don't check abortSignal; we need the cache to be updated to show the layout is tracked
              const currentLayout = await local.get(localLayout.id);
              if (!currentLayout) {
                return false;
              }
              if (currentLayout.syncInfo?.status !== localLayout.syncInfo?.status) {
                if (currentLayout.syncInfo?.status === "locally-deleted") {
                  await local.put({
                    ...currentLayout,
                    syncInfo: {
                      status: "locally-deleted",
                      lastRemoteSavedAt: newBaseline.savedAt,
                      lastRemoteUpdatedAt: newBaseline.updatedAt,
                    },
                  });
                  return true;
                }
                return false;
              }
              const changedSinceUpload =
                currentLayout.name !== localLayout.name ||
                currentLayout.folder !== localLayout.folder ||
                !isLayoutEqual(currentLayout.baseline.data, localLayout.baseline.data);
              await local.put({
                ...currentLayout,
                baseline: { ...currentLayout.baseline, savedAt: newBaseline.savedAt },
                syncInfo: {
                  status: changedSinceUpload ? "updated" : "tracked",
                  lastRemoteSavedAt: newBaseline.savedAt,
                  lastRemoteUpdatedAt: newBaseline.updatedAt,
                },
              });
              return true;
            };
          }

          case "upload-updated": {
            const { localLayout } = operation;
            log.debug(`Uploading updated layout ${localLayout.id}`);
            let newBaseline: RemoteLayout;
            try {
              newBaseline = await updateRemoteLayout(remote, {
                id: localLayout.id,
                parent: localLayout.parent,
                name: localLayout.name,
                folder: localLayout.folder,
                data: localLayout.baseline.data,
                ...expectedRemoteTimestamps(localLayout),
                // savedAt:
                //   localLayout.baseline.savedAt ?? (new Date().toISOString() as ISO8601Timestamp),
              });
            } catch (error) {
              if (!(error instanceof RemoteLayoutConflictError)) {
                throw error;
              }
              const remoteLayout = await remote.getLayout(localLayout.id);
              if (!remoteLayout) {
                throw error;
              }
              return async (local) => {
                const currentLayout = await local.get(localLayout.id);
                if (!currentLayout) {
                  return false;
                }
                if (!localLayoutSyncSnapshotMatches(currentLayout, localLayout)) {
                  return false;
                }
                const hasDataConflict = !isLayoutEqual(
                  remoteLayout.data,
                  currentLayout.baseline.data,
                );
                const hasLocalMetadataChanges =
                  !hasDataConflict &&
                  (currentLayout.name !== remoteLayout.name ||
                    currentLayout.folder !== remoteLayout.folder);
                const working =
                  currentLayout.working ??
                  (hasDataConflict
                    ? {
                        data: currentLayout.baseline.data,
                        savedAt: currentLayout.baseline.savedAt,
                      }
                    : undefined);
                await local.put({
                  ...currentLayout,
                  parent: remoteLayout.parent,
                  name: hasLocalMetadataChanges ? currentLayout.name : remoteLayout.name,
                  folder: hasLocalMetadataChanges ? currentLayout.folder : remoteLayout.folder,
                  permission: remoteLayout.permission,
                  baseline: {
                    data: remoteLayout.data,
                    savedAt: remoteLayout.savedAt,
                    modifier: remoteLayout.modifier,
                    modifierNickname: remoteLayout.modifierNickname,
                  },
                  working,
                  syncInfo: {
                    status: hasLocalMetadataChanges ? "updated" : "tracked",
                    lastRemoteSavedAt: remoteLayout.savedAt,
                    lastRemoteUpdatedAt: remoteLayout.updatedAt,
                  },
                });
                return true;
              };
            }
            return async (local) => {
              // Don't check abortSignal; we need the cache to be updated to show the layout is tracked
              const currentLayout = await local.get(localLayout.id);
              if (!currentLayout) {
                return false;
              }
              if (currentLayout.syncInfo?.status !== localLayout.syncInfo?.status) {
                if (currentLayout.syncInfo?.status === "locally-deleted") {
                  await local.put({
                    ...currentLayout,
                    syncInfo: {
                      status: "locally-deleted",
                      lastRemoteSavedAt: newBaseline.savedAt,
                      lastRemoteUpdatedAt: newBaseline.updatedAt,
                    },
                  });
                  return true;
                }
                return false;
              }
              const changedSinceUpload =
                currentLayout.name !== localLayout.name ||
                currentLayout.folder !== localLayout.folder ||
                !isLayoutEqual(currentLayout.baseline.data, localLayout.baseline.data);
              await local.put({
                ...currentLayout,
                name: changedSinceUpload ? currentLayout.name : newBaseline.name,
                folder: changedSinceUpload ? currentLayout.folder : newBaseline.folder,
                baseline: changedSinceUpload
                  ? currentLayout.baseline
                  : { ...currentLayout.baseline, savedAt: newBaseline.savedAt },
                syncInfo: {
                  status: changedSinceUpload ? "updated" : "tracked",
                  lastRemoteSavedAt: newBaseline.savedAt,
                  lastRemoteUpdatedAt: newBaseline.updatedAt,
                },
              });
              return true;
            };
          }
        }
      }),
    );
    const cleanups = cleanupResults
      .filter(
        (result): result is PromiseFulfilledResult<CleanupFunction> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);

    const didApplyCleanup = await this.#local.runExclusive(async (local) => {
      const cleanupApplied = await Promise.all(
        cleanups.map(async (cleanup) => {
          return await cleanup(local);
        }),
      );
      return cleanupApplied.some(Boolean);
    });

    const failedResult = cleanupResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failedResult) {
      if (didApplyCleanup) {
        this.#notifyChangeListeners({ type: "change", updatedLayout: undefined });
      }
      throw failedResult.reason;
    }
  }

  // sync remote layouts to local, then user can use layouts in offline status
  async #performBackupLocalSyncOperations(
    operations: readonly (SyncOperation & { local: true })[],
    abortSignal: AbortSignal,
  ): Promise<void> {
    if (!this.#backupLocal) {
      return;
    }
    await this.#performLocalSyncOperationsInStorage(this.#backupLocal, operations, abortSignal, {
      backupPersonalOnly: true,
      emitDeleteNotifications: false,
    });
  }

  public async putHistory({ id }: { id: LayoutID }): Promise<void> {
    const layout = await this.getLayout({ id });
    if (!layout) {
      return;
    }

    await this.#local.runExclusive(async (local) => {
      return await local.putHistory({ id, parent: this.projectName ?? this.userName ?? "" });
    });
  }

  public async getHistory(): Promise<Layout | undefined> {
    return await this.#local.runExclusive(async (local) => {
      const parents = [this.projectName, this.userName, ""].filter(
        (parent): parent is string => parent != undefined,
      );

      for (const parent of parents) {
        const layout = await local.getHistory(parent);
        if (layout) {
          return layout;
        }
      }

      return undefined;
    });
  }
}
