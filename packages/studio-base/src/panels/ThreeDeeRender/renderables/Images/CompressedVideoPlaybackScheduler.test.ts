// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  CompressedVideoPlaybackScheduler,
  type CompressedVideoPlaybackSchedulerController,
  type CompressedVideoPlaybackSchedulerResult,
} from "./CompressedVideoPlaybackScheduler";

function makeController(
  id: string,
  run: () => Promise<CompressedVideoPlaybackSchedulerResult>,
  hasPendingPlayback = () => true,
): CompressedVideoPlaybackSchedulerController {
  return {
    id,
    hasPendingPlayback,
    runPlaybackFlush: run,
  };
}

describe("CompressedVideoPlaybackScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("limits global playback flush rate independently of controller count", async () => {
    const scheduler = new CompressedVideoPlaybackScheduler();
    const runCounts = new Map<string, number>();
    const makeRun = (id: string) => async (): Promise<CompressedVideoPlaybackSchedulerResult> => {
      runCounts.set(id, (runCounts.get(id) ?? 0) + 1);
      return { displayed: true };
    };

    scheduler.request(makeController("a", makeRun("a"), () => (runCounts.get("a") ?? 0) < 100));
    scheduler.request(makeController("b", makeRun("b"), () => (runCounts.get("b") ?? 0) < 100));
    scheduler.request(makeController("c", makeRun("c"), () => (runCounts.get("c") ?? 0) < 100));

    await jest.advanceTimersByTimeAsync(1_000);

    const totalRuns = Array.from(runCounts.values()).reduce((sum, value) => sum + value, 0);
    expect(totalRuns).toBeGreaterThanOrEqual(40);
    expect(totalRuns).toBeLessThanOrEqual(47);
    expect([...runCounts.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("does not exceed the global playback flush concurrency", async () => {
    const scheduler = new CompressedVideoPlaybackScheduler();
    const pendingFlushes: Array<() => void> = [];
    const started: string[] = [];
    const makeRun = (id: string) => async (): Promise<CompressedVideoPlaybackSchedulerResult> => {
      started.push(id);
      return await new Promise<CompressedVideoPlaybackSchedulerResult>((resolve) => {
        pendingFlushes.push(() => {
          resolve({ displayed: true });
        });
      });
    };

    scheduler.request(makeController("a", makeRun("a"), () => false));
    scheduler.request(makeController("b", makeRun("b"), () => false));
    scheduler.request(makeController("c", makeRun("c"), () => false));
    await jest.advanceTimersByTimeAsync(0);

    expect(started).toEqual(["a", "b"]);

    pendingFlushes[0]?.();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(23);

    expect(started).toEqual(["a", "b", "c"]);
  });

  it("enforces a per-controller minimum interval so one panel cannot consume every token", async () => {
    const scheduler = new CompressedVideoPlaybackScheduler({
      normalSlotsPerSecond: 1_000,
      bucketCapacity: 100,
      initialTokens: 100,
    });
    let runs = 0;
    scheduler.request(
      makeController(
        "camera",
        async (): Promise<CompressedVideoPlaybackSchedulerResult> => {
          runs++;
          return { displayed: true };
        },
        () => runs < 100,
      ),
    );

    await jest.advanceTimersByTimeAsync(100);

    expect(runs).toBeLessThanOrEqual(4);
  });

  it("enters pressure mode after repeated late drops and recovers after the minimum window", async () => {
    const scheduler = new CompressedVideoPlaybackScheduler({
      normalSlotsPerSecond: 1_000,
      pressureSlotsPerSecond: 1_000,
      bucketCapacity: 100,
      initialTokens: 100,
    });
    let runs = 0;
    const runTimes: number[] = [];
    scheduler.request(
      makeController(
        "camera",
        async (): Promise<CompressedVideoPlaybackSchedulerResult> => {
          runTimes.push(Date.now());
          runs++;
          return runs <= 2 ? { lateDropped: true } : { displayed: true };
        },
        () => runs < 4,
      ),
    );

    await jest.advanceTimersByTimeAsync(34);

    expect(runs).toBe(2);
    expect(scheduler.isPressureMode()).toBe(true);

    await jest.advanceTimersByTimeAsync(64);
    expect(runs).toBe(2);

    await jest.advanceTimersByTimeAsync(1);
    expect(runs).toBe(3);
    expect(runTimes[2]! - runTimes[1]!).toBeGreaterThanOrEqual(66);

    await jest.advanceTimersByTimeAsync(1_000);

    expect(scheduler.isPressureMode()).toBe(false);
  });
});
