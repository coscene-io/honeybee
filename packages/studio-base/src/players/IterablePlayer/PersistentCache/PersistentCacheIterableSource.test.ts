// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import {
  type CacheSessionMetadata,
  clearIndexedDbMessageStoreDatabase,
  IndexedDbMessageStore,
  REALTIME_MESSAGE_CACHE_DB_NAME,
} from "@foxglove/studio-base/persistence/IndexedDbMessageStore";

import { PersistentCacheIterableSource } from "./PersistentCacheIterableSource";

describe("PersistentCacheIterableSource", () => {
  async function readSessionMetadata(sessionId: string): Promise<CacheSessionMetadata | undefined> {
    const db = await IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME);
    try {
      const tx = db.transaction("sessions", "readonly");
      const metadata = await tx.store.get(sessionId);
      await tx.done;
      return metadata;
    } finally {
      db.close();
    }
  }

  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("initializes topics and datatypes from metadata", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "source-metadata" });
    await store.init();
    await store.storeDatatypes(
      new Map([["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }]]),
    );
    await store.storeTopics(
      [{ name: "/late_topic", schemaName: "pkg/Msg" }],
      new Map([["/late_topic", { numMessages: 1 }]]),
    );
    await store.append([
      {
        topic: "/other",
        schemaName: "pkg/Msg",
        receiveTime: { sec: 1, nsec: 0 },
        message: {},
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();

    const source = new PersistentCacheIterableSource({ sessionId: "source-metadata" });
    const init = await source.initialize();

    expect(init.topics).toEqual([{ name: "/late_topic", schemaName: "pkg/Msg" }]);
    expect(init.topicStats).toEqual(new Map([["/late_topic", { numMessages: 1 }]]));
    expect(init.datatypes).toEqual(
      new Map([["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }]]),
    );

    await source.terminate();
  });

  it("allows replay initialization when datatypes are empty", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "empty-datatypes" });
    await store.init();
    await store.storeDatatypes(new Map());
    await store.storeTopics(
      [{ name: "/json", schemaName: undefined, messageEncoding: "json" }],
      new Map([["/json", { numMessages: 1 }]]),
    );
    await store.append([
      {
        topic: "/json",
        schemaName: "",
        receiveTime: { sec: 1, nsec: 0 },
        message: { value: 1 },
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();

    const source = new PersistentCacheIterableSource({ sessionId: "empty-datatypes" });
    const init = await source.initialize();

    expect(init.topics).toEqual([
      { name: "/json", schemaName: undefined, messageEncoding: "json" },
    ]);
    expect(init.datatypes).toEqual(new Map());
    expect(init.problems).toEqual([]);

    await source.terminate();
  });

  it("does not delete the cache session on terminate", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "readonly-terminate" });
    await store.init();
    await store.storeDatatypes(new Map([["pkg/Msg", { definitions: [] }]]));
    await store.storeTopics([{ name: "/topic", schemaName: "pkg/Msg" }]);
    await store.append([
      {
        topic: "/topic",
        schemaName: "pkg/Msg",
        receiveTime: { sec: 1, nsec: 0 },
        message: { value: 1 },
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();

    const source = new PersistentCacheIterableSource({ sessionId: "readonly-terminate" });
    await source.initialize();
    await source.terminate();

    const reader = new IndexedDbMessageStore({ sessionId: "readonly-terminate" });
    await reader.init();
    expect((await reader.stats()).count).toBe(1);
    await reader.close();
  });

  it("leases an existing cache for replay without reviving the writer session", async () => {
    const sessionId = "reader-lease";
    const store = new IndexedDbMessageStore({
      sessionId,
      retentionWindowMs: 120_000,
      maxCacheSize: 16 * 1024 * 1024,
    });
    await store.init();
    await store.append([
      {
        topic: "/topic",
        schemaName: "pkg/Msg",
        receiveTime: { sec: 1, nsec: 0 },
        message: { value: 1 },
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();
    const metadataBeforeReplay = await readSessionMetadata(sessionId);
    expect(metadataBeforeReplay).toMatchObject({ status: "closed", owners: [] });

    const source = new PersistentCacheIterableSource({
      sessionId,
      retentionWindowMs: 1,
      maxCacheSize: 1,
    });
    await source.initialize();
    expect(await readSessionMetadata(sessionId)).toEqual({
      ...metadataBeforeReplay,
      lastActiveAt: expect.any(Number),
      status: "closed",
      owners: [],
      readers: [expect.any(String)],
    });

    await source.terminate();
    expect(await readSessionMetadata(sessionId)).toEqual({
      ...metadataBeforeReplay,
      lastActiveAt: expect.any(Number),
      status: "closed",
      owners: [],
      readers: [],
    });
  });

  it("does not create metadata when a replay session does not exist", async () => {
    const sessionId = "missing-readonly-session";
    const source = new PersistentCacheIterableSource({ sessionId });

    await expect(source.initialize()).resolves.toMatchObject({ topics: [] });
    expect(await readSessionMetadata(sessionId)).toBeUndefined();

    await source.terminate();
    expect(await readSessionMetadata(sessionId)).toBeUndefined();
  });

  it("preserves a borrowed cache session when replay metadata initialization fails", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "readonly-init-failure" });
    await store.init();
    await store.append([
      {
        topic: "/topic",
        schemaName: "pkg/Msg",
        receiveTime: { sec: 1, nsec: 0 },
        message: { value: 1 },
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();

    const metadataFailure = new Error("metadata transaction failed");
    const statsSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "stats")
      .mockRejectedValueOnce(metadataFailure);
    const source = new PersistentCacheIterableSource({ sessionId: "readonly-init-failure" });

    await expect(source.initialize()).rejects.toBe(metadataFailure);
    statsSpy.mockRestore();
    await expect(source.terminate()).resolves.toBeUndefined();
    await expect(source.terminate()).resolves.toBeUndefined();

    const reader = new IndexedDbMessageStore({ sessionId: "readonly-init-failure" });
    await reader.init();
    expect((await reader.stats()).count).toBe(1);
    await reader.close();
  });
});
