// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { unwrap } from "@foxglove/den/monads";
import { parseMessagePath } from "@foxglove/message-path";
import {
  MessageBlock,
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@foxglove/studio-base/players/types";

import { CurrentCustomDatasetsBuilder } from "./CurrentCustomDatasetsBuilder";
import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { PlotPath } from "../config";

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
      lineSize: 1,
      messagePath: item.value,
      showLine: true,
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

describe("CurrentCustomDatasetsBuilder", () => {
  it("applies a math function to both the plotted and current value", async () => {
    const builder = new CurrentCustomDatasetsBuilder();

    builder.setXPath(parseMessagePath("/foo.val.@negative"));
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val.@abs",
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
              val: 4,
            },
          },
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: -3,
            },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets();

    expect(result).toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: -4, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } }],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
      ],
    });

    const resultWithCurrentValue = await builder.getViewportDatasets(undefined, {
      sec: 0,
      nsec: 0,
    });
    expect(resultWithCurrentValue.currentValuesByConfigIndex).toEqual([3]);
    expect(resultWithCurrentValue.datasetsByConfigIndex[0]?.data[0]?.y).toBe(3);
  });

  it("keeps the last non-empty y path match for the current value only", async () => {
    const builder = new CurrentCustomDatasetsBuilder();
    builder.setXPath(parseMessagePath("/x.val"));
    builder.setSeries(buildSeriesItems([{ value: "/y.val" }]));
    const message = (topic: string, sec: number, value: unknown) => ({
      topic,
      schemaName: topic,
      receiveTime: { sec, nsec: 0 },
      sizeInBytes: 0,
      message: value,
    });

    builder.handlePlayerState(
      buildPlayerState({
        currentTime: { sec: 4, nsec: 0 },
        messages: [
          message("/x", 1, { val: 10 }),
          message("/x", 2, 2),
          message("/y", 3, { val: 30 }),
          message("/y", 4, 4),
        ],
      }),
    );

    const result = await builder.getViewportDatasets(undefined, { sec: 4, nsec: 0 });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([30]);
  });

  it("supports toggling series enabled state", async () => {
    const builder = new CurrentCustomDatasetsBuilder();

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

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 1, y: 1, value: 1, receiveTime: { sec: 0, nsec: 0 } }],
        }),
        expect.objectContaining({
          data: [{ x: 1, y: 2, value: 2, receiveTime: { sec: 0, nsec: 0 } }],
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

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        expect.objectContaining({
          data: [{ x: 1, y: 2, value: 2, receiveTime: { sec: 0, nsec: 0 } }],
        }),
      ],
    });
  });

  it("leaves gaps in datasetsByConfigIndex for missing series", async () => {
    const builder = new CurrentCustomDatasetsBuilder();

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

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          data: [{ x: 1, y: 1, value: 1, receiveTime: { sec: 0, nsec: 0 } }],
        }),
      ],
    });
  });

  it("returns the latest exact y value and clears it on seek, inactive, and source change", async () => {
    const builder = new CurrentCustomDatasetsBuilder();
    builder.setXPath(parseMessagePath("/x.val"));
    builder.setSeries(buildSeriesItems([{ value: "/y.val" }]));
    const currentTime = { sec: 10, nsec: 0 };
    const messages = (value: string | bigint) => [
      {
        topic: "/x",
        schemaName: "x",
        receiveTime: currentTime,
        sizeInBytes: 0,
        message: { val: 1 },
      },
      {
        topic: "/y",
        schemaName: "y",
        receiveTime: currentTime,
        sizeInBytes: 0,
        message: { val: value },
      },
    ];

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 1, messages: messages("001.50") }),
    );
    await expect(builder.getViewportDatasets(undefined, currentTime)).resolves.toEqual(
      expect.objectContaining({ currentValuesByConfigIndex: ["001.50"] }),
    );

    builder.handlePlayerState(buildPlayerState({ currentTime, lastSeekTime: 2, messages: [] }));
    let result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);

    builder.handlePlayerState(
      buildPlayerState({
        currentTime,
        lastSeekTime: 2,
        messages: messages(9_007_199_254_740_993n),
      }),
    );
    result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.currentValuesByConfigIndex).toEqual([9_007_199_254_740_993n]);

    builder.handlePlayerState({ ...buildPlayerState(), activeData: undefined });
    result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).not.toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 2, messages: messages("7") }),
    );
    builder.handlePlayerState({ ...buildPlayerState(), activeData: undefined, playerId: "2" });
    result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);
  });

  it("stops chunking the latest custom dataset when the callback cancels", async () => {
    const builder = new CurrentCustomDatasetsBuilder();
    builder.setXPath(parseMessagePath("/x.val[:]"));
    builder.setSeries(buildSeriesItems([{ value: "/y.val[:]" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/x",
            schemaName: "x",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: [10, 20, 30, 40] },
          },
          {
            topic: "/y",
            schemaName: "y",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { val: [1, 2, 3, 4] },
          },
        ],
      }),
    );
    const callback = jest.fn(async () => false);

    await expect(builder.forEachCsvDataChunk(callback, 2)).resolves.toBe(false);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([
      {
        label: "/y.val[:]",
        data: [
          expect.objectContaining({ x: 10, value: 1 }),
          expect.objectContaining({ x: 20, value: 2 }),
        ],
      },
    ]);
  });
});
