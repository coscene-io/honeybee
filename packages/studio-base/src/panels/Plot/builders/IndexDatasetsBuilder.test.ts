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

import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { IndexDatasetsBuilder } from "./IndexDatasetsBuilder";
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

describe("IndexDatasetsBuilder", () => {
  it("should produce a dataset", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
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
          data: [{ x: 0, y: -3, value: -3, receiveTime: { sec: 0, nsec: 0 } }],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
      ],
    });
  });

  it("keeps the last non-empty path match for the current value only", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
    const message = (sec: number, value: unknown) => ({
      topic: "/foo",
      schemaName: "foo",
      receiveTime: { sec, nsec: 0 },
      sizeInBytes: 0,
      message: value,
    });

    builder.handlePlayerState(
      buildPlayerState({
        currentTime: { sec: 4, nsec: 0 },
        messages: [message(1, { val: 1 }), message(2, 2), message(3, { val: 3 }), message(4, 4)],
      }),
    );

    const result = await builder.getViewportDatasets(undefined, { sec: 4, nsec: 0 });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([3]);
  });

  it("should return the existing dataset range when no input messages", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val[:]",
        },
      ]),
    );

    const range = builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: [1, 2, 3],
            },
          },
        ],
      }),
    );

    const rangeAgain = builder.handlePlayerState(
      buildPlayerState({
        messages: [],
      }),
    );

    expect(rangeAgain).toEqual(range);
  });

  it("applies a math function to both the plotted and current value", async () => {
    const builder = new IndexDatasetsBuilder();

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
          data: [{ x: 0, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } }],
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

  it("supports toggling series enabled state", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val[:]",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val[:]",
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
              val: [1, 2],
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: [3, 4, 5],
            },
          },
        ],
      }),
    );

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 1, value: 1, receiveTime: { sec: 0, nsec: 0 } },
            { x: 1, y: 2, value: 2, receiveTime: { sec: 0, nsec: 0 } },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } },
            { x: 1, y: 4, value: 4, receiveTime: { sec: 0, nsec: 0 } },
            { x: 2, y: 5, value: 5, receiveTime: { sec: 0, nsec: 0 } },
          ],
        }),
      ],
    });

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: false,
          timestampMethod: "receiveTime",
          value: "/foo.val[:]",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val[:]",
        },
      ]),
    );

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        expect.objectContaining({
          data: [
            { x: 0, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } },
            { x: 1, y: 4, value: 4, receiveTime: { sec: 0, nsec: 0 } },
            { x: 2, y: 5, value: 5, receiveTime: { sec: 0, nsec: 0 } },
          ],
        }),
      ],
    });
  });

  it("leaves gaps in datasetsByConfigIndex for missing series", async () => {
    const builder = new IndexDatasetsBuilder();

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
          data: [{ x: 0, y: 1, value: 1, receiveTime: { sec: 0, nsec: 0 } }],
        }),
      ],
    });
  });

  it("returns the latest exact value and clears it on seek, inactive, and source change", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
    const currentTime = { sec: 10, nsec: 0 };
    const message = (value: string | bigint) => ({
      topic: "/foo",
      schemaName: "foo",
      receiveTime: currentTime,
      sizeInBytes: 0,
      message: { val: value },
    });

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 1, messages: [message("001.50")] }),
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
        messages: [message(9_007_199_254_740_993n)],
      }),
    );
    result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.currentValuesByConfigIndex).toEqual([9_007_199_254_740_993n]);

    builder.handlePlayerState({ ...buildPlayerState(), activeData: undefined });
    result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).not.toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 2, messages: [message("7")] }),
    );
    builder.handlePlayerState({ ...buildPlayerState(), activeData: undefined, playerId: "2" });
    result = await builder.getViewportDatasets(undefined, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);
  });

  it("streams the latest index datasets in bounded chunks and series order", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val[:]" }, { value: "/bar.val[:]" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: [1, 2, 3, 4] },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { val: [5, 6, 7] },
          },
        ],
      }),
    );
    const chunkSizes: number[] = [];
    const rows: { label: string; value: unknown }[] = [];

    await builder.forEachCsvDataChunk((datasets) => {
      chunkSizes.push(datasets.reduce((sum, dataset) => sum + dataset.data.length, 0));
      for (const dataset of datasets) {
        rows.push(...dataset.data.map((datum) => ({ label: dataset.label, value: datum.value })));
      }
    }, 3);

    expect(chunkSizes).toEqual([3, 3, 1]);
    expect(rows).toEqual([
      { label: "/foo.val[:]", value: 1 },
      { label: "/foo.val[:]", value: 2 },
      { label: "/foo.val[:]", value: 3 },
      { label: "/foo.val[:]", value: 4 },
      { label: "/bar.val[:]", value: 5 },
      { label: "/bar.val[:]", value: 6 },
      { label: "/bar.val[:]", value: 7 },
    ]);
  });
});
