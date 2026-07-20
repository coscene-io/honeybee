// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import { IdbExtensionStorage } from "./IdbExtensionStorage";

jest.mock("idb", () => ({
  openDB: jest.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeDatabase(): IDB.IDBPDatabase {
  return {
    close: jest.fn(),
    getAll: jest.fn().mockResolvedValue([]),
  } as unknown as IDB.IDBPDatabase;
}

describe("IdbExtensionStorage", () => {
  const openDB = jest.mocked(IDB.openDB);

  beforeEach(() => {
    openDB.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("closes a database that opens after the deadline and retries on the next operation", async () => {
    jest.useFakeTimers();
    const firstOpen = deferred<IDB.IDBPDatabase>();
    const lateDatabase = fakeDatabase();
    const retryDatabase = fakeDatabase();
    openDB.mockReturnValueOnce(firstOpen.promise).mockResolvedValueOnce(retryDatabase);
    const storage = new IdbExtensionStorage("local");

    const firstList = storage.list();
    const rejection = expect(firstList).rejects.toThrow(
      "Timed out opening extension database foxglove-extensions-local",
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await rejection;

    firstOpen.resolve(lateDatabase);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateDatabase.close).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
    jest.mocked(console.warn).mockClear();

    await expect(storage.list()).resolves.toEqual([]);
    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it("retries after the underlying open request fails", async () => {
    const database = fakeDatabase();
    openDB.mockRejectedValueOnce(new Error("open failed")).mockResolvedValueOnce(database);
    const storage = new IdbExtensionStorage("org");

    await expect(storage.list()).rejects.toThrow("open failed");
    await expect(storage.list()).resolves.toEqual([]);

    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it("retries after the underlying open request throws synchronously", async () => {
    const database = fakeDatabase();
    openDB
      .mockImplementationOnce(() => {
        throw new Error("open threw");
      })
      .mockResolvedValueOnce(database);
    const storage = new IdbExtensionStorage("org");

    await expect(storage.list()).rejects.toThrow("open threw");
    await expect(storage.list()).resolves.toEqual([]);

    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it("closes and invalidates a connection that blocks a newer database version", async () => {
    const firstDatabase = fakeDatabase();
    const secondDatabase = fakeDatabase();
    openDB.mockResolvedValueOnce(firstDatabase).mockResolvedValueOnce(secondDatabase);
    const storage = new IdbExtensionStorage("local");

    await storage.list();
    const callbacks = openDB.mock.calls[0]![2]!;
    callbacks.blocking?.(1, 2, {} as IDBVersionChangeEvent);

    expect(firstDatabase.close).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
    jest.mocked(console.warn).mockClear();
    await storage.list();
    expect(openDB).toHaveBeenCalledTimes(2);
  });
});
