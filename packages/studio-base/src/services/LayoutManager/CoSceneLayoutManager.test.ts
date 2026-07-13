// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { LayoutManagerChangeEvent } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import {
  ILayoutStorage,
  ISO8601Timestamp,
  Layout,
  LayoutHistory,
  LayoutPermission,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";
import CoSceneLayoutManager from "@foxglove/studio-base/services/LayoutManager/CoSceneLayoutManager";

function clone<T>(value: T): T {
  return structuredClone(value);
}

const initialData: LayoutData = {
  layout: "Panel!1",
  configById: { "Panel!1": { value: "initial" } },
  globalVariables: {},
  userNodes: {},
};

function layoutData(value: string): LayoutData {
  return {
    layout: "Panel!1",
    configById: { "Panel!1": { value } },
    globalVariables: {},
    userNodes: {},
  };
}

function ts(value: string): ISO8601Timestamp {
  return value as ISO8601Timestamp;
}

function layoutId(value: string): LayoutID {
  return value as LayoutID;
}

class MemoryLayoutStorage implements ILayoutStorage {
  public layouts = new Map<string, Layout>();
  public history = new Map<string, LayoutHistory>();

  #layoutKey(namespace: string, id: LayoutID): string {
    return `${namespace}:${id}`;
  }

  #historyKey(namespace: string, parent: string): string {
    return `${namespace}:${parent}`;
  }

  public async list(namespace: string): Promise<readonly Layout[]> {
    const prefix = `${namespace}:`;
    return [...this.layouts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, layout]) => clone(layout));
  }

  public async listByParent(namespace: string, parent: string): Promise<readonly Layout[]> {
    return (await this.list(namespace)).filter((layout) => layout.parent === parent);
  }

  public async get(namespace: string, id: LayoutID): Promise<Layout | undefined> {
    const layout = this.layouts.get(this.#layoutKey(namespace, id));
    return layout == undefined ? undefined : clone(layout);
  }

  public async put(namespace: string, layout: Layout): Promise<Layout> {
    this.layouts.set(this.#layoutKey(namespace, layout.id), clone(layout));
    return clone(layout);
  }

  public async delete(namespace: string, id: LayoutID): Promise<void> {
    this.layouts.delete(this.#layoutKey(namespace, id));
  }

  public async importLayouts({
    fromNamespace,
    toNamespace,
  }: {
    fromNamespace: string;
    toNamespace: string;
  }): Promise<void> {
    for (const layout of await this.list(fromNamespace)) {
      await this.put(toNamespace, layout);
      await this.delete(fromNamespace, layout.id);
    }
  }

  public async getHistory(namespace: string, parent: string): Promise<Layout | undefined> {
    const history = this.history.get(this.#historyKey(namespace, parent));
    return history == undefined ? undefined : await this.get(namespace, history.id);
  }

  public async putHistory(namespace: string, history: LayoutHistory): Promise<LayoutHistory> {
    this.history.set(this.#historyKey(namespace, history.parent), clone(history));
    return clone(history);
  }
}

class MemoryRemoteLayoutStorage implements IRemoteLayoutStorage {
  public namespace = "remote-user";
  public projectName = "warehouses/w/projects/p";
  public userName = "users/u";
  public layouts = new Map<LayoutID, RemoteLayout>();

  public getLayouts = jest.fn(async () => [...this.layouts.values()].map(clone));
  public getLayout = jest.fn(async (id: LayoutID) => {
    const layout = this.layouts.get(id);
    return layout == undefined ? undefined : clone(layout);
  });
  public saveNewLayout = jest.fn(
    async ({
      id,
      parent,
      folder,
      name,
      data,
      permission,
    }: {
      id: LayoutID | undefined;
      parent: string;
      folder: string;
      name: string;
      data: LayoutData;
      permission: LayoutPermission;
    }) => {
      const remoteLayout = makeRemoteLayout({
        id: id ?? layoutId(`${parent}/layouts/new`),
        parent,
        folder,
        name,
        permission,
        data,
        savedAt: ts("2024-01-01T00:00:10.000Z"),
        updatedAt: ts("2024-01-01T00:00:10.000Z"),
      });
      this.layouts.set(remoteLayout.id, clone(remoteLayout));
      return clone(remoteLayout);
    },
  );
  public updateLayout = jest.fn(
    async ({
      id,
      name,
      folder,
      data,
      expectedSavedAt,
      expectedUpdatedAt,
    }: {
      id: LayoutID;
      parent: string;
      name?: string;
      folder?: string;
      data?: LayoutData;
      permission?: LayoutPermission;
      expectedSavedAt?: ISO8601Timestamp | undefined;
      expectedUpdatedAt?: ISO8601Timestamp | undefined;
    }) => {
      const existing = this.layouts.get(id);
      if (!existing) {
        return { status: "conflict" as const };
      }
      if (existing.savedAt !== expectedSavedAt || existing.updatedAt !== expectedUpdatedAt) {
        return { status: "conflict" as const };
      }

      const updated = {
        ...existing,
        name: name ?? existing.name,
        folder: folder ?? existing.folder,
        data: data ?? existing.data,
        savedAt: ts("2024-01-01T00:00:20.000Z"),
        updatedAt: ts("2024-01-01T00:00:20.000Z"),
      };
      this.layouts.set(id, clone(updated));
      return { status: "success" as const, newLayout: clone(updated) };
    },
  );
  public deleteLayout = jest.fn(
    async (
      id: LayoutID,
      options?: {
        expectedSavedAt?: ISO8601Timestamp | undefined;
        expectedUpdatedAt?: ISO8601Timestamp | undefined;
      },
    ) => {
      const existing = this.layouts.get(id);
      if (!existing) {
        return false;
      }
      if (
        options &&
        (existing.savedAt !== options.expectedSavedAt ||
          existing.updatedAt !== options.expectedUpdatedAt)
      ) {
        throw new Error(`Layout ${id} has changed on the server; local changes were not saved.`);
      }
      return this.layouts.delete(id);
    },
  );
}

function makeLocalLayout({
  id = layoutId("users/u/layouts/1"),
  parent = "users/u",
  folder = "",
  name = "Layout",
  permission = "PERSONAL_WRITE",
  data = initialData,
  savedAt = ts("2024-01-01T00:00:00.000Z"),
  updatedAt = ts("2024-01-01T00:00:00.000Z"),
  working,
  syncStatus = "tracked",
}: {
  id?: LayoutID;
  parent?: string;
  folder?: string;
  name?: string;
  permission?: LayoutPermission;
  data?: LayoutData;
  savedAt?: ISO8601Timestamp;
  updatedAt?: ISO8601Timestamp;
  working?: Layout["working"];
  syncStatus?: NonNullable<Layout["syncInfo"]>["status"];
} = {}): Layout {
  return {
    id,
    parent,
    folder,
    name,
    permission,
    baseline: {
      data,
      savedAt,
      modifier: undefined,
      modifierNickname: undefined,
    },
    working,
    syncInfo: {
      status: syncStatus,
      lastRemoteSavedAt: savedAt,
      lastRemoteUpdatedAt: updatedAt,
    },
  };
}

function makeRemoteLayout({
  id = layoutId("users/u/layouts/1"),
  parent = "users/u",
  permission = "PERSONAL_WRITE",
  data = initialData,
  savedAt = ts("2024-01-01T00:00:00.000Z"),
  updatedAt = ts("2024-01-01T00:00:00.000Z"),
  folder = "",
  name = "Layout",
}: {
  id?: LayoutID;
  parent?: string;
  permission?: LayoutPermission;
  data?: LayoutData;
  savedAt?: ISO8601Timestamp;
  updatedAt?: ISO8601Timestamp;
  folder?: string;
  name?: string;
} = {}): RemoteLayout {
  return {
    id,
    parent,
    folder,
    name,
    permission,
    data,
    savedAt,
    updatedAt,
    modifier: undefined,
    modifierNickname: undefined,
  };
}

function makeManager({
  localStorage,
  remoteStorage,
}: {
  localStorage: MemoryLayoutStorage;
  remoteStorage?: MemoryRemoteLayoutStorage;
}): CoSceneLayoutManager {
  const manager = new CoSceneLayoutManager({
    local: localStorage,
    remote: remoteStorage,
    currentUser: undefined,
  });
  manager.setOnline(true);
  return manager;
}

describe("CoSceneLayoutManager", () => {
  it("overwrites with explicit in-memory data instead of stale working data", async () => {
    const localStorage = new MemoryLayoutStorage();
    const manager = makeManager({ localStorage });
    const id = layoutId("layouts/1");
    await localStorage.put(
      CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
      makeLocalLayout({
        id,
        parent: "",
        working: {
          data: layoutData("stale-working"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
        syncStatus: "new",
      }),
    );

    const result = await manager.overwriteLayout({ id, data: layoutData("current-memory") });

    expect(result.baseline.data).toEqual(layoutData("current-memory"));
    expect(result.working).toBeUndefined();
  });

  it("does not restore an autosave older than a completed explicit save", async () => {
    const localStorage = new MemoryLayoutStorage();
    const manager = makeManager({ localStorage });
    const id = layoutId("layouts/1");
    await localStorage.put(
      CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
      makeLocalLayout({ id, parent: "", syncStatus: "new" }),
    );

    await manager.overwriteLayout({
      id,
      data: layoutData("explicit-save"),
      editRevision: 2,
    });
    await manager.updateLayout({
      id,
      data: layoutData("stale-autosave"),
      editRevision: 1,
    });

    expect(await manager.getLayout({ id })).toMatchObject({
      baseline: { data: layoutData("explicit-save") },
      working: undefined,
    });

    await manager.updateLayout({
      id,
      data: layoutData("newer-autosave"),
      editRevision: 3,
    });
    expect((await manager.getLayout({ id }))?.working?.data).toEqual(layoutData("newer-autosave"));
  });

  it("does not restore an autosave that completed after a revert", async () => {
    const localStorage = new MemoryLayoutStorage();
    const manager = makeManager({ localStorage });
    const id = layoutId("layouts/1");
    await localStorage.put(
      CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
      makeLocalLayout({
        id,
        parent: "",
        working: {
          data: layoutData("discarded"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
        syncStatus: "new",
      }),
    );

    await manager.revertLayout({ id, editRevision: 2 });
    await manager.updateLayout({
      id,
      data: layoutData("discarded"),
      editRevision: 2,
    });

    expect(await manager.getLayout({ id })).toMatchObject({
      baseline: { data: layoutData("initial") },
      working: undefined,
    });
  });

  it("does not apply an older autosave while a project overwrite is in flight", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    const namespace = `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`;
    await localStorage.put(
      namespace,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
      }),
    );

    let notifyRemoteStarted: () => void = () => {};
    const remoteStarted = new Promise<void>((resolve) => {
      notifyRemoteStarted = resolve;
    });
    let finishRemoteSave: () => void = () => {};
    const remoteSaveGate = new Promise<void>((resolve) => {
      finishRemoteSave = resolve;
    });
    remoteStorage.updateLayout.mockImplementationOnce(async () => {
      notifyRemoteStarted();
      await remoteSaveGate;
      const savedAt = ts("2024-01-01T00:00:20.000Z");
      const newLayout = {
        ...makeRemoteLayout({
          id,
          parent: "warehouses/w/projects/p",
          permission: "PROJECT_WRITE",
          data: layoutData("explicit-save"),
        }),
        savedAt,
        updatedAt: savedAt,
      };
      remoteStorage.layouts.set(id, newLayout);
      return { status: "success", newLayout };
    });

    const overwrite = manager.overwriteLayout({
      id,
      data: layoutData("explicit-save"),
      editRevision: 2,
    });
    await remoteStarted;
    await manager.updateLayout({
      id,
      data: layoutData("stale-autosave"),
      editRevision: 1,
    });

    expect((await manager.getLayout({ id }))?.working?.data).toEqual(layoutData("explicit-save"));

    finishRemoteSave();
    await overwrite;
    expect(await manager.getLayout({ id })).toMatchObject({
      baseline: { data: layoutData("explicit-save") },
      working: undefined,
    });
  });

  it("keeps local working data when project overwrite sees a remote timestamp conflict", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
        working: {
          data: layoutData("local-working"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("remote-changed"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await expect(manager.overwriteLayout({ id })).rejects.toThrow("changed on the server");

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.baseline.data).toEqual(layoutData("baseline"));
    expect(localLayout?.working?.data).toEqual(layoutData("local-working"));
    expect(remoteStorage.updateLayout).toHaveBeenCalledTimes(1);
  });

  it("persists explicit project overwrite data as working before reporting a remote conflict", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("remote-changed"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await expect(
      manager.overwriteLayout({ id, data: layoutData("current-memory") }),
    ).rejects.toThrow("changed on the server");

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.baseline.data).toEqual(layoutData("baseline"));
    expect(localLayout?.working?.data).toEqual(layoutData("current-memory"));
    expect(remoteStorage.updateLayout).toHaveBeenCalledTimes(1);
  });

  it("keeps project data autosave local instead of updating remote metadata", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
      }),
    );

    const result = await manager.updateLayout({ id, data: layoutData("draft") });

    expect(result?.working?.data).toEqual(layoutData("draft"));
    expect(remoteStorage.updateLayout).not.toHaveBeenCalled();
  });

  it("preserves newer project working data when it changes during overwrite", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.updateLayout.mockImplementationOnce(async (params) => {
      await manager.updateLayout({ id, data: layoutData("newer-working") });
      const existing = remoteStorage.layouts.get(id);
      if (!existing) {
        return { status: "conflict" as const };
      }
      const updated = {
        ...existing,
        data: params.data ?? existing.data,
        savedAt: ts("2024-01-01T00:00:20.000Z"),
        updatedAt: ts("2024-01-01T00:00:20.000Z"),
      };
      remoteStorage.layouts.set(id, clone(updated));
      return { status: "success" as const, newLayout: clone(updated) };
    });

    const result = await manager.overwriteLayout({ id, data: layoutData("save-request") });

    expect(result.baseline.data).toEqual(layoutData("save-request"));
    expect(result.working?.data).toEqual(layoutData("newer-working"));
    expect(result.syncInfo?.status).toEqual("tracked");
  });

  it("does not delete a project layout when local data changes during remote delete", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.deleteLayout.mockImplementationOnce(async (deleteId) => {
      await manager.updateLayout({ id, data: layoutData("newer-working") });
      remoteStorage.layouts.delete(deleteId);
      return true;
    });

    await manager.deleteLayout({ id });

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.baseline.data).toEqual(layoutData("baseline"));
    expect(localLayout?.working?.data).toEqual(layoutData("newer-working"));
    expect(remoteStorage.layouts.has(id)).toBe(false);
  });

  it("deletes a stale project layout locally when the remote layout is already absent", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );

    await manager.deleteLayout({ id });

    expect(
      await localStorage.get(
        `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
        id,
      ),
    ).toBeUndefined();
    expect(remoteStorage.deleteLayout).toHaveBeenCalledWith(id, {
      expectedSavedAt: ts("2024-01-01T00:00:00.000Z"),
      expectedUpdatedAt: ts("2024-01-01T00:00:00.000Z"),
    });
  });

  it("does not delete local layouts when remote list fails", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({ id }),
    );
    remoteStorage.getLayouts.mockRejectedValueOnce(new Error("network down"));

    await expect(manager.syncWithRemote(new AbortController().signal)).rejects.toThrow(
      "network down",
    );

    expect(await manager.getLayout({ id })).toBeDefined();
  });

  it("does not delete a personal layout that gained working data during sync", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({ id }),
    );
    remoteStorage.getLayouts.mockImplementationOnce(async () => {
      await manager.updateLayout({ id, data: layoutData("draft-during-sync") });
      return [];
    });

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.syncInfo?.status).toEqual("remotely-deleted");
    expect(localLayout?.working?.data).toEqual(layoutData("draft-during-sync"));
  });

  it("recreates a remotely deleted personal layout after the user saves its draft", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        working: {
          data: layoutData("local-draft"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);
    await manager.overwriteLayout({ id, data: layoutData("local-draft") });
    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(remoteStorage.saveNewLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        data: layoutData("local-draft"),
        permission: "PERSONAL_WRITE",
      }),
    );
    expect(remoteStorage.layouts.get(id)?.data).toEqual(layoutData("local-draft"));
    expect(localLayout?.syncInfo?.status).toEqual("tracked");
    expect(localLayout?.working).toBeUndefined();
  });

  it("reuploads an updated personal layout when the remote copy is missing", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        data: layoutData("locally-saved"),
        syncStatus: "updated",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(remoteStorage.saveNewLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        data: layoutData("locally-saved"),
        permission: "PERSONAL_WRITE",
      }),
    );
    expect(remoteStorage.layouts.get(id)?.data).toEqual(layoutData("locally-saved"));
    expect(localLayout?.syncInfo?.status).toEqual("tracked");
  });

  it("preserves remote timestamps when a new personal layout is deleted during upload", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        data: layoutData("new-layout"),
        syncStatus: "new",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: undefined,
      }),
    );
    remoteStorage.saveNewLayout.mockImplementationOnce(async (params) => {
      await manager.deleteLayout({ id });
      const remoteLayout = makeRemoteLayout({
        id: params.id ?? id,
        parent: params.parent,
        folder: params.folder,
        name: params.name,
        permission: params.permission,
        data: params.data,
        savedAt: ts("2024-01-01T00:00:10.000Z"),
        updatedAt: ts("2024-01-01T00:00:10.000Z"),
      });
      remoteStorage.layouts.set(remoteLayout.id, clone(remoteLayout));
      return clone(remoteLayout);
    });

    await manager.syncWithRemote(new AbortController().signal);

    const tombstone = await localStorage.get(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      id,
    );
    expect(tombstone?.syncInfo).toEqual({
      status: "locally-deleted",
      lastRemoteSavedAt: ts("2024-01-01T00:00:10.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:10.000Z"),
    });

    await manager.syncWithRemote(new AbortController().signal);

    expect(remoteStorage.layouts.has(id)).toBe(false);
    expect(
      await localStorage.get(
        `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
        id,
      ),
    ).toBeUndefined();
  });

  it("does not overwrite a locally updated baseline with a stale sync update-baseline operation", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        data: layoutData("remote"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );
    remoteStorage.getLayouts.mockImplementationOnce(async () => {
      await manager.overwriteLayout({ id, data: layoutData("local-saved-during-sync") });
      return [...remoteStorage.layouts.values()].map(clone);
    });

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.baseline.data).toEqual(layoutData("local-saved-during-sync"));
    expect(localLayout?.syncInfo?.status).toEqual("updated");
  });

  it("notifies listeners after partial remote sync cleanup before reporting a conflict", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const uploadedId = layoutId("users/u/layouts/uploaded");
    const conflictId = layoutId("users/u/layouts/conflict");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id: uploadedId,
        data: layoutData("new-local"),
        syncStatus: "new",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: undefined,
      }),
    );
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id: conflictId,
        data: layoutData("local-update"),
        syncStatus: "updated",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      conflictId,
      makeRemoteLayout({
        id: conflictId,
        data: layoutData("remote-update"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );
    remoteStorage.updateLayout.mockRejectedValueOnce(new Error("remote down"));
    const events: LayoutManagerChangeEvent[] = [];
    manager.on("change", (event) => {
      events.push(event);
    });

    await expect(manager.syncWithRemote(new AbortController().signal)).rejects.toThrow(
      "remote down",
    );
    await Promise.resolve();

    const uploadedLayout = await manager.getLayout({ id: uploadedId });
    expect(uploadedLayout?.syncInfo?.status).toEqual("tracked");
    expect(
      events.some((event) => event.type === "change" && event.updatedLayout == undefined),
    ).toBe(true);
  });

  it("marks newly uploaded layouts as updated when local metadata changes during upload", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        name: "Original",
        syncStatus: "new",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.saveNewLayout.mockImplementationOnce(async (params) => {
      await manager.updateLayout({ id, name: "Renamed while uploading" });
      const remoteLayout = makeRemoteLayout({
        id: params.id ?? id,
        parent: params.parent,
        folder: params.folder,
        name: params.name,
        permission: params.permission,
        data: params.data,
        savedAt: ts("2024-01-01T00:00:10.000Z"),
        updatedAt: ts("2024-01-01T00:00:10.000Z"),
      });
      remoteStorage.layouts.set(remoteLayout.id, clone(remoteLayout));
      return clone(remoteLayout);
    });

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.name).toEqual("Renamed while uploading");
    expect(localLayout?.syncInfo?.status).toEqual("updated");
    expect(localLayout?.syncInfo?.lastRemoteSavedAt).toEqual(ts("2024-01-01T00:00:10.000Z"));
    expect(remoteStorage.saveNewLayout).toHaveBeenCalledTimes(1);
  });

  it("keeps later personal saves queued after an updated layout finishes uploading", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        data: layoutData("first-save"),
        syncStatus: "updated",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        data: layoutData("remote-before"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.updateLayout.mockImplementationOnce(async (params) => {
      await manager.overwriteLayout({ id, data: layoutData("second-save") });
      const existing = remoteStorage.layouts.get(id);
      if (!existing) {
        return { status: "conflict" as const };
      }
      const updated = {
        ...existing,
        name: params.name ?? existing.name,
        folder: params.folder ?? existing.folder,
        data: params.data ?? existing.data,
        savedAt: ts("2024-01-01T00:00:20.000Z"),
        updatedAt: ts("2024-01-01T00:00:20.000Z"),
      };
      remoteStorage.layouts.set(id, clone(updated));
      return { status: "success" as const, newLayout: clone(updated) };
    });

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(remoteStorage.layouts.get(id)?.data).toEqual(layoutData("first-save"));
    expect(localLayout?.baseline.data).toEqual(layoutData("second-save"));
    expect(localLayout?.syncInfo).toEqual({
      status: "updated",
      lastRemoteSavedAt: ts("2024-01-01T00:00:20.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:20.000Z"),
    });
  });

  it("applies successful remote sync cleanup even when another remote operation fails", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const newId = layoutId("users/u/layouts/new");
    const updatedId = layoutId("users/u/layouts/updated");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id: newId,
        syncStatus: "new",
        data: layoutData("new"),
      }),
    );
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id: updatedId,
        syncStatus: "updated",
        data: layoutData("updated"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      updatedId,
      makeRemoteLayout({
        id: updatedId,
        data: layoutData("remote-updated"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );
    remoteStorage.updateLayout.mockRejectedValueOnce(new Error("remote down"));

    await expect(manager.syncWithRemote(new AbortController().signal)).rejects.toThrow(
      "remote down",
    );

    const uploadedLayout = await manager.getLayout({ id: newId });
    const failedLayout = await manager.getLayout({ id: updatedId });
    expect(uploadedLayout?.syncInfo?.status).toEqual("tracked");
    expect(remoteStorage.saveNewLayout).toHaveBeenCalledTimes(1);
    expect(failedLayout?.syncInfo?.status).toEqual("updated");
  });

  it("uploads folder changes for updated personal layouts", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        folder: "Moved",
        syncStatus: "updated",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        folder: "",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(remoteStorage.updateLayout).toHaveBeenCalledWith(
      expect.objectContaining({ id, folder: "Moved" }),
    );
    expect(remoteStorage.layouts.get(id)?.folder).toEqual("Moved");
    expect(localLayout?.folder).toEqual("Moved");
    expect(localLayout?.syncInfo?.status).toEqual("tracked");
  });

  it("updates baseline when only remote updatedAt changes and preserves working data", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        data: layoutData("baseline"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
        working: {
          data: layoutData("draft"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        data: layoutData("remote"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.baseline.data).toEqual(layoutData("remote"));
    expect(localLayout?.working?.data).toEqual(layoutData("draft"));
    expect(localLayout?.syncInfo?.lastRemoteUpdatedAt).toEqual(ts("2024-01-01T00:00:02.000Z"));
  });

  it("notifies delete when reverting the draft of a remotely deleted layout", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        syncStatus: "remotely-deleted",
        working: {
          data: layoutData("local-draft"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );
    const events: LayoutManagerChangeEvent[] = [];
    manager.on("change", (event) => {
      events.push(event);
    });

    await manager.revertLayout({ id });
    await Promise.resolve();

    expect(events).toContainEqual({ type: "delete", layoutId: id });
    expect(await manager.getLayout({ id })).toBeUndefined();
  });

  it("does not emit delete events for backup-only personal layout cleanup", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    const layout = makeLocalLayout({ id });
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      layout,
    );
    await localStorage.put(CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE, layout);
    remoteStorage.getLayouts.mockImplementationOnce(async () => {
      await manager.updateLayout({ id, data: layoutData("draft-during-sync") });
      return [];
    });
    const deleteEvents: LayoutManagerChangeEvent[] = [];
    manager.on("change", (event) => {
      if (event.type === "delete") {
        deleteEvents.push(event);
      }
    });

    await manager.syncWithRemote(new AbortController().signal);
    await Promise.resolve();

    const primaryLayout = await manager.getLayout({ id });
    expect(primaryLayout?.syncInfo?.status).toEqual("remotely-deleted");
    expect(primaryLayout?.working?.data).toEqual(layoutData("draft-during-sync"));
    expect(deleteEvents).toEqual([]);
    expect(
      await localStorage.get(CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE, id),
    ).toBeUndefined();
  });

  it("refreshes existing offline backups when caching a remote personal layout", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await manager.getLayouts();
    await localStorage.put(
      CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
      makeLocalLayout({
        id,
        name: "Stale backup",
        data: layoutData("stale-backup"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        name: "Remote current",
        data: layoutData("remote-current"),
        savedAt: ts("2024-01-01T00:00:10.000Z"),
        updatedAt: ts("2024-01-01T00:00:10.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const backupLayout = await localStorage.get(CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE, id);
    expect(backupLayout?.name).toEqual("Remote current");
    expect(backupLayout?.baseline.data).toEqual(layoutData("remote-current"));
    expect(backupLayout?.syncInfo).toEqual({
      status: "tracked",
      lastRemoteSavedAt: ts("2024-01-01T00:00:10.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:10.000Z"),
    });
  });

  it("refreshes existing offline backups when a remote personal layout baseline changes", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const id = layoutId("users/u/layouts/1");
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        name: "Primary old",
        data: layoutData("primary-old"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    const manager = makeManager({ localStorage, remoteStorage });
    const cachedPrimary = await manager.getLayout({ id });
    expect(cachedPrimary?.baseline.data).toEqual(layoutData("primary-old"));
    await localStorage.put(
      CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
      makeLocalLayout({
        id,
        name: "Backup older",
        data: layoutData("backup-older"),
        savedAt: ts("2023-12-31T00:00:00.000Z"),
        updatedAt: ts("2023-12-31T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.clear();
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        name: "Remote current",
        data: layoutData("remote-current"),
        savedAt: ts("2024-01-01T00:00:10.000Z"),
        updatedAt: ts("2024-01-01T00:00:10.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const backupLayout = await localStorage.get(CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE, id);
    expect(backupLayout?.name).toEqual("Remote current");
    expect(backupLayout?.baseline.data).toEqual(layoutData("remote-current"));
    expect(backupLayout?.syncInfo).toEqual({
      status: "tracked",
      lastRemoteSavedAt: ts("2024-01-01T00:00:10.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:10.000Z"),
    });
  });

  it("deletes stale offline backups when a remote personal layout is deleted", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const id = layoutId("users/u/layouts/1");
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        name: "Primary old",
        data: layoutData("primary-old"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    const manager = makeManager({ localStorage, remoteStorage });
    const cachedPrimary = await manager.getLayout({ id });
    expect(cachedPrimary?.baseline.data).toEqual(layoutData("primary-old"));
    await localStorage.put(
      CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE,
      makeLocalLayout({
        id,
        name: "Backup older",
        data: layoutData("backup-older"),
        savedAt: ts("2023-12-31T00:00:00.000Z"),
        updatedAt: ts("2023-12-31T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.clear();

    await manager.syncWithRemote(new AbortController().signal);

    expect(
      await localStorage.get(CoSceneLayoutManager.LOCAL_STORAGE_NAMESPACE, id),
    ).toBeUndefined();
  });

  it("marks a remotely deleted project layout with working data and preserves the draft", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        working: {
          data: layoutData("local-draft"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.syncInfo?.status).toEqual("remotely-deleted");
    expect(localLayout?.working?.data).toEqual(layoutData("local-draft"));
  });

  it("refreshes a conflicted personal layout and keeps the local save as a draft", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        data: layoutData("local-saved"),
        syncStatus: "updated",
        savedAt: ts("2024-01-01T00:00:01.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        data: layoutData("remote-saved"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const localLayout = await manager.getLayout({ id });
    expect(localLayout?.baseline.data).toEqual(layoutData("remote-saved"));
    expect(localLayout?.working?.data).toEqual(layoutData("local-saved"));
    expect(localLayout?.syncInfo).toEqual({
      status: "tracked",
      lastRemoteSavedAt: ts("2024-01-01T00:00:00.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:02.000Z"),
    });

    await manager.syncWithRemote(new AbortController().signal);

    expect(remoteStorage.updateLayout).toHaveBeenCalledTimes(1);
  });

  it("keeps local metadata changes queued after refreshing a conflicted personal layout", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    const localLayout = makeLocalLayout({
      id,
      name: "Local rename",
      folder: "Local folder",
      data: layoutData("shared-data"),
      syncStatus: "updated",
      savedAt: ts("2024-01-01T00:00:01.000Z"),
      updatedAt: ts("2024-01-01T00:00:00.000Z"),
    });
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      {
        ...localLayout,
        syncInfo: {
          status: "updated",
          lastRemoteSavedAt: ts("2024-01-01T00:00:00.000Z"),
          lastRemoteUpdatedAt: ts("2024-01-01T00:00:00.000Z"),
        },
      },
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        name: "Remote name",
        folder: "",
        data: layoutData("shared-data"),
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    const localAfterConflict = await manager.getLayout({ id });
    expect(localAfterConflict?.name).toEqual("Local rename");
    expect(localAfterConflict?.folder).toEqual("Local folder");
    expect(localAfterConflict?.baseline.data).toEqual(layoutData("shared-data"));
    expect(localAfterConflict?.syncInfo).toEqual({
      status: "updated",
      lastRemoteSavedAt: ts("2024-01-01T00:00:00.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:02.000Z"),
    });

    await manager.syncWithRemote(new AbortController().signal);

    expect(remoteStorage.layouts.get(id)?.name).toEqual("Local rename");
    expect(remoteStorage.layouts.get(id)?.folder).toEqual("Local folder");
  });

  it("does not delete a project layout when remote timestamps changed", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await expect(manager.deleteLayout({ id })).rejects.toThrow("changed on the server");

    expect(await manager.getLayout({ id })).toBeDefined();
    expect(remoteStorage.deleteLayout).toHaveBeenCalledTimes(1);
  });

  it("passes expected remote timestamps when deleting a project layout", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:01.000Z"),
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        parent: "warehouses/w/projects/p",
        permission: "PROJECT_WRITE",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:01.000Z"),
      }),
    );

    await manager.deleteLayout({ id });

    expect(remoteStorage.deleteLayout).toHaveBeenCalledWith(id, {
      expectedSavedAt: ts("2024-01-01T00:00:00.000Z"),
      expectedUpdatedAt: ts("2024-01-01T00:00:01.000Z"),
    });
  });

  it("keeps a locally-deleted personal tombstone when remote delete detects a conflict", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        syncStatus: "locally-deleted",
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:00.000Z"),
        working: {
          data: layoutData("deleted-local-copy"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );
    remoteStorage.layouts.set(
      id,
      makeRemoteLayout({
        id,
        savedAt: ts("2024-01-01T00:00:00.000Z"),
        updatedAt: ts("2024-01-01T00:00:02.000Z"),
      }),
    );

    await expect(manager.syncWithRemote(new AbortController().signal)).rejects.toThrow(
      "changed on the server",
    );

    const rawLayout = await localStorage.get(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      id,
    );
    expect(rawLayout?.syncInfo?.status).toEqual("locally-deleted");
    expect(rawLayout?.working?.data).toEqual(layoutData("deleted-local-copy"));
  });

  it("cleans a locally-deleted personal tombstone when remote is already absent", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = makeManager({ localStorage, remoteStorage });
    const id = layoutId("users/u/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeLocalLayout({
        id,
        syncStatus: "locally-deleted",
        working: {
          data: layoutData("deleted-local-copy"),
          savedAt: ts("2024-01-01T00:00:01.000Z"),
        },
      }),
    );

    await manager.syncWithRemote(new AbortController().signal);

    expect(
      await localStorage.get(
        `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
        id,
      ),
    ).toBeUndefined();
  });
});
