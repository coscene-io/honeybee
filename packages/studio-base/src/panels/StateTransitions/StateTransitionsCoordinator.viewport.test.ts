// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Regression tests for REI-125 StateTransitions viewport rebuild behavior.
 * Codex review: pan/zoom/sync must rebuild sliced datasets from fullData, not
 * only re-dispatch stale pending datasets.
 */

import type { Dataset, UpdateAction } from "./StateTransitionsChartRenderer";
import { StateTransitionsCoordinator } from "./StateTransitionsCoordinator";
import type { StateTransitionsRenderer } from "./StateTransitionsRenderer";

function makeMockRenderer() {
  const updates: UpdateAction[] = [];
  const datasetSnapshots: Dataset[][] = [];
  const renderer = {
    update: jest.fn(async (action: UpdateAction) => {
      updates.push(action);
      // Simulate pan/zoom resulting bounds when interaction events are present.
      if ((action.interactionEvents?.length ?? 0) > 0) {
        return { x: { min: 40, max: 60 }, y: { min: -20, max: 0 } };
      }
      return { x: { min: 0, max: 30 }, y: { min: -20, max: 0 } };
    }),
    updateDatasets: jest.fn(async (datasets: Dataset[]) => {
      datasetSnapshots.push(datasets);
      return { min: 0, max: 1, left: 0, right: 100 };
    }),
    getElementsAtPixel: jest.fn(async () => []),
    getDatalabelAtEvent: jest.fn(async () => undefined),
  };
  return {
    renderer: renderer as unknown as StateTransitionsRenderer,
    updates,
    datasetSnapshots,
    raw: renderer,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function settleCoordinator(): Promise<void> {
  // throttle 100ms + debouncePromise chains
  await flushMicrotasks();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 150);
  });
  await flushMicrotasks();
}

describe("StateTransitionsCoordinator viewport rebuild (REI-125)", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it("rebuilds datasets after setGlobalBounds so slice tracks synced view", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer);

    coordinator.handleConfig(
      {
        isSynced: true,
        xAxisRange: 30,
        paths: [
          {
            value: "/t.data",
            timestampMethod: "receiveTime",
          },
        ],
      },
      {},
    );

    // Seed fullData indirectly: inject via player-like flow is heavy; instead use
    // setDataRange + handlePlayerState with blocks.
    const datatypes = new Map([
      [
        "std_msgs/Float64",
        {
          name: "std_msgs/Float64",
          definitions: [{ name: "data", type: "float64", isComplex: false, isArray: false }],
        },
      ],
    ]);

    const makeMsg = (sec: number, value: number) => ({
      topic: "/t",
      schemaName: "std_msgs/Float64",
      receiveTime: { sec, nsec: 0 },
      message: { data: value },
      sizeInBytes: 8,
    });

    // Messages spanning 0..100s at 1Hz of constant then change — enough for windowing.
    const blockMessages = Array.from({ length: 101 }, (_, sec) => makeMsg(sec, sec < 50 ? 0 : 1));

    coordinator.handlePlayerState({
      presence: 3,
      playerId: "test",
      progress: {
        messageCache: {
          blocks: [
            {
              messagesByTopic: { "/t": blockMessages },
              sizeInBytes: blockMessages.length * 8,
            },
          ],
          startTime: { sec: 0, nsec: 0 },
        },
      },
      capabilities: [],
      profile: undefined,
      activeData: {
        messages: [],
        totalBytesReceived: 0,
        currentTime: { sec: 30, nsec: 0 },
        startTime: { sec: 0, nsec: 0 },
        endTime: { sec: 100, nsec: 0 },
        isPlaying: false,
        speed: 1,
        lastSeekTime: 1,
        topics: [{ name: "/t", schemaName: "std_msgs/Float64" }],
        topicStats: new Map(),
        datatypes,
        publishedTopics: new Map(),
        subscribedTopics: new Map(),
        services: new Map(),
      },
    } as never);

    await settleCoordinator();
    const snapshotsBeforeSync = datasetSnapshots.length;

    // Sync viewport to a window far from follow mode (40–60).
    coordinator.setGlobalBounds({ min: 40, max: 60 });
    await settleCoordinator();

    expect(datasetSnapshots.length).toBeGreaterThan(snapshotsBeforeSync);
    const series = datasetSnapshots[datasetSnapshots.length - 1]![0];
    expect(series).toBeDefined();
    const xs = series!.data.map((p) => p.x);
    // Sliced rebuild should include points near the synced window (not only 0..30 follow).
    expect(xs.some((x) => x >= 40)).toBe(true);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(40);

    coordinator.destroy();
  });

  it("rebuilds datasets after pan interaction bounds update", async () => {
    const { renderer, datasetSnapshots, raw } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer);

    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/t.data", timestampMethod: "receiveTime" }],
      },
      {},
    );

    const datatypes = new Map([
      [
        "std_msgs/Float64",
        {
          name: "std_msgs/Float64",
          definitions: [{ name: "data", type: "float64", isComplex: false, isArray: false }],
        },
      ],
    ]);

    const blockMessages = Array.from({ length: 80 }, (_, sec) => ({
      topic: "/t",
      schemaName: "std_msgs/Float64",
      receiveTime: { sec, nsec: 0 },
      message: { data: sec },
      sizeInBytes: 8,
    }));

    coordinator.handlePlayerState({
      presence: 3,
      playerId: "test",
      progress: {
        messageCache: {
          blocks: [
            {
              messagesByTopic: { "/t": blockMessages },
              sizeInBytes: blockMessages.length * 8,
            },
          ],
          startTime: { sec: 0, nsec: 0 },
        },
      },
      capabilities: [],
      profile: undefined,
      activeData: {
        messages: [],
        totalBytesReceived: 0,
        currentTime: { sec: 10, nsec: 0 },
        startTime: { sec: 0, nsec: 0 },
        endTime: { sec: 80, nsec: 0 },
        isPlaying: false,
        speed: 1,
        lastSeekTime: 1,
        topics: [{ name: "/t", schemaName: "std_msgs/Float64" }],
        topicStats: new Map(),
        datatypes,
        publishedTopics: new Map(),
        subscribedTopics: new Map(),
        services: new Map(),
      },
    } as never);

    await settleCoordinator();
    const beforeSnapshots = datasetSnapshots.length;

    coordinator.addInteractionEvent({
      type: "pan",
      // Chart.js-like interaction payload shape is opaque to coordinator
    } as never);

    await settleCoordinator();

    // Interaction should trigger renderer.update and a datasets rebuild.
    expect(raw.update).toHaveBeenCalled();
    expect(datasetSnapshots.length).toBeGreaterThan(beforeSnapshots);
    const series = datasetSnapshots[datasetSnapshots.length - 1]![0];
    expect(series).toBeDefined();
    const xs = series!.data.map((p) => p.x);
    // Mock pan bounds 40–60 → rebuilt slice should reach that neighborhood.
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(40);

    coordinator.destroy();
  });
});

describe("StateTransitionsCoordinator block gap tolerance (REI-125)", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it("does not skip past an unloaded block and lose its history when it arrives late", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer);

    coordinator.handleConfig(
      { isSynced: false, paths: [{ value: "/t.data", timestampMethod: "receiveTime" }] },
      {},
    );

    const datatypes = new Map([
      [
        "std_msgs/Float64",
        {
          name: "std_msgs/Float64",
          definitions: [{ name: "data", type: "float64", isComplex: false, isArray: false }],
        },
      ],
    ]);

    // 4 blocks × 5 samples at 1 Hz. Each block holds one constant value, so ingestion collapses
    // it to a start/end pair: block k contributes x = 5k and x = 5k+4.
    const blockMessages = [0, 1, 2, 3].map((blockIdx) =>
      Array.from({ length: 5 }, (_, i) => ({
        topic: "/t",
        schemaName: "std_msgs/Float64",
        receiveTime: { sec: blockIdx * 5 + i, nsec: 0 },
        message: { data: blockIdx },
        sizeInBytes: 8,
      })),
    );

    const block = (idx: number) => ({
      messagesByTopic: { "/t": blockMessages[idx]! },
      sizeInBytes: 40,
    });

    const emit = async (blocks: unknown[]) => {
      coordinator.handlePlayerState({
        presence: 3,
        playerId: "test",
        progress: { messageCache: { blocks, startTime: { sec: 0, nsec: 0 } } },
        capabilities: [],
        profile: undefined,
        activeData: {
          messages: [],
          totalBytesReceived: 0,
          currentTime: { sec: 20, nsec: 0 },
          startTime: { sec: 0, nsec: 0 },
          endTime: { sec: 20, nsec: 0 },
          isPlaying: false,
          speed: 1,
          lastSeekTime: 1,
          topics: [{ name: "/t", schemaName: "std_msgs/Float64" }],
          topicStats: new Map(),
          datatypes,
          publishedTopics: new Map(),
          subscribedTopics: new Map(),
          services: new Map(),
        },
      } as never);
      await settleCoordinator();
    };

    // Pass 1: blocks 0-1 loaded contiguously.
    await emit([block(0), block(1)]);

    // Pass 2: block 2 is still loading but block 3 has arrived. The cursor must stop at the gap
    // rather than consuming block 3 and stranding block 2 behind it.
    await emit([block(0), block(1), undefined, block(3)]);

    // Pass 3: the gap fills in. Both block 2 and block 3 must now be ingested.
    await emit([block(0), block(1), block(2), block(3)]);

    coordinator.setGlobalBounds({ min: 0, max: 20 });
    await settleCoordinator();

    const series = datasetSnapshots[datasetSnapshots.length - 1]![0];
    expect(series).toBeDefined();
    const xs = series!.data.map((p) => p.x);

    // Segment processing emits one point per state change plus a trailing endpoint, so each block
    // contributes its transition at x = 5k. Block 2's transition at x=10 is the regression guard:
    // before the fix block 3 was consumed first, the cursor advanced past index 2, and no reset
    // recovered it — the output was [0, 5, 15, 19] with a silent hole where block 2 belongs.
    expect(xs).toEqual([0, 5, 10, 15, 19]);

    coordinator.destroy();
  });
});

describe("StateTransitionsCoordinator ingestion correctness", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  const datatypes = new Map([
    [
      "std_msgs/Float64",
      {
        name: "std_msgs/Float64",
        definitions: [{ name: "data", type: "float64", isComplex: false, isArray: false }],
      },
    ],
  ]);

  const makeMsg = (sec: number, value: number) => ({
    topic: "/t",
    schemaName: "std_msgs/Float64",
    receiveTime: { sec, nsec: 0 },
    message: { data: value },
    sizeInBytes: 8,
  });

  function playerState(args: {
    messages?: ReturnType<typeof makeMsg>[];
    blockMessages?: ReturnType<typeof makeMsg>[];
  }) {
    const blocks =
      args.blockMessages != undefined
        ? [
            {
              messagesByTopic: { "/t": args.blockMessages },
              sizeInBytes: args.blockMessages.length * 8,
            },
          ]
        : undefined;
    return {
      presence: 3,
      playerId: "test",
      progress: {
        messageCache: blocks != undefined ? { blocks, startTime: { sec: 0, nsec: 0 } } : undefined,
      },
      capabilities: [],
      profile: undefined,
      activeData: {
        messages: args.messages ?? [],
        totalBytesReceived: 0,
        currentTime: { sec: 5, nsec: 0 },
        startTime: { sec: 0, nsec: 0 },
        endTime: { sec: 10, nsec: 0 },
        isPlaying: false,
        speed: 1,
        lastSeekTime: 1,
        topics: [{ name: "/t", schemaName: "std_msgs/Float64" }],
        topicStats: new Map(),
        datatypes,
        publishedTopics: new Map(),
        subscribedTopics: new Map(),
        services: new Map(),
      },
    } as never;
  }

  it("preserves every sample when Show Points is enabled after data has loaded", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer);
    const blockMessages = [makeMsg(0, 1), makeMsg(1, 1), makeMsg(2, 1)];
    const config = {
      isSynced: false,
      paths: [{ value: "/t.data", timestampMethod: "receiveTime" as const }],
    };

    coordinator.handleConfig(config, {});
    coordinator.handlePlayerState(playerState({ blockMessages }));
    await settleCoordinator();
    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toEqual([0, 2]);

    coordinator.handleConfig({ ...config, showPoints: true }, {});
    coordinator.handlePlayerState(playerState({ blockMessages }));
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toEqual([0, 1, 2]);
    coordinator.destroy();
  });

  it("keeps the first streaming value when duplicate timestamps arrive", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/t.data", timestampMethod: "receiveTime" }],
      },
      {},
    );

    coordinator.handlePlayerState(playerState({ messages: [makeMsg(5, 1), makeMsg(5, 2)] }));
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.value)).toEqual([1]);
    coordinator.destroy();
  });
});
