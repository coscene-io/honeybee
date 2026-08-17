// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { unwrap } from "@foxglove/den/monads";
import { parseMessagePath } from "@foxglove/message-path";
import { MessageEvent } from "@foxglove/studio";
import { CustomDatasetWorkerLease } from "@foxglove/studio-base/panels/shared/DatasetWorkerPool";
import {
  MessageBlock,
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@foxglove/studio-base/players/types";

import { CustomDatasetsBuilder } from "./CustomDatasetsBuilder";
import { CustomDatasetsBuilderImpl, UpdateDataAction } from "./CustomDatasetsBuilderImpl";
import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { PlotPath } from "../config";

const builders: CustomDatasetsBuilder[] = [];

function createLocalLease(): CustomDatasetWorkerLease {
  const impl = new CustomDatasetsBuilderImpl();
  const remote = {
    getCsvData: () => impl.getCsvData(),
    getCsvDataChunk: (...args: Parameters<CustomDatasetsBuilderImpl["getCsvDataChunk"]>) =>
      impl.getCsvDataChunk(...args),
    getViewportDatasets: (...args: Parameters<CustomDatasetsBuilderImpl["getViewportDatasets"]>) =>
      impl.getViewportDatasets(...args),
    getXRange: () => impl.getXRange(),
    updateData: (actions: UpdateDataAction[]) => {
      impl.updateData(actions);
    },
  } as unknown as CustomDatasetWorkerLease["remote"];
  return { remote, release: async () => undefined };
}

function createBuilder(
  options?: ConstructorParameters<typeof CustomDatasetsBuilder>[0],
): CustomDatasetsBuilder {
  const builder = new CustomDatasetsBuilder({
    acquireWorker: async () => createLocalLease(),
    ...options,
  });
  builders.push(builder);
  return builder;
}

afterEach(async () => {
  for (const builder of builders.splice(0)) {
    builder.destroy();
  }
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function groupByTopic(events: MessageEvent[]): Record<string, MessageEvent[]> {
  return _.groupBy(events, (item) => item.topic);
}

function buildSeriesItems(
  paths: (Partial<PlotPath> & { key?: string; value: string })[],
): SeriesItem[] {
  return paths.map((item, idx) => {
    const parsed = unwrap(parseMessagePath(item.value));
    const key = (item.key ?? String(idx)) as SeriesConfigKey;

    return {
      configIndex: idx,
      parsed,
      color: "red",
      contrastColor: "blue",
      enabled: item.enabled ?? true,
      timestampMethod: item.timestampMethod ?? "receiveTime",
      key,
      lineSize: item.lineSize ?? 1,
      messagePath: item.value,
      showLine: item.showLine ?? true,
    } satisfies SeriesItem;
  });
}

function buildPlayerState(
  activeDataOverride?: Partial<PlayerStateActiveData>,
  blocks?: readonly (MessageBlock | undefined)[],
): PlayerState {
  return {
    activeData: {
      messages: [],
      currentTime: { sec: 0, nsec: 0 },
      endTime: { sec: 0, nsec: 0 },
      lastSeekTime: 1,
      topics: [],
      speed: 1,
      isPlaying: false,
      repeatEnabled: false,
      topicStats: new Map(),
      startTime: { sec: 0, nsec: 0 },
      datatypes: new Map(),
      totalBytesReceived: 0,
      ...activeDataOverride,
    },
    capabilities: [],
    presence: PlayerPresence.PRESENT,
    profile: undefined,
    playerId: "1",
    progress: {
      fullyLoadedFractionRanges: [],
      messageCache: {
        blocks: blocks ?? [],
        startTime: { sec: 0, nsec: 0 },
      },
    },
  };
}

describe("CustomDatasetsBuilder", () => {
  it("should dataset from current messages", async () => {
    const builder = createBuilder();

    builder.setXPath(parseMessagePath("/foo.val"));
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/baz.val.@negative",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
        ],
      }),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2,
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2,
            },
          },
          {
            topic: "/baz",
            schemaName: "baz",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 4,
            },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });

    expect(result).toEqual({
      datasetRange: { min: 0, max: 2 },
      pathsWithMismatchedDataLengths: new Set(["/baz.val.@negative"]),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 2, value: 2 },
          ],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
        expect.objectContaining({
          data: [{ x: 0, y: -4, value: -4 }],
        }),
      ],
    });
  });

  it("should build updates from blocks", async () => {
    const builder = createBuilder();

    builder.setXPath(parseMessagePath("/foo.val"));
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
          lineSize: 1.0,
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/baz.val.@negative",
          lineSize: 1.0,
        },
      ]),
    );

    const block0 = {
      sizeInBytes: 0,
      messagesByTopic: groupByTopic([
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 0,
          },
        },
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 1,
          },
        },
        {
          topic: "/bar",
          schemaName: "bar",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 0,
          },
        },
      ]),
    };

    // Baz is empty in the first block
    block0.messagesByTopic["/baz"] = [];

    const block1 = {
      sizeInBytes: 0,
      messagesByTopic: groupByTopic([
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 2,
          },
        },
        {
          topic: "/bar",
          schemaName: "bar",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 1,
          },
        },
        {
          topic: "/bar",
          schemaName: "bar",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 2,
          },
        },
        {
          topic: "/baz",
          schemaName: "baz",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 4,
          },
        },
      ]),
    };

    builder.handlePlayerState(buildPlayerState({}, [block0]));
    builder.handlePlayerState(buildPlayerState({}, [block0, block1]));

    const result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });

    expect(result).toEqual({
      datasetRange: { min: 0, max: 2 },
      pathsWithMismatchedDataLengths: new Set(["/baz.val.@negative"]),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 2, value: 2 },
          ],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
        expect.objectContaining({
          data: [{ x: 0, y: -4, value: -4 }],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
      ],
    });
  });

  it.each(["current", "blocks"] as const)("combines all values from arrays (%s)", async (type) => {
    const builder = createBuilder();

    builder.setXPath(parseMessagePath("/foo.values[:].val"));
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.values[:].val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/baz.values[:].val",
        },
      ]),
    );

    let latestBlocks: MessageBlock[] = [];
    const sendMessages = (messages: MessageEvent[]) => {
      if (type === "current") {
        builder.handlePlayerState(buildPlayerState({ messages }));
      } else {
        latestBlocks = [
          ...latestBlocks,
          {
            sizeInBytes: 0,
            messagesByTopic: {
              "/baz": [],
              ...groupByTopic(messages),
            },
          },
        ];
        builder.handlePlayerState(buildPlayerState({}, latestBlocks));
      }
    };

    sendMessages([
      {
        topic: "/foo",
        schemaName: "foo",
        receiveTime: { sec: 0, nsec: 0 },
        sizeInBytes: 0,
        message: {
          values: [{ val: 0 }, { val: 1 }, { val: 2 }],
        },
      },
      {
        topic: "/foo",
        schemaName: "foo",
        receiveTime: { sec: 0, nsec: 0 },
        sizeInBytes: 0,
        message: {
          values: [{ val: 3 }],
        },
      },
      {
        topic: "/bar",
        schemaName: "bar",
        receiveTime: { sec: 0, nsec: 0 },
        sizeInBytes: 0,
        message: {
          values: [{ val: 10 }, { val: 11 }],
        },
      },
    ]);

    sendMessages([
      {
        topic: "/foo",
        schemaName: "foo",
        receiveTime: { sec: 0, nsec: 0 },
        sizeInBytes: 0,
        message: {
          values: [{ val: 4 }],
        },
      },
      {
        topic: "/bar",
        schemaName: "bar",
        receiveTime: { sec: 0, nsec: 0 },
        sizeInBytes: 0,
        message: {
          values: [{ val: 12 }, { val: 13 }, { val: 14 }],
        },
      },
      {
        topic: "/baz",
        schemaName: "baz",
        receiveTime: { sec: 0, nsec: 0 },
        sizeInBytes: 0,
        message: {
          values: [{ val: 20 }, { val: 21 }],
        },
      },
    ]);

    const result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });

    expect(result).toEqual({
      datasetRange: { min: 0, max: 4 },
      pathsWithMismatchedDataLengths: new Set(["/baz.values[:].val"]),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 10, value: 10 },
            { x: 1, y: 11, value: 11 },
            { x: 2, y: 12, value: 12 },
            { x: 3, y: 13, value: 13 },
            { x: 4, y: 14, value: 14 },
          ],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
        expect.objectContaining({
          data: [
            { x: 0, y: 20, value: 20 },
            { x: 1, y: 21, value: 21 },
          ],
        }),
      ],
    });
  });

  it("supports toggling series enabled state", async () => {
    const builder = createBuilder();

    builder.setXPath(parseMessagePath("/foo.val"));
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      datasetRange: { min: 1, max: 1 },
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 1, y: 1, value: 1 }],
        }),
        expect.objectContaining({
          data: [{ x: 1, y: 2, value: 2 }],
        }),
      ],
    });

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: false,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      datasetRange: { min: 1, max: 1 },
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        expect.objectContaining({
          data: [{ x: 1, y: 2, value: 2 }],
        }),
      ],
    });
  });

  it("leaves gaps in datasetsByConfigIndex for missing series", async () => {
    const builder = createBuilder();

    builder.setXPath(parseMessagePath("/foo.val"));
    builder.setSeries([
      {
        configIndex: 3,
        parsed: parseMessagePath("/foo.val")!,
        color: "red",
        contrastColor: "blue",
        enabled: true,
        timestampMethod: "receiveTime",
        key: "x" as SeriesConfigKey,
        lineSize: 1,
        messagePath: "/foo.val",
        showLine: true,
      },
    ]);

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      datasetRange: { min: 1, max: 1 },
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          data: [{ x: 1, y: 1, value: 1 }],
        }),
      ],
    });
  });

  it("owns generation-scoped range topics and extracts a mixed x/y topic together", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x[:]"));
    builder.setSeries(
      buildSeriesItems([{ value: "/same.y[:]" }, { value: "/other.y", showLine: false }]),
    );
    builder.setHistoryTopics(new Set(["/same", "/other"]), new Set(), 7);

    await expect(
      builder.appendRangeMessageBatch(
        "/same",
        [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 3, nsec: 4 },
            sizeInBytes: 0,
            message: { x: [2, 1], y: ["10", false] },
          },
        ],
        { sec: 0, nsec: 0 },
        7,
      ),
    ).resolves.toBe(true);
    await expect(
      builder.appendRangeMessageBatch(
        "/other",
        [
          {
            topic: "/other",
            schemaName: "other",
            receiveTime: { sec: 5, nsec: 0 },
            sizeInBytes: 0,
            message: { y: 99n },
          },
        ],
        { sec: 0, nsec: 0 },
        6,
      ),
    ).resolves.toBe(false);

    // Current messages for a range-owned topic must not be mixed into the replay history.
    builder.handlePlayerState(
      buildPlayerState({
        lastSeekTime: 2,
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 6, nsec: 0 },
            sizeInBytes: 0,
            message: { x: 100, y: 200 },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });
    expect(result.pathsWithMismatchedDataLengths).toEqual(new Set(["/other.y"]));
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([
      { x: 2, y: 10, value: "10" },
      { x: 1, y: 0, value: false },
    ]);
    const dataset = result.datasetsByConfigIndex[0];
    expect(dataset).toBeDefined();
    expect(dataset!.packedData!.points).toHaveLength(4);
  });

  it("preserves an unchanged live topic when another current-only topic is added", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/a.x"));
    builder.setSeries(buildSeriesItems([{ value: "/a.y" }]));
    builder.setHistoryTopics(new Set(), new Set(["/a"]), 1);
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/a",
            schemaName: "a",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { x: 1, y: 10 },
          },
        ],
      }),
    );
    await builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} });

    builder.setSeries(buildSeriesItems([{ value: "/a.y" }, { value: "/b.y" }]));
    builder.setHistoryTopics(new Set(), new Set(["/a", "/b"]), 2);

    const result = await builder.getViewportDatasets({
      size: { width: 100, height: 100 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([{ x: 1, y: 10, value: 10 }]);
  });

  it("reloads blocks from the beginning after a topic leaves range ownership", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    const block = {
      sizeInBytes: 0,
      messagesByTopic: groupByTopic([
        {
          topic: "/same",
          schemaName: "same",
          receiveTime: { sec: 1, nsec: 0 },
          sizeInBytes: 0,
          message: { x: 1, y: 10 },
        },
      ]),
    };
    builder.handlePlayerState(buildPlayerState({}, [block]));
    await builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} });

    builder.setHistoryTopics(new Set(["/same"]), new Set(), 1);
    await builder.appendRangeMessageBatch(
      "/same",
      [
        {
          topic: "/same",
          schemaName: "same",
          receiveTime: { sec: 9, nsec: 0 },
          sizeInBytes: 0,
          message: { x: 9, y: 90 },
        },
      ],
      { sec: 0, nsec: 0 },
      1,
    );
    await expect(builder.releaseRangeTopic("/same", 1)).resolves.toBe(true);
    builder.handlePlayerState(buildPlayerState({}, [block]));

    await expect(
      builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} }),
    ).resolves.toEqual({
      datasetRange: { min: 1, max: 1 },
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [expect.objectContaining({ data: [{ x: 1, y: 10, value: 10 }] })],
    });
  });

  it("preserves x appended while a range-release reset RPC is in flight", async () => {
    const impl = new CustomDatasetsBuilderImpl();
    const resetStarted = deferred<void>();
    const allowReset = deferred<void>();
    let pauseNextReset = false;
    const remote = {
      getCsvData: () => impl.getCsvData(),
      getCsvDataChunk: (...args: Parameters<CustomDatasetsBuilderImpl["getCsvDataChunk"]>) =>
        impl.getCsvDataChunk(...args),
      getViewportDatasets: (
        ...args: Parameters<CustomDatasetsBuilderImpl["getViewportDatasets"]>
      ) => impl.getViewportDatasets(...args),
      getXRange: () => impl.getXRange(),
      async updateData(actions: UpdateDataAction[]) {
        if (pauseNextReset && actions.some((action) => action.type === "reset-full-x")) {
          pauseNextReset = false;
          resetStarted.resolve(undefined);
          await allowReset.promise;
        }
        impl.updateData(actions);
      },
    } as unknown as CustomDatasetWorkerLease["remote"];
    const builder = createBuilder({
      acquireWorker: async () => ({ release: async () => undefined, remote }),
    });
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    builder.setHistoryTopics(new Set(["/same"]), new Set(), 1);
    await expect(
      builder.appendRangeMessageBatch(
        "/same",
        [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { x: 1, y: 10 },
          },
        ],
        { sec: 0, nsec: 0 },
        1,
      ),
    ).resolves.toBe(true);
    builder.handlePlayerState(buildPlayerState({ lastSeekTime: 1, messages: [] }));

    pauseNextReset = true;
    const releasePromise = builder.releaseRangeTopic("/same", 1);
    await resetStarted.promise;
    expect(
      builder.handlePlayerState(
        buildPlayerState({
          lastSeekTime: 1,
          messages: [
            {
              topic: "/same",
              schemaName: "same",
              receiveTime: { sec: 2, nsec: 0 },
              sizeInBytes: 0,
              message: { x: 2, y: 20 },
            },
          ],
        }),
      ),
    ).toEqual({ min: 2, max: 2 });
    allowReset.resolve(undefined);

    await expect(releasePromise).resolves.toBe(true);
    expect(builder.handlePlayerState(buildPlayerState({ lastSeekTime: 1 }))).toEqual({
      min: 0,
      max: 2,
    });
    await expect(
      builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} }),
    ).resolves.toEqual(expect.objectContaining({ datasetRange: { min: 2, max: 2 } }));
  });

  it("flushes pending compact batches before exporting CSV", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 3, nsec: 4 },
            sizeInBytes: 0,
            message: { x: 1, y: "2" },
          },
        ],
      }),
    );

    await expect(builder.getCsvData()).resolves.toEqual([
      {
        label: "/same.y",
        data: [
          {
            x: 1,
            y: 2,
            receiveTime: { sec: 3, nsec: 4 },
            value: "2",
          },
        ],
      },
    ]);
  });

  it("flushes pending compact batches and stops the CSV cursor after cancellation", async () => {
    const impl = new CustomDatasetsBuilderImpl();
    const callOrder: string[] = [];
    const getCsvDataChunk = jest.fn(
      (...args: Parameters<CustomDatasetsBuilderImpl["getCsvDataChunk"]>) => {
        callOrder.push("chunk");
        return impl.getCsvDataChunk(...args);
      },
    );
    const remote = {
      getCsvData: () => impl.getCsvData(),
      getCsvDataChunk,
      getViewportDatasets: (
        ...args: Parameters<CustomDatasetsBuilderImpl["getViewportDatasets"]>
      ) => impl.getViewportDatasets(...args),
      getXRange: () => {
        callOrder.push("range");
        return impl.getXRange();
      },
      updateData: (actions: UpdateDataAction[]) => {
        callOrder.push("update");
        impl.updateData(actions);
      },
    } as unknown as CustomDatasetWorkerLease["remote"];
    const builder = createBuilder({
      acquireWorker: async () => ({ release: async () => undefined, remote }),
    });
    builder.setXPath(parseMessagePath("/same.x[:]"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y[:]" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 3, nsec: 4 },
            sizeInBytes: 0,
            message: { x: [1, 2], y: ["3", "4"] },
          },
        ],
      }),
    );
    const callback = jest.fn(async () => {
      callOrder.push("callback");
      return false;
    });

    await expect(builder.forEachCsvDataChunk(callback, 50_000)).resolves.toBe(false);

    expect(callOrder).toEqual(["update", "chunk", "callback", "range"]);
    expect(getCsvDataChunk).toHaveBeenCalledTimes(1);
    expect(getCsvDataChunk).toHaveBeenCalledWith(undefined, 10_000);
    expect(callback).toHaveBeenCalledWith([
      {
        label: "/same.y[:]",
        data: [
          { x: 1, y: 3, receiveTime: { sec: 3, nsec: 4 }, value: "3" },
          { x: 2, y: 4, receiveTime: { sec: 3, nsec: 4 }, value: "4" },
        ],
      },
    ]);
  });

  it("does not poison the worker session when a CSV consumer rejects", async () => {
    const impl = new CustomDatasetsBuilderImpl();
    const release = jest.fn(async () => undefined);
    const remote = {
      getCsvData: () => impl.getCsvData(),
      getCsvDataChunk: (...args: Parameters<CustomDatasetsBuilderImpl["getCsvDataChunk"]>) =>
        impl.getCsvDataChunk(...args),
      getViewportDatasets: (
        ...args: Parameters<CustomDatasetsBuilderImpl["getViewportDatasets"]>
      ) => impl.getViewportDatasets(...args),
      getXRange: () => impl.getXRange(),
      updateData: (actions: UpdateDataAction[]) => {
        impl.updateData(actions);
      },
    } as unknown as CustomDatasetWorkerLease["remote"];
    const handleWorkerError = jest.fn();
    const builder = createBuilder({
      acquireWorker: async () => ({ release, remote }),
      handleWorkerError,
    });
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { x: 1, y: 2 },
          },
        ],
      }),
    );
    const callbackError = new Error("CSV consumer failed");

    await expect(
      builder.forEachCsvDataChunk(async () => {
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);
    await expect(builder.getXRange()).resolves.toEqual({ min: 1, max: 1 });
    expect(handleWorkerError).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("resets disabled non-range series on seek before they are enabled again", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ enabled: true, value: "/same.y" }]));
    builder.handlePlayerState(
      buildPlayerState({
        lastSeekTime: 1,
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { x: 1, y: 10 },
          },
        ],
      }),
    );
    await builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} });

    builder.setSeries(buildSeriesItems([{ enabled: false, value: "/same.y" }]));
    builder.handlePlayerState(buildPlayerState({ lastSeekTime: 2, messages: [] }));
    builder.setSeries(buildSeriesItems([{ enabled: true, value: "/same.y" }]));
    builder.handlePlayerState(
      buildPlayerState({
        lastSeekTime: 2,
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { x: 2, y: 20 },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets({
      size: { width: 100, height: 100 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([{ x: 2, y: 20, value: 20 }]);
  });

  it("clears one range topic before consuming a replacement iterator", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    builder.setHistoryTopics(new Set(["/same"]), new Set(), 4);
    const makeEvent = (x: number, y: number): MessageEvent => ({
      topic: "/same",
      schemaName: "same",
      receiveTime: { sec: x, nsec: 0 },
      sizeInBytes: 0,
      message: { x, y },
    });

    await expect(
      builder.appendRangeMessageBatch("/same", [makeEvent(1, 10)], { sec: 0, nsec: 0 }, 4),
    ).resolves.toBe(true);
    await expect(builder.resetRangeTopic("/same", 4)).resolves.toBe(true);
    await expect(
      builder.appendRangeMessageBatch("/same", [makeEvent(2, 20)], { sec: 0, nsec: 0 }, 4),
    ).resolves.toBe(true);

    const result = await builder.getViewportDatasets({
      size: { width: 100, height: 100 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([{ x: 2, y: 20, value: 20 }]);
    await expect(builder.resetRangeTopic("/same", 3)).resolves.toBe(false);
  });

  it("keeps a quiet range playback head across iterator replacement and clears it on fallback", async () => {
    const builder = createBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    builder.setHistoryTopics(new Set(["/same"]), new Set(), 6);
    const viewport = { size: { width: 100, height: 100 }, bounds: {} };
    const currentTime = { sec: 4, nsec: 0 };
    const makeMessage = (y: number): MessageEvent => ({
      topic: "/same",
      schemaName: "same",
      receiveTime: currentTime,
      sizeInBytes: 0,
      message: { y },
    });

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 1, messages: [makeMessage(40)] }),
    );
    let result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([40]);

    await expect(builder.resetRangeTopic("/same", 6)).resolves.toBe(true);
    result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.currentValuesByConfigIndex).toEqual([40]);

    await expect(builder.releaseRangeTopic("/same", 6)).resolves.toBe(true);
    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 1, messages: [makeMessage(400)] }),
    );
    result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.currentValuesByConfigIndex).toEqual([400]);
  });

  it("clears full x/y and current legend storage when the player changes without a new seek", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    builder.setHistoryTopics(new Set(["/same"]), new Set(), 9);
    const viewport = { size: { width: 100, height: 100 }, bounds: {} };
    const currentTime = { sec: 2, nsec: 0 };
    const event: MessageEvent = {
      topic: "/same",
      schemaName: "same",
      receiveTime: currentTime,
      sizeInBytes: 0,
      message: { x: 2, y: 20 },
    };

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 1, messages: [event] }),
    );
    await builder.appendRangeMessageBatch("/same", [event], { sec: 0, nsec: 0 }, 9);
    await expect(builder.getViewportDatasets(viewport, currentTime)).resolves.toEqual(
      expect.objectContaining({
        currentValuesByConfigIndex: [20],
        datasetRange: { min: 2, max: 2 },
      }),
    );

    builder.handlePlayerState({ ...buildPlayerState(), activeData: undefined, playerId: "2" });
    let result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);
    expect(result.datasetRange).toEqual({ min: 0, max: 1 });

    builder.handlePlayerState({
      ...buildPlayerState({ currentTime, lastSeekTime: 1, messages: [] }),
      playerId: "2",
    });
    result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);
    expect(result.datasetRange).toEqual({ min: 0, max: 1 });
  });

  it("reports authoritative bounds after current storage culls an old extreme", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x[:]"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y[:]" }]));
    const x = Array.from({ length: 50_001 }, (_, index) => (index === 0 ? -999 : index));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { x, y: x },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} }),
    ).resolves.toEqual(expect.objectContaining({ datasetRange: { min: 12_501, max: 50_000 } }));
    await expect(builder.getXRange()).resolves.toEqual({ min: 12_501, max: 50_000 });
  });

  it("replaces culled bounds while preserving x updates queued during the range RPC", async () => {
    const impl = new CustomDatasetsBuilderImpl();
    const rangeStarted = deferred<void>();
    const allowRange = deferred<void>();
    let pauseNextRange = true;
    const remote = {
      getCsvData: () => impl.getCsvData(),
      getViewportDatasets: (
        ...args: Parameters<CustomDatasetsBuilderImpl["getViewportDatasets"]>
      ) => impl.getViewportDatasets(...args),
      async getXRange() {
        if (pauseNextRange) {
          pauseNextRange = false;
          rangeStarted.resolve(undefined);
          await allowRange.promise;
        }
        return impl.getXRange();
      },
      updateData: (actions: UpdateDataAction[]) => {
        impl.updateData(actions);
      },
    } as unknown as CustomDatasetWorkerLease["remote"];
    const builder = createBuilder({
      acquireWorker: async () => ({ release: async () => undefined, remote }),
    });
    builder.setXPath(parseMessagePath("/same.x[:]"));
    const x = Array.from({ length: 50_001 }, (_, index) => (index === 0 ? -999 : index));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { x },
          },
        ],
      }),
    );
    const firstRange = builder.getXRange();
    await rangeStarted.promise;

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/same",
            schemaName: "same",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { x: [60_000] },
          },
        ],
      }),
    );
    allowRange.resolve(undefined);

    await expect(firstRange).resolves.toEqual({ min: 12_501, max: 60_000 });
    expect(builder.handlePlayerState(buildPlayerState({ lastSeekTime: 1 }))).toEqual({
      min: 12_501,
      max: 60_000,
    });
    await expect(builder.getXRange()).resolves.toEqual({ min: 12_501, max: 60_000 });
  });

  it("releases promptly when an in-flight application RPC never settles", async () => {
    const updateStarted = deferred<void>();
    const release = jest.fn(async () => undefined);
    const remote = {
      getCsvData: () => [],
      getViewportDatasets: () => ({
        datasetsByConfigIndex: [],
        pathsWithMismatchedDataLengths: new Set<string>(),
      }),
      getXRange: () => ({ min: 0, max: 1 }),
      async updateData() {
        updateStarted.resolve(undefined);
        await new Promise<never>(() => undefined);
      },
    } as unknown as CustomDatasetWorkerLease["remote"];
    const builder = createBuilder({
      acquireWorker: async () => ({ release, remote }),
    });
    builder.setXPath(parseMessagePath("/same.x"));
    const pending = builder.getXRange();
    await updateStarted.promise;

    builder.destroy();

    await expect(pending).resolves.toBeUndefined();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(release).toHaveBeenCalledWith({ broken: false });
  });

  it("releases only its logical lease after an application RPC rejects", async () => {
    const release = jest.fn(async () => undefined);
    const remote = {
      getCsvData: () => [],
      getViewportDatasets: () => ({
        datasetsByConfigIndex: [],
        pathsWithMismatchedDataLengths: new Set<string>(),
      }),
      getXRange() {
        throw new Error("bad custom request");
      },
      updateData() {},
    } as unknown as CustomDatasetWorkerLease["remote"];
    const handleWorkerError = jest.fn();
    const builder = createBuilder({
      acquireWorker: async () => ({ release, remote }),
      handleWorkerError,
    });

    await expect(builder.getXRange()).rejects.toThrow("bad custom request");
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(release).toHaveBeenCalledWith({ broken: false });
    expect(handleWorkerError).toHaveBeenCalledTimes(1);
  });

  it("makes destroy idempotent and suppresses results from queued worker operations", async () => {
    const builder = createBuilder();
    builder.setXPath(parseMessagePath("/same.x"));
    builder.setSeries(buildSeriesItems([{ value: "/same.y" }]));
    const pending = builder.getViewportDatasets({
      size: { width: 100, height: 100 },
      bounds: {},
    });

    builder.destroy();
    builder.destroy();

    await expect(pending).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [],
    });
    await expect(
      builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [],
    });
    await expect(builder.getCsvData()).resolves.toEqual([]);
  });
});
