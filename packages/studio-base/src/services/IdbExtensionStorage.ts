// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import Log from "@foxglove/log";
import {
  IExtensionStorage,
  StoredExtension,
} from "@foxglove/studio-base/services/IExtensionStorage";
import { ExtensionInfo } from "@foxglove/studio-base/types/Extensions";

const log = Log.getLogger(__filename);

const DATABASE_BASE_NAME = "foxglove-extensions";
const METADATA_STORE_NAME = "metadata";
const EXTENSION_STORE_NAME = "extensions";
const OPEN_TIMEOUT_MS = 5_000;

interface ExtensionsDB extends IDB.DBSchema {
  metadata: {
    key: string;
    value: ExtensionInfo;
  };
  extensions: {
    key: string;
    value: StoredExtension;
  };
}

export class IdbExtensionStorage implements IExtensionStorage {
  #db: Promise<IDB.IDBPDatabase<ExtensionsDB>> | undefined;
  #databaseName: string;
  #openGeneration = 0;
  public namespace: string;

  public constructor(namespace: string) {
    this.namespace = namespace;
    this.#databaseName = [DATABASE_BASE_NAME, namespace].join("-");
  }

  async #getDb(): Promise<IDB.IDBPDatabase<ExtensionsDB>> {
    let dbPromise = this.#db;
    if (dbPromise == undefined) {
      dbPromise = this.#openDb(++this.#openGeneration);
      this.#db = dbPromise;
    }

    try {
      return await dbPromise;
    } catch (error) {
      // openDB may fail by returning a rejected promise or by throwing before it returns one.
      // #openDb is async, so both cases surface here as a rejected promise.
      if (this.#db === dbPromise) {
        this.#db = undefined;
      }
      throw error;
    }
  }

  async #openDb(generation: number): Promise<IDB.IDBPDatabase<ExtensionsDB>> {
    const startedAt = performance.now();
    let openStage: "opening" | "blocked" | "upgrading" = "opening";
    let openedDb: IDB.IDBPDatabase<ExtensionsDB> | undefined;

    const rawOpenPromise = IDB.openDB<ExtensionsDB>(this.#databaseName, 1, {
      upgrade: (db) => {
        openStage = "upgrading";
        log.debug("Creating extension object stores");

        db.createObjectStore(METADATA_STORE_NAME, {
          keyPath: "id",
        });

        db.createObjectStore(EXTENSION_STORE_NAME, {
          keyPath: "info.id",
        });
      },
      blocked: (currentVersion, blockedVersion) => {
        openStage = "blocked";
        log.warn("Extension database open is blocked by another connection", {
          databaseName: this.#databaseName,
          currentVersion,
          blockedVersion,
          durationMs: performance.now() - startedAt,
        });
      },
      blocking: (currentVersion, blockedVersion) => {
        log.warn("Closing extension database for a newer version", {
          databaseName: this.#databaseName,
          currentVersion,
          blockedVersion,
        });
        openedDb?.close();
        if (this.#openGeneration === generation) {
          this.#db = undefined;
        }
      },
      terminated: () => {
        log.warn("Extension database connection terminated unexpectedly", {
          databaseName: this.#databaseName,
        });
        if (this.#openGeneration === generation) {
          this.#db = undefined;
        }
      },
    });

    const openPromise = new Promise<IDB.IDBPDatabase<ExtensionsDB>>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        log.warn("Extension database availability deadline exceeded", {
          databaseName: this.#databaseName,
          stage: openStage,
          durationMs: performance.now() - startedAt,
        });
        reject(new Error(`Timed out opening extension database ${this.#databaseName}`));
      }, OPEN_TIMEOUT_MS);

      void rawOpenPromise.then(
        (db) => {
          openedDb = db;
          if (settled) {
            log.info("Extension database open completed after availability timeout", {
              databaseName: this.#databaseName,
              durationMs: performance.now() - startedAt,
            });
            db.close();
            return;
          }

          settled = true;
          clearTimeout(timer);
          log.debug("Extension database opened", {
            databaseName: this.#databaseName,
            durationMs: performance.now() - startedAt,
          });
          resolve(db);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

    try {
      return await openPromise;
    } catch (error) {
      if (this.#openGeneration === generation) {
        this.#db = undefined;
      }
      throw error;
    }
  }

  public async list(): Promise<ExtensionInfo[]> {
    const records = await (await this.#getDb()).getAll(METADATA_STORE_NAME);

    log.debug(`Found ${records.length} extensions`);

    return records;
  }

  public async get(id: string): Promise<undefined | StoredExtension> {
    log.debug("Getting extension", id);

    return await (await this.#getDb()).get(EXTENSION_STORE_NAME, id);
  }

  public async put(extension: StoredExtension): Promise<StoredExtension> {
    log.debug("Storing extension", { extension });

    const transaction = (await this.#getDb()).transaction(
      [METADATA_STORE_NAME, EXTENSION_STORE_NAME],
      "readwrite",
    );
    await Promise.all([
      transaction.db.put(METADATA_STORE_NAME, extension.info),
      transaction.db.put(EXTENSION_STORE_NAME, extension),
      transaction.done,
    ]);

    return extension;
  }

  public async delete(id: string): Promise<void> {
    log.debug("Deleting extension", id);

    const transaction = (await this.#getDb()).transaction(
      [METADATA_STORE_NAME, EXTENSION_STORE_NAME],
      "readwrite",
    );
    await Promise.all([
      transaction.db.delete(METADATA_STORE_NAME, id),
      transaction.db.delete(EXTENSION_STORE_NAME, id),
      transaction.done,
    ]);
  }
}
