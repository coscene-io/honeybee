// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { clearIndexedDbMessageStoreDatabase, IndexedDbMessageStore } from "./IndexedDbMessageStore";
import { RealtimeVizHistoryCache } from "./RealtimeVizHistoryCache";

describe("RealtimeVizHistoryCache", () => {
  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("drops messages before initialization and reuses their declared size afterward", async () => {
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
    const cache = new RealtimeVizHistoryCache({
      sessionId: "realtime-init-gate",
      retentionWindowMs: 30_000,
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
      cache.append([event]);

      expect(appendSpy).toHaveBeenCalledWith([event], {
        estimatedSizeBytes: [1_256],
      });
      await cache.close();
    } finally {
      appendSpy.mockRestore();
      initSpy.mockRestore();
    }
  });

  it("abandons the cache when store shutdown fails", async () => {
    const closeError = new Error("store shutdown failed");
    const closeSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "close")
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
      closeSpy.mockRestore();
      discardSpy.mockRestore();
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
});
