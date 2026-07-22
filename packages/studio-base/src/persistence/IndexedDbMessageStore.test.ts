// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";
import race from "race-as-promised";

import { MessageEvent } from "@foxglove/studio";
import {
  type CacheSessionKind,
  type CacheSessionMetadata,
  clearIndexedDbMessageStoreDatabase,
  indexedDbMessageCacheApi,
  IndexedDbMessageStore,
  LEGACY_MESSAGE_CACHE_DB_NAME,
  PLAYBACK_MESSAGE_CACHE_DB_NAME,
  REALTIME_MESSAGE_CACHE_DB_NAME,
  scheduleLegacyMessageCacheDatabaseDeletion,
  scheduleMessageCacheMaintenance,
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

function databaseNameForKind(kind: CacheSessionKind): string {
  return kind === "playback-spill"
    ? PLAYBACK_MESSAGE_CACHE_DB_NAME
    : REALTIME_MESSAGE_CACHE_DB_NAME;
}

async function getSessionMetadata(
  sessionId: string,
  kind: CacheSessionKind = "realtime-viz",
): Promise<CacheSessionMetadata | undefined> {
  const db = await IDB.openDB(databaseNameForKind(kind));
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

async function waitForSessionDeletion(sessionId: string, kind: CacheSessionKind): Promise<void> {
  const deadline = Date.now() + 1_000;
  let metadata = await getSessionMetadata(sessionId, kind);
  while (metadata != undefined && Date.now() < deadline) {
    await wait(25);
    metadata = await getSessionMetadata(sessionId, kind);
  }
  expect(metadata).toBeUndefined();
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

  it("allocates distinct message keys for concurrent writers of the same session", async () => {
    const first = new IndexedDbMessageStore({ sessionId: "concurrent-same-session" });
    const second = new IndexedDbMessageStore({ sessionId: "concurrent-same-session" });
    await Promise.all([first.init(), second.init()]);

    try {
      await Promise.all([first.append([messageEvent(1)]), second.append([messageEvent(2)])]);
      await Promise.all([first.flush(), second.flush()]);

      const db = await IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME);
      try {
        const tx = db.transaction(["messages", "sessions"], "readonly");
        const messages = await tx
          .objectStore("messages")
          .index("bySession")
          .getAll("concurrent-same-session");
        const metadata = await tx.objectStore("sessions").get("concurrent-same-session");
        await tx.done;

        expect(messages.map((message) => message.message)).toEqual(
          expect.arrayContaining([{ seq: 1 }, { seq: 2 }]),
        );
        expect(messages).toHaveLength(2);
        expect(metadata).toMatchObject({ messageCount: 2, nextSeq: 2 });
      } finally {
        db.close();
      }
    } finally {
      await Promise.allSettled([first.close(), second.close()]);
    }
  });

  it("keeps a shared session active when one connection closes", async () => {
    const first = new IndexedDbMessageStore({ sessionId: "shared-session-close" });
    const second = new IndexedDbMessageStore({ sessionId: "shared-session-close" });
    await Promise.all([first.init(), second.init()]);

    await first.close();
    try {
      await second.append([messageEvent(1)]);
      await second.flush();
      await expect(getSessionMetadata("shared-session-close")).resolves.toMatchObject({
        status: "active",
        messageCount: 1,
      });
    } finally {
      await second.close();
    }
  });

  it("does not revive a shared session after another connection seals it", async () => {
    const sessionId = "shared-session-sealed";
    const first = new IndexedDbMessageStore({ sessionId });
    const second = new IndexedDbMessageStore({ sessionId });
    await Promise.all([first.init(), second.init()]);

    await first.discardAndSeal("pending-delete");
    await second.close();

    await expect(getSessionMetadata(sessionId)).resolves.toMatchObject({
      status: "pending-delete",
    });
  });

  it("does not downgrade an abandoned shared session when another connection closes", async () => {
    const sessionId = "shared-session-abandoned";
    const first = new IndexedDbMessageStore({ sessionId });
    const second = new IndexedDbMessageStore({ sessionId });
    await Promise.all([first.init(), second.init()]);

    await first.discardAndSeal("abandoned");
    await second.close();

    await expect(getSessionMetadata(sessionId)).resolves.toMatchObject({ status: "abandoned" });
  });

  it("upgrades an in-flight close to a discard without starting a second shutdown", async () => {
    const sessionId = "close-upgraded-to-discard";
    const store = new IndexedDbMessageStore({ sessionId });
    await store.init();
    await store.append([messageEvent(1)]);

    const closePromise = store.close();
    const discardPromise = store.discardAndSeal("pending-delete");

    expect(discardPromise).toBe(closePromise);
    await closePromise;
    await expect(getSessionMetadata(sessionId)).resolves.toMatchObject({
      status: "pending-delete",
    });
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
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async () => {
        throw new Error("open failed");
      });
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

  it("does not recreate metadata after the owning session is deleted", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "deleted-metadata-owner" });
    await store.init();

    try {
      await store.deleteCurrentSession();
      await expect(store.storeTopics([{ name: "/orphan", schemaName: "pkg/Msg" }])).rejects.toThrow(
        "session is no longer active",
      );
      await expect(
        store.storeDatatypes(
          new Map([["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }]]),
        ),
      ).rejects.toThrow("session is no longer active");

      const db = await IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME);
      try {
        const tx = db.transaction(["topics", "datatypes"], "readonly");
        await expect(tx.objectStore("topics").count()).resolves.toBe(0);
        await expect(tx.objectStore("datatypes").count()).resolves.toBe(0);
        await tx.done;
      } finally {
        db.close();
      }
    } finally {
      await store.close();
    }
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
      IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME, 2, {
        upgrade(db) {
          db.createObjectStore("close-flush-error-upgrade");
        },
      }),
      500,
    );
    upgraded.close();
  });

  it("isolates realtime and playback sessions in separate physical databases", async () => {
    const realtime = new IndexedDbMessageStore({ sessionId: "realtime", kind: "realtime-viz" });
    await realtime.init();
    await realtime.append([messageEvent(1)]);
    await realtime.flush();

    const spill = new IndexedDbMessageStore({ sessionId: "spill", kind: "playback-spill" });
    await spill.init();
    await spill.append([messageEvent(2)]);
    await spill.flush();

    await realtime.clearSessionsByKind("realtime-viz");

    expect((await realtime.stats()).count).toBe(0);
    expect((await spill.stats()).count).toBe(1);

    await realtime.close();
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

      const db = await IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME);
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
      await expect(store.flush()).rejects.toThrow("session is no longer active");
      expect(store.isWritable()).toBe(false);
      jest.mocked(console.warn).mockClear();

      const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
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
      await store.discardAndSeal("abandoned");
    }
  });

  it("discards queued messages and seals the session without flushing", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "discard-pending-writes",
      kind: "playback-spill",
    });
    await store.init();
    await wait(0);
    await store.append([messageEvent(1)]);

    await store.discardAndSeal("pending-delete");

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    try {
      const tx = db.transaction(["messages", "sessions"], "readonly");
      await expect(
        tx.objectStore("messages").index("bySession").count("discard-pending-writes"),
      ).resolves.toBe(0);
      await expect(tx.objectStore("sessions").get("discard-pending-writes")).resolves.toEqual(
        expect.objectContaining({ status: "pending-delete" }),
      );
      await tx.done;
    } finally {
      db.close();
    }
  });

  it("does not revive a session after cleanup has sealed it", async () => {
    const sessionId = "sealed-session-reopen";
    const first = new IndexedDbMessageStore({ sessionId, kind: "realtime-viz" });
    await first.init();
    await first.discardAndSeal("pending-delete");

    const reopened = new IndexedDbMessageStore({ sessionId, kind: "realtime-viz" });
    try {
      await expect(reopened.init()).rejects.toThrow("pending cleanup and cannot be reopened");
      expect(reopened.isWritable()).toBe(false);
      jest.mocked(console.error).mockClear();
    } finally {
      await reopened.close();
    }
  });

  it("uses the larger of declared and estimated message sizes", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "estimated-message-size" });
    await store.init();

    try {
      await store.append([messageEvent(1), messageEvent(2)], {
        estimatedSizeBytes: [5, 25],
      });
      await store.flush();

      expect((await store.stats()).approximateSizeBytes).toBe(35);
      expect((await getSessionMetadata("estimated-message-size"))?.approximateSizeBytes).toBe(35);

      const db = await IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME);
      try {
        const tx = db.transaction("messages", "readonly");
        const storedMessages = await tx.objectStore("messages").getAll();
        expect(storedMessages.map((message) => message.estimatedCacheBytes)).toEqual([10, 25]);
        await tx.done;
      } finally {
        db.close();
      }
    } finally {
      await store.close();
    }
  });

  it("rejects mismatched, negative, and non-finite message size estimates", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "invalid-message-size" });
    await store.init();

    try {
      await expect(store.append([messageEvent(1)], { estimatedSizeBytes: [] })).rejects.toThrow(
        "estimatedSizeBytes length must match events length",
      );

      for (const invalidEstimate of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          store.append([messageEvent(1)], { estimatedSizeBytes: [invalidEstimate] }),
        ).rejects.toThrow("must be a finite, non-negative number");
      }

      for (const invalidSize of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          store.append([{ ...messageEvent(1), sizeInBytes: invalidSize }]),
        ).rejects.toThrow("must be a finite, non-negative number");
      }
      expect((await store.stats()).count).toBe(0);
    } finally {
      await store.close();
    }
  });

  it("does not hydrate a persisted range larger than the caller memory budget", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "bounded-hydration",
      kind: "playback-spill",
    });
    try {
      await store.init();
      await store.append([messageEvent(1), messageEvent(2)], {
        estimatedSizeBytes: [10, 25],
      });
      await store.flush();

      await expect(
        store.getMessagesWithinSize({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
          maxEstimatedBytes: 34,
        }),
      ).resolves.toBeUndefined();
      await expect(
        store.getMessagesWithinSize({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
          maxEstimatedBytes: 35,
        }),
      ).resolves.toHaveLength(2);
    } finally {
      await store.close();
    }
  });

  it("paginates same-timestamp messages without duplicates or topic-filter gaps", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "message-pagination",
      kind: "playback-spill",
    });
    try {
      await store.init();
      await store.append(
        [
          messageEvent(1, "/selected", { sec: 10, nsec: 1 }),
          messageEvent(2, "/other", { sec: 10, nsec: 1 }),
          messageEvent(3, "/selected", { sec: 10, nsec: 1 }),
          messageEvent(4, "/selected", { sec: 11, nsec: 0 }),
        ],
        { estimatedSizeBytes: [10, 10, 10, 10] },
      );
      await store.flush();

      const first = await store.getMessagesPage({
        start: { sec: 0, nsec: 0 },
        end: { sec: 20, nsec: 0 },
        topics: ["/selected"],
        maxEstimatedBytes: 10,
      });
      expect(first).toMatchObject({ complete: false });
      expect(first?.messages.map((message) => message.message)).toEqual([{ seq: 1 }]);
      expect(first?.nextCursor).toEqual({ receiveTime: { sec: 10, nsec: 1 }, seq: 1 });

      const second = await store.getMessagesPage({
        start: { sec: 0, nsec: 0 },
        end: { sec: 20, nsec: 0 },
        topics: ["/selected"],
        maxEstimatedBytes: 10,
        after: first?.nextCursor,
      });
      expect(second).toMatchObject({ complete: false });
      expect(second?.messages.map((message) => message.message)).toEqual([{ seq: 3 }]);

      const third = await store.getMessagesPage({
        start: { sec: 0, nsec: 0 },
        end: { sec: 20, nsec: 0 },
        topics: ["/selected"],
        maxEstimatedBytes: 10,
        after: second?.nextCursor,
      });
      expect(third).toMatchObject({ complete: true });
      expect(third?.nextCursor).toBeUndefined();
      expect(third?.messages.map((message) => message.message)).toEqual([{ seq: 4 }]);
    } finally {
      await store.close();
    }
  });

  it("validates queue and transaction batch limits", () => {
    expect(
      () => new IndexedDbMessageStore({ sessionId: "invalid-queue", maxQueuedMessages: 0 }),
    ).toThrow("maxQueuedMessages must be a positive safe integer");
    expect(
      () => new IndexedDbMessageStore({ sessionId: "invalid-batch", appendBatchMaxSize: 0 }),
    ).toThrow("appendBatchMaxSize must be a positive safe integer");
    expect(
      () => new IndexedDbMessageStore({ sessionId: "invalid-batch-bytes", appendBatchMaxBytes: 0 }),
    ).toThrow("appendBatchMaxBytes must be positive");
    expect(
      () =>
        new IndexedDbMessageStore({
          sessionId: "invalid-queue-bytes",
          appendBatchMaxBytes: 100,
          maxQueuedBytes: 99,
        }),
    ).toThrow("maxQueuedBytes must be at least appendBatchMaxBytes");
    expect(
      () => new IndexedDbMessageStore({ sessionId: "invalid-shutdown", shutdownTimeoutMs: 0 }),
    ).toThrow("shutdownTimeoutMs must be a finite, positive number");
    expect(
      () =>
        new IndexedDbMessageStore({
          sessionId: "invalid-maintenance",
          maintenanceTimeoutMs: Number.POSITIVE_INFINITY,
        }),
    ).toThrow("maintenanceTimeoutMs must be a finite, positive number");
  });

  it("caps append transactions by estimated bytes and rechecks the budget every 64 MiB", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    const estimate = jest.fn().mockResolvedValue({ quota: 100 * 1024 ** 3, usage: 0 });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate },
    });
    const store = new IndexedDbMessageStore({
      sessionId: "byte-bounded-append-transactions",
      kind: "playback-spill",
    });

    try {
      await store.init();
      await store.append([messageEvent(1), messageEvent(2), messageEvent(3)], {
        estimatedSizeBytes: [40 * 1024 ** 2, 40 * 1024 ** 2, 40 * 1024 ** 2],
      });
      await store.flush();

      // Initialization establishes the time baseline; the second 40 MiB transaction crosses the
      // 64 MiB byte threshold and triggers the only periodic estimate.
      expect(estimate).toHaveBeenCalledTimes(2);
      expect((await store.stats()).count).toBe(3);
    } finally {
      await store.close();
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
    }
  });

  it("does not apply one session's small cap as the global database budget", async () => {
    const retained = new IndexedDbMessageStore({ sessionId: "retained-other-session" });
    await retained.init();
    await retained.append([messageEvent(1)]);
    await retained.flush();
    await retained.close();

    const tiny = new IndexedDbMessageStore({
      sessionId: "tiny-session-cap",
      maxCacheSize: 1,
    });
    try {
      await tiny.init();
      await tiny.append([messageEvent(2)]);
      await tiny.flush();

      expect(await getSessionMetadata("retained-other-session")).toBeDefined();
      const db = await IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME);
      try {
        const tx = db.transaction("messages", "readonly");
        await expect(tx.store.index("bySession").count("retained-other-session")).resolves.toBe(1);
        await tx.done;
      } finally {
        db.close();
      }
    } finally {
      await tiny.close();
    }
  });

  it("prunes a single session to the global 80 percent low watermark", async () => {
    const globalFallbackBudget = 512 * 1024 ** 2;
    const store = new IndexedDbMessageStore({
      sessionId: "global-low-watermark",
      retentionWindowMs: Number.MAX_SAFE_INTEGER,
    });

    try {
      await store.init();
      for (let index = 0; index < 9; index++) {
        await store.append([messageEvent(1)], { estimatedSizeBytes: [64 * 1024 ** 2] });
        await store.flush();
      }

      const approximateSizeBytes = (await store.stats()).approximateSizeBytes ?? 0;
      expect(approximateSizeBytes).toBeLessThanOrEqual(globalFallbackBudget * 0.8);
      expect(approximateSizeBytes).toBeGreaterThan(0);
    } finally {
      await store.close();
    }
  });

  it("fails closed instead of writing one message above the transaction byte limit", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "oversized-single-message",
      kind: "playback-spill",
    });

    try {
      await store.init();
      await expect(
        store.append([messageEvent(1)], { estimatedSizeBytes: [64 * 1024 ** 2 + 1] }),
      ).rejects.toThrow("exceeds the 67108864-byte append transaction limit");
      expect(store.isWritable()).toBe(false);
      expect((await store.stats()).count).toBe(0);
    } finally {
      await store.discardAndSeal("abandoned");
      jest.mocked(console.warn).mockClear();
    }
  });

  it("aborts an append that exceeds the session sealing deadline", async () => {
    const originalOpenDB = IDB.openDB;
    let signalAppendStarted: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => {
      signalAppendStarted = resolve;
    });
    let rejectTransaction: ((error: Error) => void) | undefined;
    const abort = jest.fn(() => {
      rejectTransaction?.(new Error("aborted stalled append transaction"));
    });
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (args[0] !== REALTIME_MESSAGE_CACHE_DB_NAME) {
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
              if (
                !Array.isArray(storeNames) ||
                !storeNames.includes("messages") ||
                !storeNames.includes("sessions") ||
                mode !== "readwrite"
              ) {
                return tx;
              }

              const stalledDone = new Promise<void>((_resolve, reject) => {
                rejectTransaction = reject;
                signalAppendStarted?.();
              });
              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "done") {
                    return stalledDone;
                  }
                  if (txProp === "abort") {
                    return abort;
                  }
                  const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              });
            };
          },
        });
      });
    const store = new IndexedDbMessageStore({
      sessionId: "stalled-append-seal",
      shutdownTimeoutMs: 25,
    });

    try {
      await store.init();
      await store.append([messageEvent(1)]);
      const flushPromise = store.flush();
      void flushPromise.catch(() => undefined);
      await appendStarted;

      await withTimeout(store.discardAndSeal("pending-delete"), 250);
      expect(abort).toHaveBeenCalledTimes(1);
      await expect(flushPromise).rejects.toThrow("aborted stalled append transaction");
      expect(store.isWritable()).toBe(false);
      expect(await getSessionMetadata("stalled-append-seal")).toMatchObject({
        status: "abandoned",
      });
      (console.warn as jest.Mock).mockClear();
    } finally {
      openDBSpy.mockRestore();
      await store.close();
      (console.warn as jest.Mock).mockClear();
    }
  });

  it("aborts an active readonly transaction when sealing exceeds its deadline", async () => {
    const originalOpenDB = IDB.openDB;
    let stallReads = false;
    let signalReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      signalReadStarted = resolve;
    });
    let rejectTransaction: ((error: Error) => void) | undefined;
    const abort = jest.fn(() => {
      rejectTransaction?.(new Error("aborted stalled readonly transaction"));
    });
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (args[0] !== PLAYBACK_MESSAGE_CACHE_DB_NAME) {
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
              if (
                !stallReads ||
                !Array.isArray(storeNames) ||
                !storeNames.includes("messages") ||
                !storeNames.includes("sessions") ||
                mode !== "readonly"
              ) {
                return tx;
              }
              const stalledDone = new Promise<void>((_resolve, reject) => {
                rejectTransaction = reject;
                signalReadStarted?.();
              });
              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "done") {
                    return stalledDone;
                  }
                  if (txProp === "abort") {
                    return abort;
                  }
                  const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              });
            };
          },
        });
      });
    const store = new IndexedDbMessageStore({
      sessionId: "stalled-read-seal",
      kind: "playback-spill",
      shutdownTimeoutMs: 25,
    });

    try {
      await store.init();
      stallReads = true;
      const readPromise = store.getMessagesPage({
        start: { sec: 0, nsec: 0 },
        end: { sec: 1, nsec: 0 },
        maxEstimatedBytes: 1024,
      });
      void readPromise.catch(() => undefined);
      await readStarted;

      await withTimeout(store.discardAndSeal("pending-delete"), 250);
      expect(abort).toHaveBeenCalledTimes(1);
      await expect(readPromise).rejects.toThrow("aborted stalled readonly transaction");
      expect(await getSessionMetadata("stalled-read-seal", "playback-spill")).toMatchObject({
        status: "abandoned",
      });
      jest.mocked(console.warn).mockClear();
    } finally {
      openDBSpy.mockRestore();
      await store.close();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("does not accept realtime writes until session initialization finishes", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    let resolveEstimate: ((estimate: StorageEstimate) => void) | undefined;
    let isFirstEstimate = true;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async (): Promise<StorageEstimate> => {
          if (!isFirstEstimate) {
            return { quota: 10 * 1024 ** 3, usage: 0 };
          }
          isFirstEstimate = false;
          return await new Promise<StorageEstimate>((resolve) => {
            resolveEstimate = resolve;
          });
        },
      },
    });
    const store = new IndexedDbMessageStore({ sessionId: "append-waits-for-init" });

    try {
      let appendFinished = false;
      const appendPromise = store.append([messageEvent(1)]).then(() => {
        appendFinished = true;
      });
      await wait(250);
      expect(appendFinished).toBe(false);

      resolveEstimate?.({ quota: 10 * 1024 ** 3, usage: 0 });
      await appendPromise;
      await store.flush();
      expect((await store.stats()).count).toBe(1);
    } finally {
      await store.close();
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
    }
  });

  it("prunes the current session toward origin recovery under storage pressure", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    const estimate = jest.fn();
    const quota = 10 * 1024 ** 3;
    estimate
      .mockResolvedValueOnce({ quota, usage: 0 })
      .mockResolvedValue({ quota, usage: quota * 0.85 });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate },
    });
    const store = new IndexedDbMessageStore({
      sessionId: "pressure-prunes-current",
      kind: "playback-spill",
    });

    try {
      await store.init();
      await store.append([messageEvent(1)], {
        estimatedSizeBytes: [64 * 1024 ** 2],
      });
      await store.flush();

      expect(store.isWritable()).toBe(false);
      expect((await store.stats()).count).toBe(0);
    } finally {
      await store.close();

      // Clear the process-wide pressure latch for later tests.
      estimate.mockResolvedValue({ quota, usage: 0 });
      const latchReset = new IndexedDbMessageStore({
        sessionId: "pressure-prune-latch-reset",
        kind: "playback-spill",
      });
      await latchReset.init();
      await latchReset.close();
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
    }
  });

  it("does not let a stalled periodic storage estimate hang flush or close", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    const quota = 10 * 1024 ** 3;
    let signalPeriodicEstimateStarted: (() => void) | undefined;
    const periodicEstimateStarted = new Promise<void>((resolve) => {
      signalPeriodicEstimateStarted = resolve;
    });
    const estimate = jest
      .fn<Promise<StorageEstimate>, []>()
      .mockResolvedValueOnce({ quota, usage: 0 })
      .mockImplementationOnce(async () => {
        signalPeriodicEstimateStarted?.();
        return await new Promise<StorageEstimate>(() => undefined);
      })
      .mockResolvedValue({ quota, usage: 0 });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate },
    });
    const store = new IndexedDbMessageStore({
      sessionId: "stalled-periodic-storage-estimate",
      kind: "playback-spill",
    });

    try {
      await store.init();
      await store.append([messageEvent(1)], {
        estimatedSizeBytes: [64 * 1024 ** 2],
      });

      const flushPromise = store.flush();
      await withTimeout(periodicEstimateStarted, 2_000);
      const closePromise = store.close();

      await withTimeout(Promise.all([flushPromise, closePromise]), 3_000);
      expect(estimate).toHaveBeenCalledTimes(2);
      expect(store.isWritable()).toBe(false);

      const metricSink = jest.fn();
      const pressureProbe = new IndexedDbMessageStore({
        kind: "playback-spill",
        accessMode: "maintenance",
        metricSink,
      });
      await pressureProbe.init();
      expect(metricSink).toHaveBeenCalledWith(
        "storage",
        expect.objectContaining({ writesDisabled: false }),
      );
      await pressureProbe.close();
    } finally {
      await store.close();
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
    }
  });

  it("derives per-kind budgets from quota and disables undersized spill caches", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    const estimate = jest.fn();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate },
    });

    try {
      estimate.mockResolvedValue({ quota: 100 * 1024 ** 3, usage: 0 });
      const playback = new IndexedDbMessageStore({
        sessionId: "playback-adaptive-budget",
        kind: "playback-spill",
      });
      await playback.init();
      expect(playback.getMaxCacheSize()).toBe(8 * 1024 ** 3);
      await playback.close();

      const realtime = new IndexedDbMessageStore({ sessionId: "realtime-adaptive-budget" });
      await realtime.init();
      expect(realtime.getMaxCacheSize()).toBe(2 * 1024 ** 3);
      await realtime.close();

      estimate.mockResolvedValue({ quota: 1024 ** 3, usage: 0 });
      const undersizedPlayback = new IndexedDbMessageStore({
        sessionId: "playback-undersized-budget",
        kind: "playback-spill",
      });
      await undersizedPlayback.init();
      expect(undersizedPlayback.getMaxCacheSize()).toBeCloseTo(0.1 * 1024 ** 3);
      expect(undersizedPlayback.isWritable()).toBe(false);
      await expect(undersizedPlayback.append([messageEvent(1)])).rejects.toThrow("is not writable");
      expect((await undersizedPlayback.stats()).count).toBe(0);
      await undersizedPlayback.close();
    } finally {
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
    }
  });

  it("applies concurrent storage estimates independently for each cache kind", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    let resolvePlaybackEstimate: ((estimate: StorageEstimate) => void) | undefined;
    let resolveRealtimeEstimate: ((estimate: StorageEstimate) => void) | undefined;
    let signalPlaybackEstimateStarted: (() => void) | undefined;
    let signalRealtimeEstimateStarted: (() => void) | undefined;
    const playbackEstimateStarted = new Promise<void>((resolve) => {
      signalPlaybackEstimateStarted = resolve;
    });
    const realtimeEstimateStarted = new Promise<void>((resolve) => {
      signalRealtimeEstimateStarted = resolve;
    });
    const estimate = jest
      .fn<Promise<StorageEstimate>, []>()
      .mockImplementationOnce(async () => {
        signalPlaybackEstimateStarted?.();
        return await new Promise<StorageEstimate>((resolve) => {
          resolvePlaybackEstimate = resolve;
        });
      })
      .mockImplementationOnce(async () => {
        signalRealtimeEstimateStarted?.();
        return await new Promise<StorageEstimate>((resolve) => {
          resolveRealtimeEstimate = resolve;
        });
      });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate },
    });

    const playback = new IndexedDbMessageStore({
      sessionId: "concurrent-playback-estimate",
      kind: "playback-spill",
    });
    const playbackInit = playback.init();
    await playbackEstimateStarted;
    const realtime = new IndexedDbMessageStore({ sessionId: "concurrent-realtime-estimate" });
    const realtimeInit = realtime.init();
    await realtimeEstimateStarted;

    try {
      resolveRealtimeEstimate?.({ quota: 100 * 1024 ** 3, usage: 0 });
      resolvePlaybackEstimate?.({ quota: 1024 ** 3, usage: 0 });
      await Promise.all([playbackInit, realtimeInit]);

      expect(playback.getMaxCacheSize()).toBeCloseTo(0.1 * 1024 ** 3);
      expect(playback.isWritable()).toBe(false);
      expect(realtime.getMaxCacheSize()).toBe(2 * 1024 ** 3);
      expect(realtime.isWritable()).toBe(true);
    } finally {
      await Promise.allSettled([playback.close(), realtime.close()]);
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
    }
  });

  it("resumes pressure-disabled writes only in a later session below the low watermark", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    const estimate = jest.fn();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate },
    });

    let pressured: IndexedDbMessageStore | undefined;
    let stillLatched: IndexedDbMessageStore | undefined;
    let recovered: IndexedDbMessageStore | undefined;
    try {
      const quota = 10 * 1024 ** 3;
      estimate.mockResolvedValue({ quota, usage: quota * 0.85 });
      pressured = new IndexedDbMessageStore({
        sessionId: "pressure-high",
        kind: "playback-spill",
      });
      await pressured.init();
      expect(pressured.isWritable()).toBe(false);
      await expect(pressured.append([messageEvent(1)])).rejects.toThrow("is not writable");
      expect((await pressured.stats()).count).toBe(0);
      await pressured.close();
      pressured = undefined;

      estimate.mockResolvedValue({ quota, usage: quota * 0.75 });
      stillLatched = new IndexedDbMessageStore({
        sessionId: "pressure-still-latched",
        kind: "playback-spill",
      });
      await stillLatched.init();
      expect(stillLatched.isWritable()).toBe(false);
      await expect(stillLatched.append([messageEvent(2)])).rejects.toThrow("is not writable");
      expect((await stillLatched.stats()).count).toBe(0);
      await stillLatched.close();
      stillLatched = undefined;

      estimate.mockResolvedValue({ quota, usage: quota * 0.65 });
      recovered = new IndexedDbMessageStore({
        sessionId: "pressure-recovered",
        kind: "playback-spill",
      });
      await recovered.init();
      await recovered.append([messageEvent(3)]);
      await recovered.flush();
      expect((await recovered.stats()).count).toBe(1);
      await recovered.close();
      recovered = undefined;
    } finally {
      await pressured?.close();
      await stillLatched?.close();
      await recovered?.close();

      // A failed assertion must not leak the module-level pressure latch into later tests.
      estimate.mockResolvedValue({ quota: 10 * 1024 ** 3, usage: 0 });
      const latchReset = new IndexedDbMessageStore({
        sessionId: "pressure-latch-reset",
        kind: "playback-spill",
      });
      await latchReset.init();
      await latchReset.close();
      if (originalStorage == undefined) {
        Reflect.deleteProperty(navigator, "storage");
      } else {
        Object.defineProperty(navigator, "storage", originalStorage);
      }
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

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    try {
      const tx = db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const staleMetadata = (await store.get("stale-session")) as CacheSessionMetadata;
      const freshMetadata = (await store.get("fresh-session")) as CacheSessionMetadata;
      await store.put({ ...staleMetadata, lastActiveAt: 1_000 });
      await store.put({ ...freshMetadata, lastActiveAt: 9_500 });
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

  it("does not clean up a stale session while a replay reader holds a fresh lease", async () => {
    const sessionId = "leased-replay-session";
    const seed = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    await seed.init();
    await seed.append([messageEvent(1)]);
    await seed.flush();
    await seed.close();

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    const tx = db.transaction("sessions", "readwrite");
    const metadata = (await tx.store.get(sessionId)) as CacheSessionMetadata;
    await tx.store.put({ ...metadata, lastActiveAt: 1_000 });
    await tx.done;
    db.close();

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const reader = new IndexedDbMessageStore({
      sessionId,
      kind: "playback-spill",
      accessMode: "reader",
    });
    const cleaner = new IndexedDbMessageStore({
      sessionId: "reader-lease-cleaner",
      kind: "playback-spill",
    });
    try {
      await reader.init();
      await cleaner.init();
      await cleaner.cleanupOldSessions("playback-spill", 5_000);

      await expect(
        reader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
        }),
      ).resolves.toHaveLength(1);
      expect(await getSessionMetadata(sessionId, "playback-spill")).toMatchObject({
        status: "closed",
        readers: [expect.any(String)],
      });
    } finally {
      await reader.close();
      await cleaner.close();
      nowSpy.mockRestore();
    }

    expect(await getSessionMetadata(sessionId, "playback-spill")).toMatchObject({ readers: [] });
  });

  it("cleans up a terminal session even while a replay reader lease is fresh", async () => {
    const sessionId = "terminal-reader-session";
    const seed = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    await seed.init();
    await seed.append([messageEvent(1)]);
    await seed.flush();
    await seed.close();

    const reader = new IndexedDbMessageStore({
      sessionId,
      kind: "playback-spill",
      accessMode: "reader",
    });
    const sealer = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    const cleaner = new IndexedDbMessageStore({
      sessionId: "terminal-reader-cleaner",
      kind: "playback-spill",
    });
    try {
      await reader.init();
      await sealer.init();
      await sealer.discardAndSeal("pending-delete");
      expect(await getSessionMetadata(sessionId, "playback-spill")).toMatchObject({
        status: "pending-delete",
        readers: [expect.any(String)],
      });

      await cleaner.init();
      await cleaner.cleanupOldSessions("playback-spill");

      expect(await getSessionMetadata(sessionId, "playback-spill")).toBeUndefined();
      await expect(
        reader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 20, nsec: 0 },
        }),
      ).resolves.toHaveLength(0);
    } finally {
      await reader.close();
      await cleaner.close();
    }
  });

  it("continues cleanup after one reclaimable session fails", async () => {
    const first = new IndexedDbMessageStore({
      sessionId: "cleanup-first",
      kind: "playback-spill",
    });
    await first.init();
    await first.append([messageEvent(1)]);
    await first.flush();
    await first.close();

    const second = new IndexedDbMessageStore({
      sessionId: "cleanup-second",
      kind: "playback-spill",
    });
    await second.init();
    await second.append([messageEvent(2)]);
    await second.flush();
    await second.close();

    const metadataDb = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    try {
      const tx = metadataDb.transaction("sessions", "readwrite");
      const firstMetadata = (await tx.store.get("cleanup-first")) as CacheSessionMetadata;
      const secondMetadata = (await tx.store.get("cleanup-second")) as CacheSessionMetadata;
      await tx.store.put({ ...firstMetadata, status: "pending-delete", lastActiveAt: 1_000 });
      await tx.store.put({ ...secondMetadata, status: "abandoned", lastActiveAt: 1_000 });
      await tx.done;
    } finally {
      metadataDb.close();
    }

    const originalOpenDB = IDB.openDB;
    let injectedFailure = false;
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (args[0] !== PLAYBACK_MESSAGE_CACHE_DB_NAME) {
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
              if (storeNames !== "sessions" || mode !== "readwrite") {
                return tx;
              }

              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp !== "objectStore") {
                    const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                    return typeof value === "function" ? value.bind(txTarget) : value;
                  }

                  return (storeName: Parameters<typeof txTarget.objectStore>[0]) => {
                    const store = txTarget.objectStore(storeName);
                    if (storeName !== "sessions") {
                      return store;
                    }
                    return new Proxy(store, {
                      get(storeTarget, storeProp, storeReceiver) {
                        if (storeProp !== "get") {
                          const value = Reflect.get(
                            storeTarget,
                            storeProp,
                            storeReceiver,
                          ) as unknown;
                          return typeof value === "function" ? value.bind(storeTarget) : value;
                        }

                        return async (key: Parameters<typeof storeTarget.get>[0]) => {
                          if (key === "cleanup-first" && !injectedFailure) {
                            injectedFailure = true;
                            throw new Error("injected cleanup failure");
                          }
                          return await storeTarget.get(key);
                        };
                      },
                    });
                  };
                },
              });
            };
          },
        });
      });

    const cleaner = new IndexedDbMessageStore({
      sessionId: "cleanup-failure-cleaner",
      kind: "playback-spill",
    });
    try {
      await cleaner.init();
      await cleaner.cleanupOldSessions("playback-spill", 0);
      expect(injectedFailure).toBe(true);
      (console.error as jest.Mock).mockClear();
    } finally {
      openDBSpy.mockRestore();
      await cleaner.close();
    }

    const resultDb = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    try {
      const tx = resultDb.transaction(["messages", "sessions"], "readonly");
      await expect(tx.objectStore("sessions").get("cleanup-first")).resolves.toEqual(
        expect.objectContaining({ status: "pending-delete" }),
      );
      await expect(
        tx.objectStore("messages").index("bySession").count("cleanup-first"),
      ).resolves.toBe(1);
      await expect(tx.objectStore("sessions").get("cleanup-second")).resolves.toBeUndefined();
      await expect(
        tx.objectStore("messages").index("bySession").count("cleanup-second"),
      ).resolves.toBe(0);
      await tx.done;
    } finally {
      resultDb.close();
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

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
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
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (touchedAfterScan || args[0] !== PLAYBACK_MESSAGE_CACHE_DB_NAME) {
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
      });

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

  it("does not open or migrate the legacy cache when creating a new realtime store", async () => {
    await IDB.deleteDB(LEGACY_MESSAGE_CACHE_DB_NAME);

    const v1 = await IDB.openDB(LEGACY_MESSAGE_CACHE_DB_NAME, 1, {
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

    const openDBSpy = jest.spyOn(indexedDbMessageCacheApi, "openDB");
    const store = new IndexedDbMessageStore({ sessionId: "new-realtime" });
    try {
      await store.init();
      await store.append([messageEvent(2)]);
      await store.flush();

      expect((await store.stats()).count).toBe(1);
      expect(openDBSpy.mock.calls.map(([databaseName]) => databaseName)).not.toContain(
        LEGACY_MESSAGE_CACHE_DB_NAME,
      );
    } finally {
      openDBSpy.mockRestore();
      await store.close();
    }

    const untouchedLegacy = await IDB.openDB(LEGACY_MESSAGE_CACHE_DB_NAME);
    try {
      expect(untouchedLegacy.version).toBe(1);
      const legacyTx = untouchedLegacy.transaction(["messages", "sessions"], "readonly");
      await expect(legacyTx.objectStore("messages").count()).resolves.toBe(1);
      await expect(legacyTx.objectStore("sessions").count()).resolves.toBe(1);
      await legacyTx.done;
    } finally {
      untouchedLegacy.close();
    }
  });

  it("reports a legacy database deletion blocked by another tab connection", async () => {
    jest.useFakeTimers();
    const blocker = await IDB.openDB(LEGACY_MESSAGE_CACHE_DB_NAME, 1, {
      upgrade: (db) => {
        db.createObjectStore("messages");
      },
    });
    const onBlocked = jest.fn();
    const secondOnBlocked = jest.fn();
    const deleteDBSpy = jest.spyOn(indexedDbMessageCacheApi, "deleteDB");

    try {
      const cancelFirst = scheduleLegacyMessageCacheDatabaseDeletion({ onBlocked });
      scheduleLegacyMessageCacheDatabaseDeletion({ onBlocked: secondOnBlocked });
      await jest.advanceTimersByTimeAsync(1_000);
      cancelFirst();
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(secondOnBlocked).toHaveBeenCalledTimes(1);
      expect(
        deleteDBSpy.mock.calls.filter(
          ([databaseName]) => databaseName === LEGACY_MESSAGE_CACHE_DB_NAME,
        ),
      ).toHaveLength(1);
      expect(console.warn).toHaveBeenCalled();
      jest.mocked(console.warn).mockClear();

      blocker.close();
      await jest.advanceTimersByTimeAsync(0);
      scheduleLegacyMessageCacheDatabaseDeletion();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(
        deleteDBSpy.mock.calls.filter(
          ([databaseName]) => databaseName === LEGACY_MESSAGE_CACHE_DB_NAME,
        ),
      ).toHaveLength(1);
    } finally {
      blocker.close();
      await jest.advanceTimersByTimeAsync(0);
      deleteDBSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("enforces the playback budget at startup without reopening a disabled writer", async () => {
    const sessionId = "startup-stale-playback";
    const store = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    await store.init();
    await store.append([messageEvent(1)]);
    await store.flush();
    await store.close();

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    const tx = db.transaction("sessions", "readwrite");
    const metadata = (await tx.store.get(sessionId)) as CacheSessionMetadata;
    await tx.store.put({
      ...metadata,
      status: "active",
      // Recent enough to be retained by the conventional 24-hour janitor, but old enough to be
      // reclaimable under pressure. The logical size exceeds the 2 GiB fallback budget.
      lastActiveAt: Date.now() - 10 * 60 * 1_000,
      approximateSizeBytes: 3 * 1024 * 1024 * 1024,
    });
    await tx.done;
    db.close();

    const originalIdleCallback = Object.getOwnPropertyDescriptor(globalThis, "requestIdleCallback");
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const timerCallbacks: (() => void)[] = [];
    Reflect.deleteProperty(globalThis, "requestIdleCallback");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout: (callback: () => void) => {
          timerCallbacks.push(callback);
          return timerCallbacks.length;
        },
      },
    });

    try {
      scheduleMessageCacheMaintenance();
      expect(timerCallbacks).toHaveLength(2);
      for (const callback of timerCallbacks) {
        callback();
      }
      await waitForSessionDeletion(sessionId, "playback-spill");
    } finally {
      if (originalIdleCallback) {
        Object.defineProperty(globalThis, "requestIdleCallback", originalIdleCallback);
      } else {
        Reflect.deleteProperty(globalThis, "requestIdleCallback");
      }
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("does not disable a new writer for a sealed session awaiting reclamation", async () => {
    const previousSessionId = "sealed-previous-playback";
    const previous = new IndexedDbMessageStore({
      sessionId: previousSessionId,
      kind: "playback-spill",
    });
    await previous.init();
    await previous.append([messageEvent(1)]);
    await previous.flush();
    await previous.close();

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    const tx = db.transaction("sessions", "readwrite");
    const metadata = (await tx.store.get(previousSessionId)) as CacheSessionMetadata;
    await tx.store.put({
      ...metadata,
      status: "pending-delete",
      approximateSizeBytes: 3 * 1024 * 1024 * 1024,
    });
    await tx.done;
    db.close();

    const current = new IndexedDbMessageStore({
      sessionId: "next-playback",
      kind: "playback-spill",
    });
    try {
      await current.init();
      expect(current.isWritable()).toBe(true);
    } finally {
      await current.close();
    }
  });

  it("requests a later maintenance pass for an over-budget active crash session", async () => {
    const sessionId = "startup-fresh-playback";
    const store = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    await store.init();
    await store.append([messageEvent(1)]);
    await store.flush();
    await store.close();

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    const tx = db.transaction("sessions", "readwrite");
    const metadata = (await tx.store.get(sessionId)) as CacheSessionMetadata;
    await tx.store.put({
      ...metadata,
      status: "active",
      lastActiveAt: Date.now(),
      approximateSizeBytes: 3 * 1024 * 1024 * 1024,
    });
    await tx.done;
    db.close();

    const janitor = new IndexedDbMessageStore({
      kind: "playback-spill",
      accessMode: "maintenance",
    });
    try {
      await janitor.init();
      const retryDelayMs = await janitor.runMaintenance();
      expect(console.warn).toHaveBeenCalledWith(
        "Disabling IndexedDbMessageStore writes because non-reclaimable sessions exceed budget",
        expect.objectContaining({ dbName: PLAYBACK_MESSAGE_CACHE_DB_NAME }),
      );
      jest.mocked(console.warn).mockClear();
      expect(retryDelayMs).toBeGreaterThan(4 * 60 * 1_000);
      expect(retryDelayMs).toBeLessThanOrEqual(5 * 60 * 1_000 + 1_000);
      expect(await getSessionMetadata(sessionId, "playback-spill")).toMatchObject({
        status: "active",
      });
    } finally {
      await janitor.close();
    }
  });

  it("requests a later maintenance pass for an over-budget session with a fresh reader lease", async () => {
    const sessionId = "startup-fresh-reader";
    const store = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    await store.init();
    await store.append([messageEvent(1)]);
    await store.flush();
    await store.close();

    const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    const tx = db.transaction("sessions", "readwrite");
    const metadata = (await tx.store.get(sessionId)) as CacheSessionMetadata;
    await tx.store.put({
      ...metadata,
      readers: ["replay-reader"],
      lastActiveAt: Date.now(),
      approximateSizeBytes: 3 * 1024 * 1024 * 1024,
    });
    await tx.done;
    db.close();

    const janitor = new IndexedDbMessageStore({
      kind: "playback-spill",
      accessMode: "maintenance",
    });
    try {
      await janitor.init();
      const retryDelayMs = await janitor.runMaintenance();
      expect(retryDelayMs).toBeGreaterThan(4 * 60 * 1_000);
      expect(retryDelayMs).toBeLessThanOrEqual(5 * 60 * 1_000 + 1_000);
      expect(await getSessionMetadata(sessionId, "playback-spill")).toMatchObject({
        status: "closed",
        readers: ["replay-reader"],
      });
      expect(console.warn).toHaveBeenCalledWith(
        "Disabling IndexedDbMessageStore writes because non-reclaimable sessions exceed budget",
        expect.objectContaining({ dbName: PLAYBACK_MESSAGE_CACHE_DB_NAME }),
      );
      jest.mocked(console.warn).mockClear();
    } finally {
      await janitor.close();
    }
  });

  it("releases the cross-tab maintenance lock when an IndexedDB transaction never settles", async () => {
    const sessionId = "stalled-maintenance-session";
    const seed = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
    await seed.init();
    await seed.append([messageEvent(1)]);
    await seed.flush();
    await seed.close();

    const seedDb = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
    const seedTx = seedDb.transaction("sessions", "readwrite");
    const seedMetadata = (await seedTx.store.get(sessionId)) as CacheSessionMetadata;
    await seedTx.store.put({ ...seedMetadata, status: "abandoned" });
    await seedTx.done;
    seedDb.close();

    const originalOpenDB = IDB.openDB;
    let stallMaintenance = false;
    let injectedStall = false;
    let signalMaintenanceStarted: (() => void) | undefined;
    const maintenanceStarted = new Promise<void>((resolve) => {
      signalMaintenanceStarted = resolve;
    });
    let rejectTransaction: ((error: Error) => void) | undefined;
    const abort = jest.fn(() => {
      rejectTransaction?.(new Error("aborted stalled maintenance transaction"));
    });
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (args[0] !== PLAYBACK_MESSAGE_CACHE_DB_NAME) {
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
              if (
                !stallMaintenance ||
                injectedStall ||
                storeNames !== "sessions" ||
                mode !== "readonly"
              ) {
                return tx;
              }
              injectedStall = true;
              const stalledDone = new Promise<void>((_resolve, reject) => {
                rejectTransaction = reject;
                signalMaintenanceStarted?.();
              });
              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "done") {
                    return stalledDone;
                  }
                  if (txProp === "abort") {
                    return abort;
                  }
                  const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              });
            };
          },
        });
      });
    const janitor = new IndexedDbMessageStore({
      kind: "playback-spill",
      accessMode: "maintenance",
      maintenanceTimeoutMs: 25,
    });
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    let lockHeld = false;
    let releaseCount = 0;

    try {
      await janitor.init();
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: {
          request: async (
            name: string,
            _options: { mode: "exclusive"; ifAvailable?: boolean },
            callback: (lock: object | undefined) => Promise<unknown>,
          ): Promise<unknown> => {
            expect(name).toBe("studio-message-cache-maintenance-v1");
            expect(lockHeld).toBe(false);
            lockHeld = true;
            try {
              return await callback({});
            } finally {
              lockHeld = false;
              releaseCount++;
            }
          },
        },
      });
      stallMaintenance = true;

      const maintenancePromise = janitor.runMaintenance();
      await maintenanceStarted;
      expect(lockHeld).toBe(true);
      await expect(withTimeout(maintenancePromise, 250)).resolves.toBe(1_000);

      expect(abort).toHaveBeenCalledTimes(1);
      expect(lockHeld).toBe(false);
      expect(releaseCount).toBe(1);
      expect(janitor.isWritable()).toBe(false);
      jest.mocked(console.error).mockClear();
      jest.mocked(console.warn).mockClear();
    } finally {
      if (originalLocks == undefined) {
        Reflect.deleteProperty(navigator, "locks");
      } else {
        Object.defineProperty(navigator, "locks", originalLocks);
      }
      await janitor.close();
      openDBSpy.mockRestore();
      jest.mocked(console.error).mockClear();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("does not queue foreground budget checks behind in-process maintenance", async () => {
    const janitor = new IndexedDbMessageStore({
      kind: "playback-spill",
      accessMode: "maintenance",
    });
    const writer = new IndexedDbMessageStore({ sessionId: "foreground-budget-check" });
    await Promise.all([janitor.init(), writer.init()]);

    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    let releaseMaintenanceLock: (() => void) | undefined;
    let signalMaintenanceLockHeld: (() => void) | undefined;
    const maintenanceLockHeld = new Promise<void>((resolve) => {
      signalMaintenanceLockHeld = resolve;
    });
    let holdFirstRequest = true;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: { mode: "exclusive"; ifAvailable?: boolean },
          callback: (lock: object | undefined) => Promise<unknown>,
        ): Promise<unknown> => {
          expect(name).toBe("studio-message-cache-maintenance-v1");
          if (holdFirstRequest) {
            holdFirstRequest = false;
            signalMaintenanceLockHeld?.();
            await new Promise<void>((resolve) => {
              releaseMaintenanceLock = resolve;
            });
          }
          return await callback({});
        },
      },
    });

    const maintenancePromise = janitor.runMaintenance();
    try {
      await maintenanceLockHeld;
      await writer.append([messageEvent(1)], {
        estimatedSizeBytes: [64 * 1024 ** 2],
      });

      await expect(withTimeout(writer.flush(), 250)).resolves.toBeUndefined();
    } finally {
      releaseMaintenanceLock?.();
      await maintenancePromise;
      if (originalLocks == undefined) {
        Reflect.deleteProperty(navigator, "locks");
      } else {
        Object.defineProperty(navigator, "locks", originalLocks);
      }
      await Promise.all([writer.close(), janitor.close()]);
    }
  });

  it("bounds the post-lock maintenance retry scan with the same absolute deadline", async () => {
    const originalOpenDB = IDB.openDB;
    let readonlySessionTransactionCount = 0;
    let signalRetryScanStarted: (() => void) | undefined;
    const retryScanStarted = new Promise<void>((resolve) => {
      signalRetryScanStarted = resolve;
    });
    let rejectTransaction: ((error: Error) => void) | undefined;
    const abort = jest.fn(() => {
      rejectTransaction?.(new Error("aborted stalled maintenance retry scan"));
    });
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const openedDb = await originalOpenDB(...args);
        if (args[0] !== PLAYBACK_MESSAGE_CACHE_DB_NAME) {
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
              readonlySessionTransactionCount++;
              if (readonlySessionTransactionCount !== 3) {
                return tx;
              }
              const stalledDone = new Promise<void>((_resolve, reject) => {
                rejectTransaction = reject;
                signalRetryScanStarted?.();
              });
              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "done") {
                    return stalledDone;
                  }
                  if (txProp === "abort") {
                    return abort;
                  }
                  const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              });
            };
          },
        });
      });
    const janitor = new IndexedDbMessageStore({
      kind: "playback-spill",
      accessMode: "maintenance",
      maintenanceTimeoutMs: 100,
    });

    try {
      await janitor.init();
      const maintenancePromise = janitor.runMaintenance();
      await retryScanStarted;

      await expect(withTimeout(maintenancePromise, 500)).rejects.toThrow(
        "maintenance retry calculation",
      );
      expect(abort).toHaveBeenCalledTimes(1);
      expect(janitor.isWritable()).toBe(false);
    } finally {
      await janitor.close();
      openDBSpy.mockRestore();
    }
  });

  it("closes its connection when a newer database version requests versionchange", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "versionchange" });
    await store.init();
    let upgraded: IDB.IDBPDatabase | undefined;
    try {
      upgraded = await withTimeout(IDB.openDB(REALTIME_MESSAGE_CACHE_DB_NAME, 2), 500);
      expect(upgraded.version).toBe(2);
      expect(store.isWritable()).toBe(false);
      await expect(store.append([messageEvent(1)])).rejects.toThrow("is not writable");
    } finally {
      upgraded?.close();
      (console.warn as jest.Mock).mockClear();
      await store.close();
      await store.close();
    }
  });

  it("times out initialization and closes a database connection that opens late", async () => {
    let resolveOpen!: (db: IDB.IDBPDatabase) => void;
    const pendingOpen = new Promise<IDB.IDBPDatabase>((resolve) => {
      resolveOpen = resolve;
    });
    const lateDb = { close: jest.fn() } as unknown as IDB.IDBPDatabase;
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async () => await pendingOpen);
    const store = new IndexedDbMessageStore({ sessionId: "late-open", openTimeoutMs: 10 });

    try {
      await expect(store.init()).rejects.toThrow("Timed out opening IndexedDbMessageStore");
      (console.error as jest.Mock).mockClear();
      (console.warn as jest.Mock).mockClear();

      resolveOpen(lateDb);
      await wait(0);
      expect(lateDb.close).toHaveBeenCalledTimes(1);
    } finally {
      openDBSpy.mockRestore();
      await store.close();
    }
  });

  it("applies the initialization deadline to a post-open transaction", async () => {
    const originalOpenDB = IDB.openDB;
    let injectedHang = false;
    let rejectTransaction: ((error: Error) => void) | undefined;
    const abort = jest.fn(() => {
      rejectTransaction?.(new Error("aborted stalled initialization transaction"));
    });
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const db = await originalOpenDB(...args);
        return new Proxy(db, {
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
              if (injectedHang || storeNames !== "sessions" || mode !== "readwrite") {
                return tx;
              }
              injectedHang = true;
              const stalledDone = new Promise<void>((_resolve, reject) => {
                rejectTransaction = reject;
              });
              return new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "done") {
                    return stalledDone;
                  }
                  if (txProp === "abort") {
                    return abort;
                  }
                  const value = Reflect.get(txTarget, txProp, txReceiver) as unknown;
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              });
            };
          },
        });
      });
    const store = new IndexedDbMessageStore({
      sessionId: "post-open-timeout",
      openTimeoutMs: 25,
    });

    try {
      await expect(withTimeout(store.init(), 250)).rejects.toThrow(
        "Timed out initializing IndexedDbMessageStore during session creation",
      );
      expect(injectedHang).toBe(true);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(store.isWritable()).toBe(false);
      jest.mocked(console.error).mockClear();
    } finally {
      openDBSpy.mockRestore();
      await store.close();
    }
  });

  it("abandons and releases a session when initialization fails after creating it", async () => {
    const originalOpenDB = IDB.openDB;
    const initializationError = new Error("message statistics failed");
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const db = await originalOpenDB(...args);
        return new Proxy(db, {
          get(target, prop, receiver) {
            if (prop !== "transaction") {
              const value = Reflect.get(target, prop, receiver) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (storeNames: unknown, mode?: unknown, options?: unknown) => {
              if (Array.isArray(storeNames) && mode === "readonly") {
                throw initializationError;
              }
              return target.transaction(
                storeNames as Parameters<typeof target.transaction>[0],
                mode as Parameters<typeof target.transaction>[1],
                options as Parameters<typeof target.transaction>[2],
              );
            };
          },
        });
      });
    const store = new IndexedDbMessageStore({
      sessionId: "failed-after-session-created",
      openTimeoutMs: 1_000,
    });

    try {
      await expect(store.init()).rejects.toBe(initializationError);
      expect(store.isWritable()).toBe(false);
    } finally {
      openDBSpy.mockRestore();
      await store.close();
      jest.mocked(console.error).mockClear();
    }

    await expect(getSessionMetadata("failed-after-session-created")).resolves.toMatchObject({
      status: "abandoned",
      owners: [],
    });
  });

  it("falls back to abandoned when the normal close status update fails", async () => {
    const originalOpenDB = IDB.openDB;
    const statusError = new Error("closed status update failed");
    let sessionWriteTransactions = 0;
    const openDBSpy = jest
      .spyOn(indexedDbMessageCacheApi, "openDB")
      .mockImplementation(async (...args: Parameters<typeof IDB.openDB>) => {
        const db = await originalOpenDB(...args);
        return new Proxy(db, {
          get(target, prop, receiver) {
            if (prop !== "transaction") {
              const value = Reflect.get(target, prop, receiver) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (storeNames: unknown, mode?: unknown, options?: unknown) => {
              if (storeNames === "sessions" && mode === "readwrite") {
                sessionWriteTransactions++;
                if (sessionWriteTransactions === 3) {
                  throw statusError;
                }
              }
              return target.transaction(
                storeNames as Parameters<typeof target.transaction>[0],
                mode as Parameters<typeof target.transaction>[1],
                options as Parameters<typeof target.transaction>[2],
              );
            };
          },
        });
      });
    const store = new IndexedDbMessageStore({ sessionId: "close-status-fallback" });

    await store.init();
    await expect(store.close()).rejects.toBe(statusError);
    openDBSpy.mockRestore();

    await expect(getSessionMetadata("close-status-fallback")).resolves.toMatchObject({
      status: "abandoned",
      owners: [],
    });
  });

  it("fails closed when the append queue would create an incomplete cache", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "bounded-queue",
      maxQueuedMessages: 2,
      openTimeoutMs: 1000,
    });

    await expect(store.append([messageEvent(1), messageEvent(2), messageEvent(3)])).rejects.toThrow(
      "refusing incomplete cache writes",
    );
    await store.init();
    expect(store.isWritable()).toBe(false);
    await expect(store.flush()).rejects.toThrow("refusing incomplete cache writes");

    const messages = await store.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages).toEqual([]);
    (console.warn as jest.Mock).mockClear();
    await store.discardAndSeal("abandoned");
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
    expect((await getSessionMetadata("loaded-ranges", "playback-spill"))?.lastActiveAt).toBe(2_000);

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

  it("prunes more than 100 small messages in one bounded size batch", async () => {
    const sessionId = "large-size-prune-batch";
    const store = new IndexedDbMessageStore({
      sessionId,
      kind: "playback-spill",
      retentionWindowMs: 1_000_000_000,
    });
    try {
      await store.init();
      await store.append(Array.from({ length: 101 }, (_, index) => messageEvent(index)));
      await store.flush();

      store.setMaxCacheSize(1);
      const result = await store.forcePrune();

      expect(result.prunedCount).toBe(101);
      expect(result.newCount).toBe(0);
      await expect(getSessionMetadata(sessionId, "playback-spill")).resolves.toMatchObject({
        contentRevision: 1,
      });
    } finally {
      await store.close();
    }
  });

  it("rejects a loaded range written after another connection prunes the session", async () => {
    const sessionId = "cross-connection-content-revision";
    const writer = new IndexedDbMessageStore({
      sessionId,
      kind: "playback-spill",
    });
    const pruner = new IndexedDbMessageStore({
      sessionId,
      kind: "playback-spill",
      retentionWindowMs: 1,
    });

    try {
      await writer.init();
      await writer.append([messageEvent(1, "/topic", { sec: 1, nsec: 0 })]);
      await writer.flush();
      await pruner.init();

      const staleRevision = writer.getContentRevision();
      expect(staleRevision).toBe(0);
      await expect(pruner.forcePrune()).resolves.toMatchObject({ prunedCount: 1 });

      await expect(
        writer.putLoadedRange(
          {
            sessionId,
            topicFingerprint: "topics",
            start: { sec: 1, nsec: 0 },
            end: { sec: 1, nsec: 0 },
          },
          staleRevision,
        ),
      ).resolves.toBe(false);
      expect(await writer.getLoadedRanges("topics")).toEqual([]);
      expect((await getSessionMetadata(sessionId, "playback-spill"))?.contentRevision).toBe(1);
    } finally {
      await writer.close();
      await pruner.close();
    }
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

  it("does not return backfill messages across an uncovered gap", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "bounded-backfill",
      kind: "playback-spill",
    });
    await store.init();
    await store.append([messageEvent(1, "/topic", { sec: 5, nsec: 0 })]);
    await store.flush();

    await expect(
      store.getBackfillMessages({
        topics: ["/topic"],
        time: { sec: 20, nsec: 0 },
        start: { sec: 10, nsec: 0 },
      }),
    ).resolves.toEqual([]);
    await store.close();
  });
});
