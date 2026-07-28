/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import FoxgloveWebSocketPlayer from ".";

type MockListener = (...args: unknown[]) => void;

type MockClient = {
  close: jest.Mock;
  clientSyncTime: jest.Mock;
  emit: (name: string, ...args: unknown[]) => void;
};

type MockCache = {
  close: jest.Mock<Promise<void>, []>;
  rejectClose: (error: unknown) => void;
  resolveClose: () => void;
};

const mockClients: MockClient[] = [];
const mockCaches: MockCache[] = [];
let mockClientConstructionError: Error | undefined;

jest.mock("@foxglove/ws-protocol", () => {
  const actual = jest.requireActual("@foxglove/ws-protocol");

  class MockFoxgloveClient {
    public static SUPPORTED_SUBPROTOCOL = "foxglove.websocket.v1";

    readonly #listeners = new Map<string, Set<MockListener>>();
    public close = jest.fn();
    public clientSyncTime = jest.fn();

    public constructor() {
      if (mockClientConstructionError != undefined) {
        const error = mockClientConstructionError;
        mockClientConstructionError = undefined;
        throw error;
      }
      mockClients.push(this);
    }

    public on(name: string, listener: MockListener): void {
      const listeners = this.#listeners.get(name) ?? new Set();
      listeners.add(listener);
      this.#listeners.set(name, listeners);
    }

    public off(name: string, listener: MockListener): void {
      this.#listeners.get(name)?.delete(listener);
    }

    public emit(name: string, ...args: unknown[]): void {
      for (const listener of this.#listeners.get(name) ?? []) {
        listener(...args);
      }
    }
  }

  return { ...actual, FoxgloveClient: MockFoxgloveClient };
});

jest.mock("@foxglove/studio-base/persistence/RealtimeVizHistoryCache", () => ({
  RealtimeVizHistoryCache: jest.fn().mockImplementation(() => {
    let resolveClose = () => {};
    let rejectClose = (_error: unknown) => {};
    const cache: MockCache & {
      init: jest.Mock;
      append: jest.Mock;
      storeDatatypes: jest.Mock;
      storeTopics: jest.Mock;
    } = {
      init: jest.fn().mockResolvedValue(undefined),
      append: jest.fn(),
      storeDatatypes: jest.fn(),
      storeTopics: jest.fn(),
      close: jest.fn(async () => {
        await new Promise<void>((resolve, reject) => {
          resolveClose = resolve;
          rejectClose = reject;
        });
      }),
      rejectClose: (error) => {
        rejectClose(error);
      },
      resolveClose: () => {
        resolveClose();
      },
    };
    mockCaches.push(cache);
    return cache;
  }),
}));

function makePlayer(confirm: jest.Mock = jest.fn()): FoxgloveWebSocketPlayer {
  return new FoxgloveWebSocketPlayer({
    url: "ws://localhost:8765",
    metricsCollector: {
      playerConstructed: jest.fn(),
    } as never,
    sourceId: "foxglove-websocket",
    params: {},
    confirm,
    userId: "user",
    username: "name",
    deviceName: "device",
    authHeader: "token",
    sessionId: "shared-session",
    enablePersistentCache: true,
    retentionWindowMs: 60_000,
    autoConnectToLan: false,
  });
}

async function flushPromises(count = 5): Promise<void> {
  for (let index = 0; index < count; index++) {
    await Promise.resolve();
  }
}

describe("FoxgloveWebSocketPlayer lifecycle", () => {
  beforeEach(() => {
    mockClients.length = 0;
    mockCaches.length = 0;
    mockClientConstructionError = undefined;
  });

  it("serializes close/reopen and ignores events from an old client generation", async () => {
    const player = makePlayer();
    const oldClient = mockClients[0]!;
    const oldCache = mockCaches[0]!;

    const closePromise = player.close();
    expect(player.close()).toBe(closePromise);
    player.reOpen();

    expect(mockClients).toHaveLength(1);
    expect(mockCaches).toHaveLength(1);
    expect(oldCache.close).toHaveBeenCalledTimes(1);

    oldClient.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    await Promise.resolve();
    expect(mockClients).toHaveLength(1);

    oldCache.resolveClose();
    await closePromise;
    await Promise.resolve();

    expect(mockClients).toHaveLength(2);
    expect(mockCaches).toHaveLength(2);

    const newClient = mockClients[1]!;
    const newCache = mockCaches[1]!;
    oldClient.emit("syncTime", { serverTime: 1n, receiveTime: 1 });
    oldClient.emit("close", { type: "close", data: { code: 1006, reason: "late" } });
    expect(oldClient.clientSyncTime).not.toHaveBeenCalled();

    const secondClosePromise = player.close();
    expect(newClient.close).toHaveBeenCalledTimes(1);
    newClient.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    newCache.resolveClose();
    await secondClosePromise;
  });

  it("lets a later explicit close cancel a queued reopen", async () => {
    const player = makePlayer();
    const oldClient = mockClients[0]!;
    const oldCache = mockCaches[0]!;

    const closePromise = player.close();
    player.reOpen();
    expect(player.close()).toBe(closePromise);

    oldClient.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    oldCache.resolveClose();
    await closePromise;
    await Promise.resolve();

    expect(mockClients).toHaveLength(1);
    expect(mockCaches).toHaveLength(1);
  });

  it("does not revive a removed player from a stale kicked confirmation", async () => {
    let resolveConfirm: ((result: "ok") => void) | undefined;
    const confirm = jest.fn(
      async () =>
        await new Promise<"ok">((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const player = makePlayer(confirm);
    const oldClient = mockClients[0]!;
    const oldCache = mockCaches[0]!;

    oldClient.emit("kicked", { username: "other-user" });
    expect(confirm).toHaveBeenCalledTimes(1);

    // PlayerManager closes the player again while the kicked dialog is still visible.
    const removalClosePromise = player.close();
    oldClient.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    oldCache.resolveClose();
    await removalClosePromise;

    resolveConfirm?.("ok");
    await Promise.resolve();
    await Promise.resolve();

    expect(mockClients).toHaveLength(1);
    expect(mockCaches).toHaveLength(1);
  });

  it("does not wait for a second close event after receiving a 4001 close", async () => {
    jest.useFakeTimers();
    try {
      const confirm = jest.fn(async () => await new Promise<never>(() => undefined));
      const player = makePlayer(confirm);
      const client = mockClients[0]!;
      const cache = mockCaches[0]!;

      client.emit("close", {
        type: "close",
        data: { code: 4001, reason: JSON.stringify({ username: "other-user" }) },
      });
      expect(client.close).not.toHaveBeenCalled();

      const closePromise = player.close();
      cache.resolveClose();
      let settled = false;
      void closePromise.then(() => {
        settled = true;
      });
      await flushPromises(20);

      expect(settled).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      await jest.runOnlyPendingTimersAsync();
      jest.useRealTimers();
    }
  });

  it("keeps the player closed after a failed reopen and allows an explicit retry", async () => {
    const player = makePlayer();
    const oldClient = mockClients[0]!;
    const oldCache = mockCaches[0]!;

    const closePromise = player.close();
    oldClient.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    oldCache.resolveClose();
    await closePromise;

    const constructionError = new Error("client construction failed");
    mockClientConstructionError = constructionError;
    player.reOpen();
    await flushPromises(10);
    expect(mockClients).toHaveLength(1);
    expect(mockCaches).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to reopen WebSocket player:",
      constructionError,
    );
    jest.mocked(console.error).mockClear();

    player.reOpen();
    await flushPromises(10);
    expect(mockClients).toHaveLength(2);
    expect(mockCaches).toHaveLength(2);

    const newClient = mockClients[1]!;
    const newCache = mockCaches[1]!;
    const finalClosePromise = player.close();
    newClient.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    newCache.resolveClose();
    await finalClosePromise;
  });

  it("reports cache close failures after releasing the client", async () => {
    const player = makePlayer();
    const client = mockClients[0]!;
    const cache = mockCaches[0]!;
    const closeError = new Error("cache close failed");

    const closePromise = player.close();
    // The expectation must be registered before the close event settles the promise.
    // eslint-disable-next-line jest/valid-expect
    const rejection = expect(closePromise).rejects.toBe(closeError);
    client.emit("close", { type: "close", data: { code: 1000, reason: "" } });
    cache.rejectClose(closeError);

    await rejection;
    await expect(player.close()).resolves.toBeUndefined();
  });
});
