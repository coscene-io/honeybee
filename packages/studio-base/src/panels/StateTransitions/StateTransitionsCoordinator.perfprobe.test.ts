// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// StateTransitions viewport perf probe. Skipped by default (CI-neutral); it asserts nothing
// about timing and only prints measurements. To verify the numbers claimed in the PR that
// introduced viewport slicing, run the identical file on this branch and on the baseline:
//
//   PERF_PROBE=1 TRANSITION_EVERY=2  yarn test <this file>   # transition-heavy
//   PERF_PROBE=1 TRANSITION_EVERY=50 yarn test <this file>   # plateau-heavy
//   # baseline: git switch main && git checkout <this branch> -- <this file>  (file is additive)
//
// `deliveredPoints` is deterministic (identical on every run); blockedMs is machine-dependent
// but the cross-branch ratio is stable.
//
// Metrics:
// - blockedMs: event-loop blocking accumulated during the phase (2 ms lag sampler) — the
//   synchronous work a user would feel as jank.
// - deliveredPoints: total datum count handed to renderer.updateDatasets — deterministic
//   proxy for per-rebuild work shipped to the chart.
// Fixture: 100 blocks x 2,000 msgs = 200,000 points at 10 Hz over 2,000 s, plateau-heavy
// (state change every 50 samples), follow window 30 s.

import type { Dataset, UpdateAction } from "./StateTransitionsChartRenderer";
import { StateTransitionsCoordinator } from "./StateTransitionsCoordinator";
import type { StateTransitionsRenderer } from "./StateTransitionsRenderer";

jest.setTimeout(300_000);

type Msg = {
  topic: string;
  schemaName: string;
  receiveTime: { sec: number; nsec: number };
  message: { data: number };
  sizeInBytes: number;
};

const TOPIC = "/t";
const HZ = 10;
const BLOCK_COUNT = 100;
const MSGS_PER_BLOCK = 2_000;
const TOTAL_SECONDS = (BLOCK_COUNT * MSGS_PER_BLOCK) / HZ; // 2000 s
// Samples per plateau: 50 = plateau-heavy (few transitions), 2 = transition-heavy (worst case).
const TRANSITION_EVERY = Number(process.env.TRANSITION_EVERY ?? 50);

function makeMsg(tSec: number, value: number): Msg {
  return {
    topic: TOPIC,
    schemaName: "std_msgs/Float64",
    receiveTime: { sec: Math.floor(tSec), nsec: Math.round((tSec % 1) * 1e9) },
    message: { data: value },
    sizeInBytes: 8,
  };
}

function makeBlocks(): Array<{ messagesByTopic: Record<string, Msg[]>; sizeInBytes: number }> {
  const blocks = [];
  let sample = 0;
  for (let b = 0; b < BLOCK_COUNT; b++) {
    const msgs: Msg[] = [];
    for (let i = 0; i < MSGS_PER_BLOCK; i++, sample++) {
      msgs.push(makeMsg(sample / HZ, Math.floor(sample / TRANSITION_EVERY) % 4));
    }
    blocks.push({ messagesByTopic: { [TOPIC]: msgs }, sizeInBytes: msgs.length * 8 });
  }
  return blocks;
}

const DATATYPES = new Map([
  [
    "std_msgs/Float64",
    {
      name: "std_msgs/Float64",
      definitions: [{ name: "data", type: "float64", isComplex: false, isArray: false }],
    },
  ],
]);

function makePlayerState(args: {
  blocks: ReturnType<typeof makeBlocks>;
  messages: Msg[];
  currentTimeSec: number;
}): unknown {
  return {
    presence: 3,
    playerId: "perfprobe",
    progress: {
      messageCache: { blocks: args.blocks, startTime: { sec: 0, nsec: 0 } },
    },
    capabilities: [],
    profile: undefined,
    activeData: {
      messages: args.messages,
      totalBytesReceived: 0,
      currentTime: { sec: Math.floor(args.currentTimeSec), nsec: 0 },
      startTime: { sec: 0, nsec: 0 },
      endTime: { sec: TOTAL_SECONDS + 100, nsec: 0 },
      isPlaying: true,
      speed: 1,
      lastSeekTime: 1,
      topics: [{ name: TOPIC, schemaName: "std_msgs/Float64" }],
      topicStats: new Map(),
      datatypes: DATATYPES,
      publishedTopics: new Map(),
      subscribedTopics: new Map(),
      services: new Map(),
    },
  };
}

function makeMockRenderer() {
  let deliveredPoints = 0;
  let updateDatasetsCalls = 0;
  const renderer = {
    update: jest.fn(async (_action: UpdateAction) => {
      return { x: { min: 0, max: 30 }, y: { min: -20, max: 0 } };
    }),
    updateDatasets: jest.fn(async (datasets: Dataset[]) => {
      updateDatasetsCalls += 1;
      for (const ds of datasets) {
        deliveredPoints += ds.data.length;
      }
      // The real renderer posts datasets to a chart worker: a structured clone whose cost is
      // proportional to delivered points. Model that transport cost so blockedMs reflects it.
      structuredClone(datasets);
      return { min: 0, max: 1, left: 0, right: 100 };
    }),
    getElementsAtPixel: jest.fn(async () => []),
    getDatalabelAtEvent: jest.fn(async () => undefined),
  };
  return {
    renderer: renderer as unknown as StateTransitionsRenderer,
    stats: () => ({ deliveredPoints, updateDatasetsCalls }),
  };
}

function startLagSampler() {
  const intervalMs = 2;
  let last = performance.now();
  let blockedMs = 0;
  const id = setInterval(() => {
    const now = performance.now();
    const lag = now - last - intervalMs;
    if (lag > 1) {
      blockedMs += lag;
    }
    last = now;
  }, intervalMs);
  return {
    read: () => blockedMs,
    resetBase: () => {
      last = performance.now();
    },
    stop: () => {
      clearInterval(id);
      return blockedMs;
    },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 150);
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

const probeIt = process.env.PERF_PROBE === "1" ? it : it.skip;

probeIt("viewport perf probe (prints measurements; asserts nothing)", async () => {
  const { renderer, stats } = makeMockRenderer();
  const coordinator = new StateTransitionsCoordinator(renderer);

  coordinator.handleConfig(
    {
      isSynced: true,
      xAxisRange: 30,
      paths: [{ value: `${TOPIC}.data`, timestampMethod: "receiveTime" }],
    } as never,
    {},
  );

  const blocks = makeBlocks();
  const sampler = startLagSampler();

  // ---- Phase 1: block ingestion (one emit carrying the full 200k-point cache) ----
  const ingestStartBlocked = sampler.read();
  const ingestStartWall = performance.now();
  coordinator.handlePlayerState(makePlayerState({ blocks, messages: [], currentTimeSec: TOTAL_SECONDS }) as never);
  await settle();
  // Some implementations process blocks across several passes; give them a second settle.
  await settle();
  const ingest = {
    wallMs: Math.round(performance.now() - ingestStartWall),
    blockedMs: Math.round(sampler.read() - ingestStartBlocked),
    ...stats(),
  };

  // ---- Phase 2: playback-emit storm (50 emits, 5 live msgs each, same block cache) ----
  const emitBlocked: number[] = [];
  const emitDelivered: number[] = [];
  for (let i = 0; i < 50; i++) {
    const currentTimeSec = TOTAL_SECONDS + i * 0.5;
    const emitBaseSample = i * 5;
    const messages = Array.from({ length: 5 }, (_, k) =>
      makeMsg(currentTimeSec + k / HZ, Math.floor((emitBaseSample + k) / TRANSITION_EVERY) % 4),
    );
    const beforeBlocked = sampler.read();
    const beforeDelivered = stats().deliveredPoints;
    coordinator.handlePlayerState(
      makePlayerState({ blocks, messages, currentTimeSec }) as never,
    );
    await settle();
    emitBlocked.push(sampler.read() - beforeBlocked);
    emitDelivered.push(stats().deliveredPoints - beforeDelivered);
  }

  // ---- Phase 3: synced-bounds storm (30 window moves over the loaded history) ----
  const boundsBlocked: number[] = [];
  const boundsDelivered: number[] = [];
  for (let i = 0; i < 30; i++) {
    const min = (i * 61) % (TOTAL_SECONDS - 30);
    const beforeBlocked = sampler.read();
    const beforeDelivered = stats().deliveredPoints;
    coordinator.setGlobalBounds({ min, max: min + 30 });
    await settle();
    boundsBlocked.push(sampler.read() - beforeBlocked);
    boundsDelivered.push(stats().deliveredPoints - beforeDelivered);
  }

  sampler.stop();
  coordinator.destroy();

  const resultJson = JSON.stringify({
        fixture: {
          totalPoints: BLOCK_COUNT * MSGS_PER_BLOCK,
          blocks: BLOCK_COUNT,
          hz: HZ,
          transitionEvery: TRANSITION_EVERY,
          followWindowSec: 30,
        },
        ingest,
        emits: {
          count: emitBlocked.length,
          blockedMsMedian: Math.round(median(emitBlocked)),
          blockedMsP95: Math.round(p95(emitBlocked)),
          blockedMsTotal: Math.round(emitBlocked.reduce((a, b) => a + b, 0)),
          deliveredPointsMedian: Math.round(median(emitDelivered)),
        },
        bounds: {
          count: boundsBlocked.length,
          blockedMsMedian: Math.round(median(boundsBlocked)),
          blockedMsP95: Math.round(p95(boundsBlocked)),
          blockedMsTotal: Math.round(boundsBlocked.reduce((a, b) => a + b, 0)),
          deliveredPointsMedian: Math.round(median(boundsDelivered)),
        },
        totals: stats(),
  });
  process.stdout.write(`PERFPROBE_RESULT ${resultJson}\n`);
});
