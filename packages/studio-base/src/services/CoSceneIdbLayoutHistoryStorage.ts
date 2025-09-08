// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import { ILayoutHistoryStorage, LayoutHistory } from "@foxglove/studio-base/services/CoSceneILayoutHistoryStorage";

const DATABASE_NAME = "coScene-layouts";
const DATABASE_VERSION = 2;
const OBJECT_STORE_NAME = "history";

interface LayoutsHistoryDB extends IDB.DBSchema {
  history: {
    key: [namespace: string, parent: string];
    value: {
      namespace: string;
      history: LayoutHistory;
    };
    indexes: {
      namespace_parent: [namespace: string, parent: string];
    };
  };
}

/**
 * Stores layouts in IndexedDB. All layouts are stored in one object store, with the primary key
 * being the tuple of [namespace, parent].
 */
export class IdbLayoutHistoryStorage implements ILayoutHistoryStorage {
  #db = IDB.openDB<LayoutsHistoryDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db) {
      // Ensure the history store exists and uses the correct keyPath
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        const store = db.createObjectStore(OBJECT_STORE_NAME, {
          keyPath: ["namespace", "history.parent"],
        });
        store.createIndex("namespace_parent", ["namespace", "history.parent"]);
      }
    },
  });

  public async get(namespace: string, parent: string): Promise<LayoutHistory | undefined> {
    const record = await (
      await this.#db
    ).getFromIndex(OBJECT_STORE_NAME, "namespace_parent", [namespace, parent]);
    return record?.history;
  }

  public async put(namespace: string, history: LayoutHistory): Promise<LayoutHistory> {
    await (await this.#db).put(OBJECT_STORE_NAME, { namespace, history });
    return history;
  }
}
