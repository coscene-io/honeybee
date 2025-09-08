// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import Log from "@foxglove/log";
import { Layout, LayoutID, ILayoutStorage, migrateLayout, LayoutHistory } from "@foxglove/studio-base";

const log = Log.getLogger(__filename);

const DATABASE_NAME = "coScene-layouts";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "layouts";
const HISTORY_STORE_NAME = "history";

interface LayoutsDB extends IDB.DBSchema {
  layouts: {
    key: [namespace: string, parent: string, id: LayoutID];
    value: {
      namespace: string;
      layout: Layout;
    };
    indexes: {
      namespace: string;
      namespace_id: [namespace: string, id: LayoutID];
      namespace_parent: [namespace: string, parent: string];
    };
  },
  history: {
    key: [namespace: string, parent: string];
    value: {
      namespace: string;
      history: LayoutHistory;
    };
    // indexes: {
    //   namespace_parent: [namespace: string, parent: string];
    // };
  },
}

/**
 * Stores layouts in IndexedDB. All layouts are stored in one object store, with the primary key
 * being the tuple of [namespace, id].
 */
export class IdbLayoutStorage implements ILayoutStorage {
  #db = IDB.openDB<LayoutsDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      // Create object store if it doesn't exist (version 1)
      if (oldVersion < 1) {
        const store = db.createObjectStore(OBJECT_STORE_NAME, {
          keyPath: ["namespace", "layout.parent", "layout.id"],
        });
        store.createIndex("namespace", "namespace");
        store.createIndex("namespace_id", ["namespace", "layout.id"]);
        store.createIndex("namespace_parent", ["namespace", "layout.parent"]);

        // Clean up the old foxglove-layouts IndexedDB database
        IDB.deleteDB("foxglove-layouts")
          .then(() => {
            log.info("Successfully removed old foxglove-layouts database");
          })
          .catch((error: unknown) => {
            log.warn("Failed to remove old foxglove-layouts database:", error);
          });

        db.createObjectStore(HISTORY_STORE_NAME, {
          keyPath: ["namespace", "history.parent"],
        });
      }
    },
  });

  public async list(namespace: string): Promise<readonly Layout[]> {
    const results: Layout[] = [];
    const records = await (
      await this.#db
    ).getAllFromIndex(OBJECT_STORE_NAME, "namespace", namespace);
    for (const record of records) {
      try {
        results.push(migrateLayout(record.layout));
      } catch (err) {
        log.error(err);
      }
    }
    return results;
  }

  public async get(namespace: string, id: LayoutID): Promise<Layout | undefined> {
    const record = await (
      await this.#db
    ).getFromIndex(OBJECT_STORE_NAME, "namespace_id", [namespace, id]);
    return record == undefined ? undefined : migrateLayout(record.layout);
  }

  public async put(namespace: string, layout: Layout): Promise<Layout> {
    await (await this.#db).put(OBJECT_STORE_NAME, { namespace, layout });
    return layout;
  }

  public async delete(namespace: string, id: LayoutID): Promise<void> {
    const record = await (
      await this.#db
    ).getFromIndex(OBJECT_STORE_NAME, "namespace_id", [namespace, id]);
    if (record == undefined) {
      return;
    }
    await (await this.#db).delete(OBJECT_STORE_NAME, [namespace, record.layout.parent, id]);
  }

  public async importLayouts({
    fromNamespace,
    toNamespace,
  }: {
    fromNamespace: string;
    toNamespace: string;
  }): Promise<void> {
    const tx = (await this.#db).transaction("layouts", "readwrite");
    const store = tx.objectStore("layouts");

    try {
      for await (const cursor of store.index("namespace").iterate(fromNamespace)) {
        await store.put({ namespace: toNamespace, layout: cursor.value.layout });
        await cursor.delete();
      }
      await tx.done;
    } catch (error) {
      log.error(error);
    }
  }

  public async migrateUnnamespacedLayouts(namespace: string): Promise<void> {
    await this.#migrateFromLocalStorage();

    // At the time IdbLayoutStorage was created, all layouts were already namespaced, so there are
    // no un-namespaced layouts to migrate.
    void namespace;
  }

  /**
   * Prior implementation (LocalStorageLayoutStorage) stored layouts in localStorage under a key
   * prefix. This approach was abandoned due to small capacity constraints on localStorage.
   * https://github.com/foxglove/studio/issues/3100
   */
  async #migrateFromLocalStorage() {
    const legacyLocalStorageKeyPrefix = "studio.layouts";
    const keysToMigrate: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${legacyLocalStorageKeyPrefix}.`) === true) {
        keysToMigrate.push(key);
      }
    }

    for (const key of keysToMigrate) {
      const layoutJson = localStorage.getItem(key);
      if (layoutJson == undefined) {
        continue;
      }
      try {
        const layout = migrateLayout(JSON.parse(layoutJson));
        const [_prefix1, _prefix2, namespace, id] = key.split(".");
        if (namespace == undefined || id == undefined || id !== layout.id) {
          log.error(`Failed to migrate ${key} from localStorage`);
          continue;
        }
        // use a separate transaction per item so we can be sure it is safe to delete from localStorage
        await (await this.#db).put("layouts", { namespace, layout });
        localStorage.removeItem(key);
      } catch (err) {
        log.error(err);
      }
    }
  }

  public async getHistory(namespace: string, parent: string): Promise<Layout | undefined> {
    const record = await (await this.#db).get(HISTORY_STORE_NAME, [namespace, parent]);
    if (record?.history == undefined) {
      return undefined;
    }

    const layout = await this.get(namespace, record.history.id);
    return layout;
  }

  public async putHistory(namespace: string, history: LayoutHistory): Promise<LayoutHistory> {
    await (await this.#db).put("history", { namespace, history });
    return history;
  }
}
