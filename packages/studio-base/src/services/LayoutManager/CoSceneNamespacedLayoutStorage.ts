// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import {
  ILayoutStorageCache,
  ISO8601Timestamp,
  Layout,
  LayoutHistory,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const log = Logger.getLogger(__filename);

/**
 * A wrapper around ILayoutStorage for a particular namespace.
 */
export class NamespacedLayoutStorage {
  #migration: Promise<void>;

  public constructor(
    private storage: ILayoutStorageCache,
    private namespace: string,
    private parents: string[],
    {
      migrateUnnamespacedLayouts,
      importFromNamespace,
    }: { migrateUnnamespacedLayouts: boolean; importFromNamespace: string | undefined },
  ) {
    this.#migration = (async function () {
      if (migrateUnnamespacedLayouts) {
        await storage.migrateUnnamespacedLayouts?.(namespace).catch((error: unknown) => {
          log.error("Migration failed:", error);
        });
      }

      if (importFromNamespace != undefined) {
        await storage
          .importLayouts({
            fromNamespace: importFromNamespace,
            toNamespace: namespace,
          })
          .catch((error: unknown) => {
            log.error("Import failed:", error);
          });
      }
    })();
  }

  public async list(): Promise<readonly Layout[]> {
    await this.#migration;
    return await this.storage.list(this.namespace, this.parents);
  }
  public async get(id: LayoutID): Promise<Layout | undefined> {
    await this.#migration;
    return await this.storage.get(this.namespace, this.parents, id);
  }
  public async put(layout: Layout): Promise<Layout> {
    await this.#migration;
    return await this.storage.put(this.namespace, this.parents, layout);
  }
  public async delete(id: LayoutID): Promise<void> {
    await this.#migration;
    await this.storage.delete(this.namespace, this.parents, id);
  }

  public async putHistory({
    id,
    parent,
  }: {
    id: LayoutID;
    parent: string;
  }): Promise<LayoutHistory> {
    await this.#migration;
    const history: LayoutHistory = {
      id,
      parent,
      savedAt: new Date().toISOString() as ISO8601Timestamp,
    };
    return await this.storage.putHistory(this.namespace, history);
  }

  public async getHistory(parent: string): Promise<Layout | undefined> {
    await this.#migration;
    return await this.storage.getHistory(this.namespace, parent);
  }
}
