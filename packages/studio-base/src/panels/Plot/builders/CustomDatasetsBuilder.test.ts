// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { unwrap } from "@foxglove/den/monads";
import { makeComlinkWorkerMock } from "@foxglove/den/testing";
import { parseMessagePath } from "@foxglove/message-path";
import { MessageEvent } from "@foxglove/studio";
import {
  MessageBlock,
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@foxglove/studio-base/players/types";

import { CustomDatasetsBuilder } from "./CustomDatasetsBuilder";
import { CustomDatasetsBuilderImpl } from "./CustomDatasetsBuilderImpl";
import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { PlotPath } from "../config";

Object.defineProperty(global, "Worker", {
  writable: true,
  value: makeComlinkWorkerMock(() => new CustomDatasetsBuilderImpl()),
});

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
    const builder = new CustomDatasetsBuilder();

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
    const builder = new CustomDatasetsBuilder();

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
    const builder = new CustomDatasetsBuilder();

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
    const builder = new CustomDatasetsBuilder();

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
    const builder = new CustomDatasetsBuilder();

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
    const builder = new CustomDatasetsBuilder();
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
    expect(result.datasetsByConfigIndex[0]).toEqual(
      expect.objectContaining({
        data: [
          { x: 2, y: 10, value: "10" },
          { x: 1, y: 0, value: false },
        ],
        packedData: expect.objectContaining({ points: expect.any(Float64Array) }),
      }),
    );
  });

  it("reloads blocks from the beginning after a topic leaves range ownership", async () => {
    const builder = new CustomDatasetsBuilder();
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
    builder.setHistoryTopics(new Set(), new Set(), 2);
    builder.handlePlayerState(buildPlayerState({}, [block]));

    await expect(
      builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [expect.objectContaining({ data: [{ x: 1, y: 10, value: 10 }] })],
    });
  });

  it("flushes pending compact batches before exporting CSV", async () => {
    const builder = new CustomDatasetsBuilder();
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

  it("makes destroy idempotent and suppresses results from queued worker operations", async () => {
    const builder = new CustomDatasetsBuilder();
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
