// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Regression tests for StateTransitions viewport rebuild behavior.
 * Codex review: pan/zoom/sync must rebuild sliced datasets from fullData, not
 * only re-dispatch stale pending datasets.
 */

import type { Immutable } from "@foxglove/studio";

import type { Dataset, UpdateAction } from "./StateTransitionsChartRenderer";
import { StateTransitionsCoordinator } from "./StateTransitionsCoordinator";
import {
  IStateTransitionsDatasetBuilder,
  LocalStateTransitionsDatasetBuilder,
} from "./StateTransitionsDatasetBuilder";
import {
  PackedStateTransitionDataset,
  StateTransitionsDatasetAction,
  unpackStateTransitionDataset,
} from "./StateTransitionsDatasetBuilderImpl";
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
    updateDatasets: jest.fn(async (datasets: Array<Dataset | PackedStateTransitionDataset>) => {
      datasetSnapshots.push(
        datasets.map((dataset) =>
          "x" in dataset ? { data: unpackStateTransitionDataset(dataset) } : dataset,
        ),
      );
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

function makeCoordinator(renderer: StateTransitionsRenderer): StateTransitionsCoordinator {
  return new StateTransitionsCoordinator(renderer, new LocalStateTransitionsDatasetBuilder());
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

describe("StateTransitionsCoordinator viewport rebuild", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it("rebuilds datasets after setGlobalBounds so slice tracks synced view", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);

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
    const coordinator = makeCoordinator(renderer);

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

describe("StateTransitionsCoordinator block gap tolerance", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it("does not skip past an unloaded block and lose its history when it arrives late", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);

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

    // 4 blocks × 5 samples at 1 Hz. Each block holds one constant value; the render transform
    // emits one point per state change plus the trailing endpoint.
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
    const coordinator = makeCoordinator(renderer);
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

  it("restores raw streaming history when Show Points is enabled, without a player re-emit", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    const config = {
      isSynced: false,
      paths: [{ value: "/t.data", timestampMethod: "receiveTime" as const }],
    };

    coordinator.handleConfig(config, {});
    coordinator.handlePlayerState(
      playerState({ messages: [makeMsg(0, 1), makeMsg(1, 1), makeMsg(2, 1)] }),
    );
    await settleCoordinator();
    // With Show Points off the render transform collapses the plateau to its endpoints...
    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toEqual([0, 2]);

    coordinator.handleConfig({ ...config, showPoints: true }, {});
    await settleCoordinator();

    // ...but the canonical store kept every raw sample, so enabling Show Points renders the
    // interior point too — for live-only sources, with no blocks and no further player emits.
    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toEqual([0, 1, 2]);
    coordinator.destroy();
  });

  it("sorts header-stamped block data before viewport slicing", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    const headerStampedMessages = [
      { receiveSec: 0, stampSec: 0, value: 0 },
      { receiveSec: 1, stampSec: 100, value: 2 },
      { receiveSec: 2, stampSec: 50, value: 1 },
    ].map(({ receiveSec, stampSec, value }) => ({
      ...makeMsg(receiveSec, value),
      message: { data: value, header: { stamp: { sec: stampSec, nsec: 0 } } },
    }));

    coordinator.handleConfig(
      {
        isSynced: true,
        paths: [{ value: "/t.data", timestampMethod: "headerStamp" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({ blockMessages: headerStampedMessages }));
    coordinator.setGlobalBounds({ min: 40, max: 60 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toEqual([0, 50, 100]);
    coordinator.destroy();
  });

  it("rebuilds sliced datasets when axis config bounds change without a player emit", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    const blockMessages = Array.from({ length: 10 }, (_, sec) => makeMsg(sec, sec));

    coordinator.handleConfig(
      {
        isSynced: false,
        xAxisMinValue: 0,
        xAxisMaxValue: 4,
        paths: [{ value: "/t.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({ blockMessages }));
    await settleCoordinator();

    // The narrow view's slice cannot include the tail of the recording.
    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).not.toContain(9);

    // Widening the configured axis on a paused source must rebuild the slice immediately —
    // there is no player emit coming to do it later.
    coordinator.handleConfig(
      {
        isSynced: false,
        xAxisMinValue: 0,
        xAxisMaxValue: 9,
        paths: [{ value: "/t.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toContain(9);
    coordinator.destroy();
  });

  it("keeps a live header-stamped sample whose stamp falls between block stamps", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    // Blocks receive-ordered with non-monotonic header stamps: [0, 100, 50].
    const headerStampedBlocks = [
      { receiveSec: 0, stampSec: 0, value: 0 },
      { receiveSec: 1, stampSec: 100, value: 2 },
      { receiveSec: 2, stampSec: 50, value: 1 },
    ].map(({ receiveSec, stampSec, value }) => ({
      ...makeMsg(receiveSec, value),
      message: { data: value, header: { stamp: { sec: stampSec, nsec: 0 } } },
    }));
    // Live sample stamped 75: below the blocks' max stamp but absent from the blocks. Range
    // dedupe against the sorted maximum would silently discard this transition.
    const liveMsg = {
      ...makeMsg(3, 3),
      message: { data: 3, header: { stamp: { sec: 75, nsec: 0 } } },
    };

    coordinator.handleConfig(
      {
        isSynced: true,
        paths: [{ value: "/t.data", timestampMethod: "headerStamp" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({ blockMessages: headerStampedBlocks }));
    coordinator.handlePlayerState(
      playerState({ blockMessages: headerStampedBlocks, messages: [liveMsg] }),
    );
    coordinator.setGlobalBounds({ min: 40, max: 80 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toContain(75);
    coordinator.destroy();
  });

  it("slices at least the renderer's half-range pan buffer around the viewport", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    const blockMessages = Array.from({ length: 100 }, (_, sec) => makeMsg(sec, sec));

    coordinator.handleConfig(
      {
        isSynced: true,
        paths: [{ value: "/t.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({ blockMessages }));
    coordinator.setGlobalBounds({ min: 40, max: 60 });
    await settleCoordinator();

    // downsampleStates keeps half a view range on each side as its pan/zoom buffer; the slice
    // must cover it ([30, 70] here) or fast pans expose blank regions until the next rebuild.
    const xs = datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x) ?? [];
    expect(xs).toContain(32);
    expect(xs).toContain(68);
    expect(xs).not.toContain(20);
    coordinator.destroy();
  });

  it("keeps header-stamped history sorted across incremental block loads", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    const stamped = (receiveSec: number, stampSec: number, value: number) => ({
      ...makeMsg(receiveSec, value),
      message: { data: value, header: { stamp: { sec: stampSec, nsec: 0 } } },
    });
    // Later-loaded blocks carry stamps that interleave with the already-sorted prefix
    // ([0, 50, 100] then [25, 75]), exercising the incremental merge rather than a full re-sort.
    const blockA = [stamped(0, 0, 0), stamped(1, 100, 2), stamped(2, 50, 1)];
    const blockB = [stamped(3, 75, 4), stamped(4, 25, 3)];

    coordinator.handleConfig(
      {
        isSynced: true,
        paths: [{ value: "/t.data", timestampMethod: "headerStamp" }],
      },
      {},
    );

    const firstState = playerState({ blockMessages: blockA });
    coordinator.handlePlayerState(firstState);

    // Second progress emission: same first block reference plus a newly loaded block, the shape
    // BlockLoader produces as the cache fills.
    const secondState = playerState({ blockMessages: blockA }) as {
      progress: { messageCache: { blocks: unknown[] } };
    };
    secondState.progress.messageCache.blocks.push({
      messagesByTopic: { "/t": blockB },
      sizeInBytes: blockB.length * 8,
    });
    coordinator.handlePlayerState(secondState as never);
    coordinator.setGlobalBounds({ min: 0, max: 200 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.x)).toEqual([
      0, 25, 50, 75, 100,
    ]);
    coordinator.destroy();
  });

  it("keeps the first streaming value when duplicate timestamps arrive", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
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

describe("StateTransitionsCoordinator range history", () => {
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

  const message = (topic: string, sec: number, value: number) => ({
    topic,
    schemaName: "std_msgs/Float64",
    receiveTime: { sec, nsec: 0 },
    message: { data: value },
    sizeInBytes: 8,
  });

  function playerState(args: {
    messages?: ReturnType<typeof message>[];
    messagesByTopic?: Record<string, ReturnType<typeof message>[]>;
  }) {
    const topics = ["/range", "/fallback", "/disabled"].map((name) => ({
      name,
      schemaName: "std_msgs/Float64",
    }));
    return {
      presence: 3,
      playerId: "range-source",
      progress:
        args.messagesByTopic == undefined
          ? {}
          : {
              messageCache: {
                blocks: [{ messagesByTopic: args.messagesByTopic, sizeInBytes: 24 }],
                startTime: { sec: 0, nsec: 0 },
              },
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
        topics,
        topicStats: new Map(),
        datatypes,
        publishedTopics: new Map(),
        subscribedTopics: new Map(),
        services: new Map(),
      },
    } as never;
  }

  it("uses range data for supported topics and blocks only for per-topic fallbacks", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [
          { value: "/range.data", timestampMethod: "receiveTime" },
          { value: "/fallback.data", timestampMethod: "receiveTime" },
        ],
      },
      {},
    );
    const generation = coordinator.configureHistorySources({
      sourceId: "range-source",
      rangeTopics: new Set(["/range"]),
      isLive: false,
    });

    coordinator.handlePlayerState(
      playerState({
        messages: [message("/range", 6, 99)],
        messagesByTopic: {
          "/range": [message("/range", 0, 99)],
          "/fallback": [message("/fallback", 1, 3), message("/fallback", 3, 4)],
        },
      }),
    );
    await coordinator.handleRangeBatch({
      topic: "/range",
      messages: [message("/range", 2, 1), message("/range", 4, 2)],
      startTime: { sec: 0, nsec: 0 },
      generation,
    });
    coordinator.setGlobalBounds({ min: 0, max: 10 });
    await settleCoordinator();

    const datasets = datasetSnapshots.at(-1);
    expect(datasets?.[0]?.data.map((datum) => [datum.x, datum.value])).toEqual([
      [2, 1],
      [4, 2],
    ]);
    expect(datasets?.[1]?.data.map((datum) => [datum.x, datum.value])).toEqual([
      [1, 3],
      [3, 4],
    ]);
    coordinator.destroy();
  });

  it("rejects stale range generations after a data-source change", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/range.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({}));
    const staleGeneration = coordinator.configureHistorySources({
      sourceId: "old-source",
      rangeTopics: new Set(["/range"]),
      isLive: false,
    });
    const currentGeneration = coordinator.configureHistorySources({
      sourceId: "new-source",
      rangeTopics: new Set(["/range"]),
      isLive: false,
    });

    await coordinator.handleRangeBatch({
      topic: "/range",
      messages: [message("/range", 1, 99)],
      startTime: { sec: 0, nsec: 0 },
      generation: staleGeneration,
    });
    await coordinator.handleRangeBatch({
      topic: "/range",
      messages: [message("/range", 2, 2)],
      startTime: { sec: 0, nsec: 0 },
      generation: currentGeneration,
    });
    coordinator.setGlobalBounds({ min: 0, max: 10 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.value)).toEqual([2]);
    coordinator.destroy();
  });

  it("resets replay history for a fresh range session on the same source", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/range.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({}));
    const firstGeneration = coordinator.configureHistorySources({
      sourceId: "same-source",
      rangeTopics: new Set(["/range"]),
      isLive: false,
      rangeSessionId: 1,
    });
    await coordinator.handleRangeBatch({
      topic: "/range",
      messages: [message("/range", 1, 1)],
      startTime: { sec: 0, nsec: 0 },
      generation: firstGeneration,
    });

    const secondGeneration = coordinator.configureHistorySources({
      sourceId: "same-source",
      rangeTopics: new Set(["/range"]),
      isLive: false,
      rangeSessionId: 2,
    });
    await coordinator.resetRangeTopic({ topic: "/range", generation: secondGeneration });
    await coordinator.handleRangeBatch({
      topic: "/range",
      messages: [message("/range", 2, 2)],
      startTime: { sec: 0, nsec: 0 },
      generation: secondGeneration,
    });
    coordinator.setGlobalBounds({ min: 0, max: 10 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.value)).toEqual([2]);
    coordinator.destroy();
  });

  it("invalidates range callbacks as soon as their subscription cleans up", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/range.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.handlePlayerState(playerState({}));
    const generation = coordinator.configureHistorySources({
      sourceId: "range-source",
      rangeTopics: new Set(["/range"]),
      isLive: false,
      rangeSessionId: 1,
    });
    coordinator.invalidateRangeHistory(generation);
    await coordinator.handleRangeBatch({
      topic: "/range",
      messages: [message("/range", 1, 99)],
      startTime: { sec: 0, nsec: 0 },
      generation,
    });
    coordinator.setGlobalBounds({ min: 0, max: 10 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data).toEqual([]);
    coordinator.destroy();
  });

  it("restores fallback data after history configuration resets an already-fed state", async () => {
    const { renderer, datasetSnapshots } = makeMockRenderer();
    const coordinator = makeCoordinator(renderer);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/fallback.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    const state = playerState({
      messagesByTopic: {
        "/fallback": [message("/fallback", 1, 3), message("/fallback", 3, 4)],
      },
    });

    // Matches the component effect order: player state first, subscription negotiation second.
    coordinator.handlePlayerState(state);
    coordinator.configureHistorySources({
      sourceId: "range-source",
      rangeTopics: new Set(),
      isLive: false,
      rangeSessionId: 1,
    });
    coordinator.handlePlayerState(state);
    coordinator.setGlobalBounds({ min: 0, max: 10 });
    await settleCoordinator();

    expect(datasetSnapshots.at(-1)?.[0]?.data.map((datum) => datum.value)).toEqual([3, 4]);
    coordinator.destroy();
  });

  it("does not subscribe, decode, or retain disabled paths", () => {
    const actions: Immutable<StateTransitionsDatasetAction>[] = [];
    const builder: IStateTransitionsDatasetBuilder = {
      applyActions(nextActions) {
        actions.push(...nextActions);
      },
      async applyActionsAndFlush(nextActions) {
        actions.push(...nextActions);
      },
      async getViewportDatasets() {
        return [];
      },
      destroy() {},
    };
    const { renderer } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer, builder);
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [
          { value: "/disabled.data", timestampMethod: "receiveTime", enabled: false },
          { value: "/fallback.data", timestampMethod: "receiveTime" },
        ],
      },
      {},
    );
    coordinator.handlePlayerState(
      playerState({
        messages: [message("/disabled", 1, 1)],
        messagesByTopic: { "/disabled": [message("/disabled", 1, 1)] },
      }),
    );

    const seriesAction = actions.find((action) => action.type === "set-series");
    expect(seriesAction?.series.map((series) => series.key)).toEqual(["1:/fallback"]);
    expect(
      actions.some(
        (action) =>
          (action.type === "append-full" || action.type === "append-current") &&
          action.key.includes("/disabled"),
      ),
    ).toBe(false);
    coordinator.destroy();
  });

  it("reports rejected viewport work instead of creating an unhandled rejection", async () => {
    const failure = new Error("worker stopped");
    const handleDatasetError = jest.fn();
    const builder: IStateTransitionsDatasetBuilder = {
      applyActions() {},
      async applyActionsAndFlush() {},
      async getViewportDatasets() {
        throw failure;
      },
      destroy() {},
    };
    const { renderer } = makeMockRenderer();
    const coordinator = new StateTransitionsCoordinator(renderer, builder, { handleDatasetError });
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/range.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.setSize({ width: 100, height: 100 });
    await settleCoordinator();

    expect(handleDatasetError).toHaveBeenCalledWith(failure);
    coordinator.destroy();
  });

  it("routes repeated renderer rejections through the panel error handler only once", async () => {
    const failure = new Error("chart worker stopped");
    const handleDatasetError = jest.fn();
    const { renderer, raw } = makeMockRenderer();
    raw.update.mockRejectedValue(failure);
    raw.updateDatasets.mockRejectedValue(failure);
    const coordinator = new StateTransitionsCoordinator(
      renderer,
      new LocalStateTransitionsDatasetBuilder(),
      { handleDatasetError },
    );
    coordinator.handleConfig(
      {
        isSynced: false,
        paths: [{ value: "/range.data", timestampMethod: "receiveTime" }],
      },
      {},
    );
    coordinator.updateDatasets([]);
    await settleCoordinator();

    expect(handleDatasetError).toHaveBeenCalledTimes(1);
    expect(handleDatasetError).toHaveBeenCalledWith(failure);
    coordinator.destroy();
  });
});
