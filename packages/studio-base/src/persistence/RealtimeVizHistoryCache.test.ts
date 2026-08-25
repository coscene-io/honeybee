// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  clearIndexedDbMessageStoreDatabase,
  DEFAULT_APPEND_QUEUE_MAX_MESSAGES,
  IndexedDbMessageStore,
} from "./IndexedDbMessageStore";
import { RealtimeVizHistoryCache } from "./RealtimeVizHistoryCache";

describe("RealtimeVizHistoryCache", () => {
  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("buffers messages during initialization and reuses their declared size", async () => {
    let resolveInit = () => {};
    const initGate = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    const initSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "init")
      .mockImplementation(async function (this: IndexedDbMessageStore) {
        await initGate;
        initSpy.mockRestore();
        await this.init();
      });
    const appendSpy = jest.spyOn(IndexedDbMessageStore.prototype, "append");
    const onStatusChange = jest.fn();
    const cache = new RealtimeVizHistoryCache({
      sessionId: "realtime-init-gate",
      retentionWindowMs: 30_000,
      onStatusChange,
    });
    const event = {
      topic: "/example",
      receiveTime: { sec: 0, nsec: 0 },
      message: { nested: "value" },
      sizeInBytes: 1_000,
      schemaName: "example/Message",
    };

    try {
      const initPromise = cache.init();
      cache.append([event]);
      expect(appendSpy).not.toHaveBeenCalled();

      resolveInit();
      await initPromise;
      expect(appendSpy).toHaveBeenCalledWith([event], {
        estimatedSizeBytes: [1_256],
      });
      expect(onStatusChange).toHaveBeenCalledWith("ready");

      cache.append([event]);
      expect(appendSpy).toHaveBeenCalledTimes(2);
      await cache.close();
    } finally {
      appendSpy.mockRestore();
      initSpy.mockRestore();
    }
  });

  it("abandons the cache when store shutdown fails", async () => {
    const closeError = new Error("store shutdown failed");
    const closeAfterSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "closeAfter")
      .mockRejectedValueOnce(closeError);
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");
    const cache = new RealtimeVizHistoryCache({
      sessionId: "failed-realtime-shutdown",
      retentionWindowMs: 30_000,
    });

    await cache.init();
    try {
      const closePromise = cache.close();
      expect(cache.close()).toBe(closePromise);

      await expect(closePromise).rejects.toBe(closeError);
      expect(discardSpy).toHaveBeenCalledWith("abandoned");
    } finally {
      closeAfterSpy.mockRestore();
      discardSpy.mockRestore();
    }
  });

  it("reports the cache as unavailable after an append failure", async () => {
    const appendError = new Error("append failed");
    const appendSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "append")
      .mockRejectedValueOnce(appendError);
    const onStatusChange = jest.fn();
    const cache = new RealtimeVizHistoryCache({
      sessionId: "failed-realtime-append",
      retentionWindowMs: 30_000,
      onStatusChange,
    });

    await cache.init();
    cache.append([
      {
        topic: "/example",
        receiveTime: { sec: 1, nsec: 0 },
        message: {},
        sizeInBytes: 1,
        schemaName: "example/Message",
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(onStatusChange).toHaveBeenCalledWith("unavailable");
    await expect(cache.close()).rejects.toBe(appendError);
    appendSpy.mockRestore();
    jest.mocked(console.warn).mockClear();
  });

  it("bounds the initialization buffer by the store message limit", async () => {
    let resolveInit = () => {};
    const initGate = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    const initSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "init")
      .mockImplementation(async function (this: IndexedDbMessageStore) {
        await initGate;
        initSpy.mockRestore();
        await this.init();
      });
    const onStatusChange = jest.fn();
    const cache = new RealtimeVizHistoryCache({
      sessionId: "realtime-init-count-limit",
      retentionWindowMs: 30_000,
      onStatusChange,
    });
    const event = {
      topic: "/example",
      receiveTime: { sec: 1, nsec: 0 },
      message: {},
      sizeInBytes: 1,
      schemaName: "example/Message",
    };

    try {
      const initPromise = cache.init();
      cache.append(Array(DEFAULT_APPEND_QUEUE_MAX_MESSAGES + 1).fill(event));
      expect(onStatusChange).toHaveBeenCalledWith("unavailable");

      resolveInit();
      await initPromise;
      await expect(cache.close()).rejects.toThrow("initialization queue exceeded");
    } finally {
      resolveInit();
      initSpy.mockRestore();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("waits for queued metadata writes before close resolves", async () => {
    let resolveMetadata = () => {};
    const metadataWrite = new Promise<void>((resolve) => {
      resolveMetadata = resolve;
    });
    const storeTopicsSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "storeTopics")
      .mockReturnValueOnce(metadataWrite);
    const cache = new RealtimeVizHistoryCache({
      sessionId: "pending-realtime-metadata",
      retentionWindowMs: 30_000,
    });

    try {
      await cache.init();
      cache.storeTopics([{ name: "/topic", schemaName: "pkg/Msg" }], new Map());

      let closeResolved = false;
      const closePromise = cache.close().then(() => {
        closeResolved = true;
      });
      await Promise.resolve();
      expect(closeResolved).toBe(false);

      resolveMetadata();
      await closePromise;
      expect(storeTopicsSpy).toHaveBeenCalledTimes(1);
    } finally {
      resolveMetadata();
      storeTopicsSpy.mockRestore();
    }
  });

  it("rejects close when a metadata write fails after shutdown starts", async () => {
    const metadataError = new Error("metadata failed during close");
    let rejectMetadata = (_error: Error) => {};
    const metadataWrite = new Promise<void>((_resolve, reject) => {
      rejectMetadata = reject;
    });
    const storeTopicsSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "storeTopics")
      .mockReturnValueOnce(metadataWrite);
    const cache = new RealtimeVizHistoryCache({
      sessionId: "failed-closing-metadata",
      retentionWindowMs: 30_000,
    });

    try {
      await cache.init();
      cache.storeTopics([{ name: "/topic", schemaName: "pkg/Msg" }], new Map());
      const closePromise = cache.close();
      rejectMetadata(metadataError);

      await expect(closePromise).rejects.toBe(metadataError);
      jest.mocked(console.warn).mockClear();
    } finally {
      storeTopicsSpy.mockRestore();
    }
  });

  it("bounds close when a metadata write never settles", async () => {
    jest.useFakeTimers();
    const storeTopicsSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "storeTopics")
      .mockReturnValueOnce(new Promise<void>(() => undefined));
    const cache = new RealtimeVizHistoryCache({
      sessionId: "stalled-realtime-metadata",
      retentionWindowMs: 30_000,
    });

    try {
      await cache.init();
      cache.storeTopics([{ name: "/topic", schemaName: "pkg/Msg" }], new Map());

      // The expectation must be registered before advancing the timer that settles the promise.
      // eslint-disable-next-line jest/valid-expect
      const closeExpectation = expect(cache.close()).rejects.toThrow("pending close operations");
      await jest.advanceTimersByTimeAsync(5_000);
      await closeExpectation;
      expect(console.warn).toHaveBeenCalledWith(
        "IndexedDbMessageStore shutdown deadline exceeded",
        expect.objectContaining({ operation: "pending close operations" }),
      );
      jest.mocked(console.warn).mockClear();
    } finally {
      storeTopicsSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
