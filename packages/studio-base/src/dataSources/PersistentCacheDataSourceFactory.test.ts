// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IterablePlayer, WorkerIterableSource } from "@foxglove/studio-base/players/IterablePlayer";

import PersistentCacheDataSourceFactory from "./PersistentCacheDataSourceFactory";

const mockPreinitialize = jest.fn<Promise<unknown>, []>();
const mockTerminate = jest.fn<Promise<void>, []>();

jest.mock("@foxglove/studio-base/players/IterablePlayer", () => ({
  IterablePlayer: jest.fn().mockImplementation((options: unknown) => ({ options })),
  WorkerIterableSource: jest.fn().mockImplementation((options: unknown) => ({
    options,
    preinitialize: mockPreinitialize,
    terminate: mockTerminate,
  })),
}));

const mockIterablePlayer = IterablePlayer as unknown as jest.Mock;
const mockWorkerIterableSource = WorkerIterableSource as unknown as jest.Mock;

describe("PersistentCacheDataSourceFactory", () => {
  beforeEach(() => {
    mockIterablePlayer.mockClear();
    mockWorkerIterableSource.mockClear();
    mockPreinitialize.mockReset().mockResolvedValue(undefined);
    mockTerminate.mockReset().mockResolvedValue(undefined);
  });

  it("initializes the actual worker source before constructing the replay player", async () => {
    const factory = new PersistentCacheDataSourceFactory();

    const player = await factory.initialize({
      metricsCollector: undefined as never,
      sessionId: "ready-session",
      retentionWindowMs: 30_000,
    });

    expect(mockPreinitialize).toHaveBeenCalledTimes(1);
    expect(mockIterablePlayer).toHaveBeenCalledTimes(1);
    expect(mockIterablePlayer.mock.calls[0]?.[0]).toMatchObject({
      source: mockWorkerIterableSource.mock.results[0]?.value,
      sourceId: "persistent-cache",
      urlParams: { sessionId: "ready-session" },
    });
    expect(player).toBe(mockIterablePlayer.mock.results[0]?.value);
  });

  it("propagates worker initialization failure without constructing a replay player", async () => {
    const initializationError = new Error("worker metadata read failed");
    mockPreinitialize.mockRejectedValueOnce(initializationError);
    const factory = new PersistentCacheDataSourceFactory();

    await expect(
      factory.initialize({
        metricsCollector: undefined as never,
        sessionId: "failed-session",
        retentionWindowMs: 30_000,
      }),
    ).rejects.toBe(initializationError);

    expect(mockIterablePlayer).not.toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("terminates the preinitialized source if player construction fails", async () => {
    const constructionError = new Error("player construction failed");
    mockIterablePlayer.mockImplementationOnce(() => {
      throw constructionError;
    });
    const factory = new PersistentCacheDataSourceFactory();

    await expect(
      factory.initialize({
        metricsCollector: undefined as never,
        sessionId: "construction-failed-session",
        retentionWindowMs: 30_000,
      }),
    ).rejects.toBe(constructionError);

    expect(mockTerminate).toHaveBeenCalledTimes(1);
    jest.mocked(console.error).mockClear();
  });
});
