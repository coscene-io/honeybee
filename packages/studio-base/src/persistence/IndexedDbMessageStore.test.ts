// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";
import race from "race-as-promised";

import { MessageEvent } from "@foxglove/studio";
import {
  CacheSessionMetadata,
  clearIndexedDbMessageStoreDatabase,
  IndexedDbMessageStore,
} from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

function messageEvent(
  seq: number,
  topic = "/topic",
  receiveTime: MessageEvent["receiveTime"] = { sec: 10, nsec: 1 },
): MessageEvent {
  return {
    topic,
    schemaName: "pkg/Msg",
    receiveTime,
    message: { seq },
    sizeInBytes: 10,
  };
}

async function getSessionMetadata(sessionId: string): Promise<CacheSessionMetadata | undefined> {
  const db = await IDB.openDB("studio-realtime-cache");
  try {
    const tx = db.transaction("sessions", "readonly");
    const metadata = (await tx.objectStore("sessions").get(sessionId)) as
      | CacheSessionMetadata
      | undefined;
    await tx.done;
    return metadata;
  } finally {
    db.close();
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForStatsCount(
  store: IndexedDbMessageStore,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  let count = 0;
  while (Date.now() < deadline) {
    count = (await store.stats()).count;
    if (count === expectedCount) {
      return;
    }
    await wait(25);
  }
  expect(count).toBe(expectedCount);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for promise"));
    }, timeoutMs);
  });
  try {
    return await race([promise, timeoutPromise]);
  } finally {
    if (timeout != undefined) {
      clearTimeout(timeout);
    }
  }
}

describe("IndexedDbMessageStore", () => {
  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("flushes queued appends on close", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "close-flush" });
    await store.init();

    await store.append([messageEvent(1), messageEvent(2)]);
    await store.close();

    const reader = new IndexedDbMessageStore({ sessionId: "close-flush" });
    await reader.init();
    const messages = await reader.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 1 }, { seq: 2 }]);
    await reader.close();
  });

  it("does not overwrite same timestamp messages after reopening the same session", async () => {
    const first = new IndexedDbMessageStore({ sessionId: "same-timestamp" });
    await first.init();
    await first.append([messageEvent(1)]);
    await first.flush();
    await first.close();

    const second = new IndexedDbMessageStore({ sessionId: "same-timestamp" });
    await second.init();
    await second.append([messageEvent(2)]);
    await second.flush();

    const messages = await second.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 1 }, { seq: 2 }]);
    await second.close();
  });

  it("touches the current session and reports missing sessions", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    const store = new IndexedDbMessageStore({ sessionId: "touch-session" });
    await store.init();

    try {
      expect((await getSessionMetadata("touch-session"))?.lastActiveAt).toBe(1_000);

      nowSpy.mockReturnValue(2_000);
      await expect(store.touchSession()).resolves.toBe(true);
      expect((await getSessionMetadata("touch-session"))?.lastActiveAt).toBe(2_000);

      await store.deleteCurrentSession();
      await expect(store.touchSession()).resolves.toBe(false);
    } finally {
      nowSpy.mockRestore();
      await store.close();
    }
  });

  it("rejects touchSession when IndexedDB open fails", async () => {
    const openDBSpy = jest.spyOn(IDB, "openDB").mockImplementation(
      async () => {
        throw new Error("open failed");
      },
    );
    const store = new IndexedDbMessageStore({ sessionId: "touch-open-error" });

    try {
      await expect(store.touchSession()).rejects.toThrow("open failed");
      (console.error as jest.Mock).mockClear();
    } finally {
      openDBSpy.mockRestore();
      await store.close();
    }
  });

  it("stores datatypes and topic metadata", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "metadata" });
    await store.init();

    const datatypes: RosDatatypes = new Map([
      ["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }],
    ]);
    await store.storeDatatypes(datatypes);
    await store.storeTopics(
      [
        {
          name: "/topic",
          schemaName: "pkg/Msg",
          messageEncoding: "cdr",
          schemaEncoding: "ros2msg",
          schemaData: new Uint8Array([1, 2, 3]),
        },
      ],
      new Map([["/topic", { numMessages: 3 }]]),
    );

    expect(await store.getDatatypes()).toEqual(datatypes);
    expect(await store.getTopics()).toEqual([
      {
        name: "/topic",
        schemaName: "pkg/Msg",
        messageEncoding: "cdr",
        schemaEncoding: "ros2msg",
        schemaData: new Uint8Array([1, 2, 3]),
        topicStats: { numMessages: 3 },
      },
    ]);

    await store.close();
  });

  it("removes stale topic metadata when storing a new topic set", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "topic-sync" });
    await store.init();

    await store.storeTopics([
      { name: "/old", schemaName: "pkg/Msg" },
      { name: "/current", schemaName: "pkg/Msg" },
    ]);
    await store.storeTopics([{ name: "/current", schemaName: "pkg/Msg" }]);

    expect(await store.getTopics()).toEqual([{ name: "/current", schemaName: "pkg/Msg" }]);

    await store.close();
  });

  it("continues scheduled background flushes until the queue is empty", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "multi-batch-background",
      appendBatchMaxSize: 2,
    });
    await store.init();

    try {
      await store.append([messageEvent(1), messageEvent(2), messageEvent(3)]);
      await waitForStatsCount(store, 3);
      expect((await store.stats()).count).toBe(3);
    } finally {
      await store.close();
    }
  });

  it("prunes messages outside the retention window", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "retention-window",
      retentionWindowMs: 1_000,
    });
    await store.init();

    await store.append([
      messageEvent(1, "/topic", { sec: 1, nsec: 0 }),
      messageEvent(2, "/topic", { sec: 3, nsec: 0 }),
    ]);
    await store.flush();

    const messages = await store.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 4, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 2 }]);
    await store.close();
  });

  it("closes the database connection even when close fails to flush pending messages", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "close-flush-error" });
    await store.init();

    await store.append([
      {
        ...messageEvent(1),
        message: { unsupported: () => undefined },
      } as unknown as MessageEvent,
    ]);

    await expect(store.close()).rejects.toThrow();
    (console.warn as jest.Mock).mockClear();

    const upgraded = await withTimeout(
      IDB.openDB("studio-realtime-cache", 3, {
        upgrade(db) {
          db.createObjectStore("close-flush-error-upgrade");
        },
      }),
      500,
    );
    upgraded.close();
  });

  it("clears sessions by kind without deleting other session kinds", async () => {
    const realtime = new IndexedDbMessageStore({ sessionId: "realtime", kind: "realtime-viz" });
    await realtime.init();
    await realtime.append([messageEvent(1)]);
    await realtime.flush();
    await realtime.close();

    const spill = new IndexedDbMessageStore({ sessionId: "spill", kind: "playback-spill" });
    await spill.init();
    await spill.append([messageEvent(2)]);
    await spill.flush();

    await spill.clearSessionsByKind("realtime-viz");

    const realtimeReader = new IndexedDbMessageStore({ sessionId: "realtime" });
    await realtimeReader.init();
    expect((await realtimeReader.stats()).count).toBe(0);
    expect((await spill.stats()).count).toBe(1);

    await realtimeReader.close();
    await spill.close();
  });

  it("flushes pending appends before deleting the current session", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "delete-current-session-drain" });
    await store.init();

    try {
      await store.append([messageEvent(1)]);
      await store.deleteCurrentSession();
      await wait(250);

      expect((await store.stats()).count).toBe(0);

      const db = await IDB.openDB("studio-realtime-cache");
      try {
        const tx = db.transaction(["messages", "sessions"], "readonly");
        await expect(
          tx.objectStore("messages").index("bySession").count(store.getSessionId()),
        ).resolves.toBe(0);
        await expect(tx.objectStore("sessions").get(store.getSessionId())).resolves.toBeUndefined();
        await tx.done;
      } finally {
        db.close();
      }
    } finally {
      await store.close();
    }
  });

  it("does not write messages when the current session metadata is missing", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "missing-session-append",
      kind: "playback-spill",
    });
    await store.init();

    try {
      await store.deleteCurrentSession();
      await store.append([messageEvent(1)]);
      await store.flush();

      const db = await IDB.openDB("studio-realtime-cache");
      try {
        const tx = db.transaction(["messages", "sessions"], "readonly");
        await expect(
          tx.objectStore("messages").index("bySession").count(store.getSessionId()),
        ).resolves.toBe(0);
        await expect(tx.objectStore("sessions").get(store.getSessionId())).resolves.toBeUndefined();
        await tx.done;
      } finally {
        db.close();
      }
    } finally {
      await store.close();
    }
  });

  it("cleanupOldSessions keeps fresh playback spill sessions and deletes stale ones", async () => {
    const stale = new IndexedDbMessageStore({
      sessionId: "stale-session",
      kind: "playback-spill",
    });
    await stale.init();
    await stale.append([messageEvent(1)]);
    await stale.flush();
    await stale.close();

    const fresh = new IndexedDbMessageStore({
      sessionId: "fresh-session",
      kind: "playback-spill",
    });
    await fresh.init();
    await fresh.append([messageEvent(2)]);
    await fresh.flush();
    await fresh.close();

    const realtime = new IndexedDbMessageStore({
      sessionId: "fresh-realtime",
      kind: "realtime-viz",
    });
    await realtime.init();
    await realtime.append([messageEvent(3)]);
    await realtime.flush();
    await realtime.close();

    const db = await IDB.openDB("studio-realtime-cache");
    try {
      const tx = db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const staleMetadata = (await store.get("stale-session")) as CacheSessionMetadata;
      const freshMetadata = (await store.get("fresh-session")) as CacheSessionMetadata;
      const realtimeMetadata = (await store.get("fresh-realtime")) as CacheSessionMetadata;
      await store.put({ ...staleMetadata, lastActiveAt: 1_000 });
      await store.put({ ...freshMetadata, lastActiveAt: 9_500 });
      await store.put({ ...realtimeMetadata, lastActiveAt: 1_000 });
      await tx.done;
    } finally {
      db.close();
    }

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const cleaner = new IndexedDbMessageStore({
      sessionId: "stale-cleaner",
      kind: "playback-spill",
    });

    let staleReader: IndexedDbMessageStore | undefined;
    let freshReader: IndexedDbMessageStore | undefined;
    let realtimeReader: IndexedDbMessageStore | undefined;
    try {
      await cleaner.init();
      await cleaner.cleanupOldSessions("playback-spill", 5_000);
      staleReader = new IndexedDbMessageStore({
        sessionId: "stale-session",
        kind: "playback-spill",
      });
      await staleReader.init();
      freshReader = new IndexedDbMessageStore({
        sessionId: "fresh-session",
        kind: "playback-spill",
      });
      await freshReader.init();
      realtimeReader = new IndexedDbMessageStore({
        sessionId: "fresh-realtime",
        kind: "realtime-viz",
      });
      await realtimeReader.init();

      await expect(
        staleReader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
        }),
      ).resolves.toHaveLength(0);
      await expect(
        freshReader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
        }),
      ).resolves.toHaveLength(1);
      await expect(
        realtimeReader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
        }),
      ).resolves.toHaveLength(1);
    } finally {
      await staleReader?.deleteCurrentSession();
      await freshReader?.deleteCurrentSession();
      await realtimeReader?.deleteCurrentSession();
      await cleaner.deleteCurrentSession();
      await staleReader?.close();
      await freshReader?.close();
      await realtimeReader?.close();
      await cleaner.close();
      nowSpy.mockRestore();
    }
  });

  it("skips cleanup when a scanned stale session is touched before deletion", async () => {
    const stale = new IndexedDbMessageStore({
      sessionId: "stale-then-touched",
      kind: "playback-spill",
    });
    await stale.init();
    await stale.append([messageEvent(1)]);
    await stale.flush();
    await stale.close();

    const db = await IDB.openDB("studio-realtime-cache");
    try {
      const tx = db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const metadata = (await store.get("stale-then-touched")) as CacheSessionMetadata;
      await store.put({ ...metadata, lastActiveAt: 1_000 });
      await tx.done;
    } finally {
      db.close();
    }

    const originalOpenDB = IDB.openDB;
    let touchedAfterScan = false;
    const openDBSpy = jest.spyOn(IDB, "openDB").mockImplementation(
      async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (touchedAfterScan || args[0] !== "studio-realtime-cache") {
          return openedDb;
        }

        return new Proxy(openedDb, {
          get(target, prop, receiver) {
            if (prop !== "transaction") {
              const value = Reflect.get(target, prop, receiver) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            }

            return (storeNames: unknown, mode?: unknown, options?: unknown) => {
              const tx = target.transaction(
                storeNames as Parameters<typeof target.transaction>[0],
                mode as Parameters<typeof target.transaction>[1],
                options as Parameters<typeof target.transaction>[2],
              );
              if (storeNames !== "sessions" || mode !== "readonly") {
                return tx;
              }

              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "done") {
                    return txTarget.done.then(async () => {
                      if (touchedAfterScan) {
                        return;
                      }
                      touchedAfterScan = true;
                      const touchTx = target.transaction("sessions", "readwrite");
                      const session = (await touchTx.store.get(
                        "stale-then-touched",
                      )) as CacheSessionMetadata;
                      await touchTx.store.put({
                        ...session,
                        lastActiveAt: 9_500,
                      });
                      await touchTx.done;
                    });
                  }

                  const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              });
            };
          },
        });
      },
    );

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const cleaner = new IndexedDbMessageStore({
      sessionId: "stale-touch-cleaner",
      kind: "playback-spill",
    });
    let reader: IndexedDbMessageStore | undefined;
    try {
      await cleaner.init();
      await cleaner.cleanupOldSessions("playback-spill", 5_000);
      expect(touchedAfterScan).toBe(true);

      reader = new IndexedDbMessageStore({
        sessionId: "stale-then-touched",
        kind: "playback-spill",
      });
      await reader.init();
      await expect(
        reader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
        }),
      ).resolves.toHaveLength(1);
    } finally {
      await reader?.deleteCurrentSession();
      await cleaner.deleteCurrentSession();
      await reader?.close();
      await cleaner.close();
      nowSpy.mockRestore();
      openDBSpy.mockRestore();
    }
  });

  it("drops v1 cache data during migration and remains writable", async () => {
    await IDB.deleteDB("studio-realtime-cache");

    const v1 = await IDB.openDB("studio-realtime-cache", 1, {
      upgrade(db) {
        const store = db.createObjectStore("messages", {
          keyPath: ["sessionId", "receiveTime.sec", "receiveTime.nsec", "seq"],
        });
        store.createIndex("bySessionTime", ["sessionId", "receiveTime.sec", "receiveTime.nsec"]);
        store.createIndex("bySessionTopicTime", [
          "sessionId",
          "topic",
          "receiveTime.sec",
          "receiveTime.nsec",
        ]);
        store.createIndex("bySession", "sessionId");
        db.createObjectStore("datatypes", { keyPath: "sessionId" });
        db.createObjectStore("sessions", { keyPath: "sessionId" });
      },
    });
    const tx = v1.transaction(["messages", "sessions"], "readwrite");
    await tx.objectStore("sessions").put({
      sessionId: "v1",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    await tx.objectStore("messages").put({
      ...messageEvent(1),
      sessionId: "v1",
      seq: 0,
    });
    await tx.done;
    v1.close();

    const store = new IndexedDbMessageStore({ sessionId: "v2" });
    await store.init();
    await store.append([messageEvent(2)]);
    await store.flush();

    expect((await store.stats()).count).toBe(1);

    const oldReader = new IndexedDbMessageStore({ sessionId: "v1" });
    await oldReader.init();
    expect((await oldReader.stats()).count).toBe(0);

    await oldReader.close();
    await store.close();
  });

  it("times out blocked initialization", async () => {
    await IDB.deleteDB("studio-realtime-cache");

    const blocker = await IDB.openDB("studio-realtime-cache", 1, {
      upgrade(db) {
        db.createObjectStore("blocker");
      },
    });

    const store = new IndexedDbMessageStore({ sessionId: "blocked", openTimeoutMs: 10 });

    await expect(store.init()).rejects.toThrow("Timed out opening IndexedDbMessageStore");
    (console.error as jest.Mock).mockClear();
    (console.warn as jest.Mock).mockClear();
    blocker.close();
  });

  it("bounds the append queue by dropping the oldest queued messages", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "bounded-queue",
      maxQueuedMessages: 2,
      openTimeoutMs: 1000,
    });

    await store.append([messageEvent(1), messageEvent(2), messageEvent(3)]);
    await store.init();
    await store.flush();

    const messages = await store.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 2 }, { seq: 3 }]);
    (console.warn as jest.Mock).mockClear();
    await store.close();
  });

  it("merges loaded ranges and detects complete coverage", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    const store = new IndexedDbMessageStore({
      sessionId: "loaded-ranges",
      kind: "playback-spill",
    });
    await store.init();

    nowSpy.mockReturnValue(2_000);
    await store.putLoadedRange({
      sessionId: store.getSessionId(),
      topicFingerprint: "topics",
      start: { sec: 1, nsec: 0 },
      end: { sec: 2, nsec: 0 },
    });
    await store.putLoadedRange({
      sessionId: store.getSessionId(),
      topicFingerprint: "topics",
      start: { sec: 2, nsec: 1 },
      end: { sec: 3, nsec: 0 },
    });

    expect(await store.getLoadedRanges("topics")).toEqual([
      expect.objectContaining({
        sessionId: "loaded-ranges",
        topicFingerprint: "topics",
        start: { sec: 1, nsec: 0 },
        end: { sec: 3, nsec: 0 },
      }),
    ]);
    await expect(
      store.hasLoadedRange({
        topicFingerprint: "topics",
        start: { sec: 1, nsec: 500 },
        end: { sec: 2, nsec: 500 },
      }),
    ).resolves.toBe(true);
    await expect(
      store.hasLoadedRange({
        topicFingerprint: "topics",
        start: { sec: 0, nsec: 0 },
        end: { sec: 2, nsec: 0 },
      }),
    ).resolves.toBe(false);
    expect((await getSessionMetadata("loaded-ranges"))?.lastActiveAt).toBe(2_000);

    nowSpy.mockRestore();
    await store.close();
  });

  it("clears playback spill loaded ranges after append pruning", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "spill-loaded-ranges-append-prune",
      kind: "playback-spill",
      maxCacheSize: 20,
    });
    await store.init();

    await store.putLoadedRange({
      sessionId: store.getSessionId(),
      topicFingerprint: "topics",
      start: { sec: 1, nsec: 0 },
      end: { sec: 3, nsec: 0 },
    });
    await expect(
      store.hasLoadedRange({
        topicFingerprint: "topics",
        start: { sec: 1, nsec: 0 },
        end: { sec: 3, nsec: 0 },
      }),
    ).resolves.toBe(true);

    await store.append([
      messageEvent(1, "/topic", { sec: 1, nsec: 0 }),
      messageEvent(2, "/topic", { sec: 2, nsec: 0 }),
      messageEvent(3, "/topic", { sec: 3, nsec: 0 }),
    ]);
    await store.flush();

    expect((await store.stats()).count).toBeLessThan(3);
    expect(await store.getLoadedRanges("topics")).toEqual([]);
    await expect(
      store.hasLoadedRange({
        topicFingerprint: "topics",
        start: { sec: 1, nsec: 0 },
        end: { sec: 3, nsec: 0 },
      }),
    ).resolves.toBe(false);

    await store.close();
  });

  it("clears playback spill loaded ranges after force pruning", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "spill-loaded-ranges-force-prune",
      kind: "playback-spill",
      retentionWindowMs: 1,
    });
    await store.init();

    await store.append([messageEvent(1, "/topic", { sec: 1, nsec: 0 })]);
    await store.flush();
    await store.putLoadedRange({
      sessionId: store.getSessionId(),
      topicFingerprint: "topics",
      start: { sec: 1, nsec: 0 },
      end: { sec: 2, nsec: 0 },
    });

    const result = await store.forcePrune();

    expect(result.prunedCount).toBe(1);
    expect(await store.getLoadedRanges("topics")).toEqual([]);

    await store.close();
  });

  it("does not expose internal session fields when reading messages", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "restore-event",
      kind: "playback-spill",
    });
    await store.init();
    await store.append([messageEvent(1)]);
    await store.flush();

    const messages = await store.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });
    expect(messages).toEqual([messageEvent(1)]);

    const backfill = await store.getBackfillMessages({
      topics: ["/topic"],
      time: { sec: 20, nsec: 0 },
    });
    expect(backfill).toEqual([messageEvent(1)]);

    await store.close();
  });
});
