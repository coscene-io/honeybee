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

  it("abandons the cache when metadata flush never settles", async () => {
    const storeTopicsSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "storeTopics")
      .mockImplementation(async () => {
        await new Promise<void>(() => undefined);
      });
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");
    const cache = new RealtimeVizHistoryCache({
      sessionId: "hung-realtime-metadata",
      retentionWindowMs: 30_000,
    });

    await cache.init();
    cache.storeTopics([{ name: "a", schemaName: "foo" }], new Map());

    jest.useFakeTimers();
    try {
      const closePromise = cache.close();
      expect(cache.close()).toBe(closePromise);
      await jest.advanceTimersByTimeAsync(5_000);

      await expect(closePromise).rejects.toThrow("Timed out flushing realtime cache metadata");
      expect(discardSpy).toHaveBeenCalledWith("abandoned");
    } finally {
      jest.useRealTimers();
      discardSpy.mockRestore();
      storeTopicsSpy.mockRestore();
      jest.mocked(console.warn).mockClear();
    }
  });
});
