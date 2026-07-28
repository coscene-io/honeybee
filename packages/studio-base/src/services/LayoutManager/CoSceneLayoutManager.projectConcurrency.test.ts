// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import type { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import type {
  ILayoutStorage,
  ISO8601Timestamp,
  Layout,
  LayoutHistory,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import type {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";
import CoSceneLayoutManager from "@foxglove/studio-base/services/LayoutManager/CoSceneLayoutManager";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function layoutData(value: string): LayoutData {
  return {
    layout: "Panel!1",
    configById: { "Panel!1": { value } },
    globalVariables: {},
    userNodes: {},
  };
}

function layoutId(value: string): LayoutID {
  return value as LayoutID;
}

function ts(value: string): ISO8601Timestamp {
  return value as ISO8601Timestamp;
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

type RemoteStore = {
  readonly layouts: Map<LayoutID, RemoteLayout>;
};

type UpdateLayoutParams = Parameters<IRemoteLayoutStorage["updateLayout"]>[0];

async function applyRemoteUpdate(
  storage: RemoteStore,
  { id, name, folder, data, expectedSavedAt, expectedUpdatedAt }: UpdateLayoutParams,
): ReturnType<IRemoteLayoutStorage["updateLayout"]> {
  const existing = storage.layouts.get(id);
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
  storage.layouts.set(id, clone(updated));
  return { status: "success" as const, newLayout: clone(updated) };
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
  public saveNewLayout = jest.fn(async (): Promise<RemoteLayout> => {
    throw new Error("Unexpected saveNewLayout call");
  });
  public updateLayout = jest.fn(async (params: UpdateLayoutParams) => {
    return await applyRemoteUpdate(this, params);
  });
  public deleteLayout = jest.fn(async (): Promise<boolean> => {
    throw new Error("Unexpected deleteLayout call");
  });
}

function makeProjectLayout(id: LayoutID): Layout {
  return {
    id,
    parent: "warehouses/w/projects/p",
    folder: "",
    name: "Layout",
    permission: "PROJECT_WRITE",
    baseline: {
      data: layoutData("baseline"),
      savedAt: ts("2024-01-01T00:00:00.000Z"),
      modifier: undefined,
      modifierNickname: undefined,
    },
    working: undefined,
    syncInfo: {
      status: "tracked",
      lastRemoteSavedAt: ts("2024-01-01T00:00:00.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:00.000Z"),
    },
  };
}

function makeRemoteProjectLayout(id: LayoutID): RemoteLayout {
  return {
    id,
    parent: "warehouses/w/projects/p",
    folder: "",
    name: "Layout",
    permission: "PROJECT_WRITE",
    data: layoutData("baseline"),
    savedAt: ts("2024-01-01T00:00:00.000Z"),
    updatedAt: ts("2024-01-01T00:00:00.000Z"),
    modifier: undefined,
    modifierNickname: undefined,
  };
}

describe("CoSceneLayoutManager project concurrency", () => {
  it("preserves newer working data when it changes during metadata update", async () => {
    const localStorage = new MemoryLayoutStorage();
    const remoteStorage = new MemoryRemoteLayoutStorage();
    const manager = new CoSceneLayoutManager({
      local: localStorage,
      remote: remoteStorage,
      currentUser: undefined,
    });
    manager.setOnline(true);

    const id = layoutId("warehouses/w/projects/p/layouts/1");
    await localStorage.put(
      `${CoSceneLayoutManager.REMOTE_STORAGE_NAMESPACE_PREFIX}${remoteStorage.namespace}`,
      makeProjectLayout(id),
    );
    remoteStorage.layouts.set(id, makeRemoteProjectLayout(id));
    remoteStorage.updateLayout.mockImplementationOnce(async (params: UpdateLayoutParams) => {
      await manager.updateLayout({ id, data: layoutData("newer-working") });
      return await applyRemoteUpdate(remoteStorage, params);
    });

    const result = await manager.updateLayout({ id, name: "Renamed" });

    expect(result?.name).toEqual("Renamed");
    expect(result?.baseline.data).toEqual(layoutData("baseline"));
    expect(result?.working?.data).toEqual(layoutData("newer-working"));
    expect(result?.syncInfo?.status).toEqual("tracked");
    expect(remoteStorage.layouts.get(id)?.name).toEqual("Renamed");
  });
});
