// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { collectTransferableBuffers } from "@foxglove/den/worker";
import { parseMessagePath } from "@foxglove/message-path";
import { Time } from "@foxglove/studio";

import { CustomDatasetsBuilderImpl } from "./CustomDatasetsBuilderImpl";
import {
  encodeNumericItems,
  encodeValueItems,
  ValueItem,
  ValueItemBatch,
} from "./CustomValueStore";
import {
  MAX_CSV_DATUMS_PER_CHUNK,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import { restoreUnpackedDataAccessor } from "../PackedDataset";
import { OriginalValue } from "../datum";

const viewport: Viewport = { size: { width: 1_000, height: 600 }, bounds: {} };

function seriesItem(key: string, configIndex = 0, overrides: Partial<SeriesItem> = {}): SeriesItem {
  return {
    key: key as SeriesConfigKey,
    configIndex,
    messagePath: `/${key}.value`,
    parsed: parseMessagePath(`/${key}.value`)!,
    color: "red",
    contrastColor: "white",
    timestampMethod: "receiveTime",
    showLine: true,
    lineSize: 1,
    enabled: true,
    ...overrides,
  };
}

function items(
  numericValues: readonly number[],
  originalValues: readonly OriginalValue[] = numericValues,
  receiveTimes?: readonly Time[],
): ValueItem[] {
  return numericValues.map((value, index) => ({
    value,
    originalValue: originalValues[index]!,
    receiveTime: receiveTimes?.[index] ?? { sec: index, nsec: 0 },
  }));
}

describe("CustomDatasetsBuilderImpl", () => {
  it("returns the latest exact receive-time value without leaking future history", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("legend");
    const exactTime = { sec: 2, nsec: 123 };
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(
          items(
            [1, 5],
            [1n, "future"],
            [
              { sec: 1, nsec: 0 },
              { sec: 5, nsec: 0 },
            ],
          ),
        ),
      },
      {
        type: "append-playback-head",
        series: config.key,
        items: encodeValueItems(
          items(
            [2, 3],
            ["earlier tie", exactTime],
            [
              { sec: 2, nsec: 0 },
              { sec: 2, nsec: 0 },
            ],
          ),
        ),
      },
    ]);

    expect(
      builder.getViewportDatasets(viewport, { sec: 2, nsec: 0 }).currentValuesByConfigIndex,
    ).toEqual([exactTime]);
    expect(
      builder.getViewportDatasets(viewport, { sec: 0, nsec: 0 }).currentValuesByConfigIndex,
    ).toEqual([undefined]);
  });

  it("keeps the last exact current value for an equal-time numeric tie", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("current-exact-tie");
    const receiveTime = { sec: 2, nsec: 3 };
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(
          items([7, 7], ["first", 9_007_199_254_740_993n], [receiveTime, receiveTime]),
        ),
      },
    ]);

    expect(builder.getViewportDatasets(viewport, receiveTime).currentValuesByConfigIndex).toEqual([
      9_007_199_254_740_993n,
    ]);
  });

  it.each([
    { expected: "full", order: ["current", "full"] as const },
    { expected: "current", order: ["full", "current"] as const },
  ])("uses action order for equal-time full/current ties: $order", ({ expected, order }) => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem(`action-${order.join("-")}`);
    const receiveTime = { sec: 4, nsec: 0 };
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      ...order.map(
        (source) =>
          ({
            type: source === "full" ? "append-full" : "append-current",
            series: config.key,
            items: encodeValueItems(items([4], [source], [receiveTime])),
          }) as const,
      ),
    ]);

    expect(builder.getViewportDatasets(viewport, receiveTime).currentValuesByConfigIndex).toEqual([
      expected,
    ]);
  });

  it("bounds a one-million-value playback-head action before materialization", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("bounded-head");
    const length = 1_000_000;
    const batch: ValueItemBatch = {
      values: new Float64Array(length),
      receiveTimes: new BigUint64Array(length),
      valueKinds: new Uint8Array(length),
      valuePayloads: new BigUint64Array(length),
      strings: [],
      fallbackValues: [],
      fallbackTimes: [],
    };
    for (let index = 0; index < length; index++) {
      batch.values[index] = index;
      batch.receiveTimes[index] = BigInt(index) * 1_000_000_000n;
    }
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-playback-head", series: config.key, items: batch },
    ]);

    expect(builder.getLegendStorageStats()).toEqual({
      "bounded-head": {
        currentCapacity: 0,
        currentLength: 0,
        peakCurrentCapacity: 0,
        playbackHeadCapacity: 50_000,
        playbackHeadLength: 37_500,
        peakPlaybackHeadCapacity: 50_000,
      },
    });
    expect(
      builder.getViewportDatasets(viewport, { sec: 999_999, nsec: 0 }).currentValuesByConfigIndex,
    ).toEqual([999_999]);
    expect(
      builder.getViewportDatasets(viewport, { sec: 962_499, nsec: 0 }).currentValuesByConfigIndex,
    ).toEqual([undefined]);
  });

  it("looks up current values by receive time in logarithmic work independent of custom x", () => {
    let visited = 0;
    const builder = new CustomDatasetsBuilderImpl({
      onCurrentValuePointVisited: () => visited++,
    });
    const config = seriesItem("legend-probe");
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(
          items(
            Array.from({ length: 100_000 }, (_, index) => index),
            undefined,
            Array.from({ length: 100_000 }, (_, index) => ({ sec: index, nsec: 0 })),
          ),
        ),
      },
    ]);

    expect(
      builder.getViewportDatasets(viewport, { sec: 50_000, nsec: 0 }).currentValuesByConfigIndex,
    ).toEqual([50_000]);
    expect(visited).toBeLessThanOrEqual(20);
  });

  it("preserves custom order and exact original value and receive-time types", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const malformedTime = { sec: 4.5, nsec: -2 };
    const hugeBigInt = 1n << 80n;
    const originalValues: OriginalValue[] = [
      "10.5",
      -7n,
      true,
      { sec: 3, nsec: 4 },
      hugeBigInt,
      malformedTime,
    ];
    const receiveTimes: Time[] = [
      { sec: 1, nsec: 0 },
      { sec: 2, nsec: 0 },
      { sec: 3, nsec: 0 },
      { sec: 4, nsec: 0 },
      { sec: 5, nsec: 0 },
      { sec: 6.5, nsec: -1 },
    ];
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-full-x",
        items: encodeNumericItems(items([3, 1, 2, 0, -1, 4], undefined, receiveTimes)),
      },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(
          items([10.5, -7, 1, 3.000000004, Number(hugeBigInt), 4.499999998], originalValues),
        ),
      },
    ]);

    const viewportResult = builder.getViewportDatasets(viewport);
    expect(viewportResult.datasetsByConfigIndex[0]?.data).toEqual([
      { x: 3, y: 10.5, value: "10.5" },
      { x: 1, y: -7, value: -7n },
      { x: 2, y: 1, value: true },
      { x: 0, y: 3.000000004, value: { sec: 3, nsec: 4 } },
      { x: -1, y: Number(hugeBigInt), value: hugeBigInt },
      { x: 4, y: 4.499999998, value: malformedTime },
    ]);
    expect(builder.getCsvData()[0]?.data).toEqual(
      originalValues.map((value, index) => ({
        x: [3, 1, 2, 0, -1, 4][index],
        y: [10.5, -7, 1, 3.000000004, Number(hugeBigInt), 4.499999998][index],
        receiveTime: receiveTimes[index],
        value,
      })),
    );
  });

  it("continues a CSV cursor across enabled series without changing value or time types", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const first = seriesItem("csv-first", 0);
    const disabled = seriesItem("csv-disabled", 1, { enabled: false });
    const second = seriesItem("csv-second", 2);
    const receiveTimes = [
      { sec: 7, nsec: 8 },
      { sec: 9, nsec: 10 },
      { sec: 11, nsec: 12 },
    ];
    const timeValue = { sec: 5, nsec: 1_000_000_000 };
    builder.updateData([
      { type: "update-series-config", seriesItems: [first, disabled, second] },
      {
        type: "append-full-x",
        items: encodeNumericItems(items([0, 1, 2], undefined, receiveTimes)),
      },
      {
        type: "append-full",
        series: first.key,
        items: encodeValueItems(items([1, 2], [9_999_999_999_999_001n, timeValue])),
      },
      {
        type: "append-full",
        series: disabled.key,
        items: encodeValueItems(items([99])),
      },
      {
        type: "append-full",
        series: second.key,
        items: encodeValueItems(items([2, 3, 4])),
      },
    ]);

    const firstChunk = builder.getCsvDataChunk(undefined, 3);
    expect(firstChunk.nextCursor).toEqual({ seriesIndex: 1, datumIndex: 1 });
    expect(
      firstChunk.datasets.map(({ label, data }) => ({
        label,
        values: data.map((item) => item.value),
      })),
    ).toEqual([
      { label: first.messagePath, values: [9_999_999_999_999_001n, timeValue] },
      { label: second.messagePath, values: [2] },
    ]);
    expect(firstChunk.datasets[0]?.data[0]?.receiveTime).toEqual(receiveTimes[0]);

    expect(builder.getCsvDataChunk(firstChunk.nextCursor, 3)).toEqual({
      datasets: [
        {
          label: second.messagePath,
          data: [
            expect.objectContaining({ x: 1, value: 3 }),
            expect.objectContaining({ x: 2, value: 4 }),
          ],
        },
      ],
    });
    expect(builder.getCsvDataChunk({ seriesIndex: 2, datumIndex: 0 }, 3)).toEqual({
      datasets: [],
    });
    expect(() => builder.getCsvDataChunk({ seriesIndex: 1, datumIndex: 4 }, 3)).toThrow(
      "Invalid CSV cursor",
    );
  });

  it("hard-caps a CSV cursor response at 10k datums", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("csv-cap");
    const values = Array.from({ length: MAX_CSV_DATUMS_PER_CHUNK + 1 }, (_, index) => index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items(values)) },
      { type: "append-full", series: config.key, items: encodeValueItems(items(values)) },
    ]);

    const firstChunk = builder.getCsvDataChunk(undefined, MAX_CSV_DATUMS_PER_CHUNK * 2);
    expect(firstChunk.datasets[0]?.data).toHaveLength(MAX_CSV_DATUMS_PER_CHUNK);
    expect(firstChunk.nextCursor).toEqual({
      seriesIndex: 0,
      datumIndex: MAX_CSV_DATUMS_PER_CHUNK,
    });
    expect(builder.getCsvDataChunk(firstChunk.nextCursor, MAX_CSV_DATUMS_PER_CHUNK)).toEqual({
      datasets: [
        {
          label: config.messagePath,
          data: [expect.objectContaining({ x: MAX_CSV_DATUMS_PER_CHUNK })],
        },
      ],
    });
  });

  it("physically compacts current columns and their high-cardinality side tables", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 60_000;
    const numericValues = Array.from({ length }, (_, index) => index);
    const originalValues = numericValues.map(String);
    const xBatch = encodeNumericItems(items(numericValues, originalValues));
    expect(xBatch).not.toHaveProperty("valueKinds");
    expect(xBatch).not.toHaveProperty("valuePayloads");
    expect(xBatch).not.toHaveProperty("strings");
    expect(xBatch).not.toHaveProperty("fallbackValues");
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-current-x", items: xBatch },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(numericValues, originalValues)),
      },
    ]);

    expect(builder.getStorageStats()).toEqual({
      x: {
        currentLength: 37_500,
        currentCapacity: 50_000,
        peakCurrentCapacity: 50_000,
        currentSideTableEntries: 0,
        fullLength: 0,
      },
      series: {
        signal: {
          currentLength: 37_500,
          currentCapacity: 50_000,
          peakCurrentCapacity: 50_000,
          currentSideTableEntries: 37_500,
          fullLength: 0,
        },
      },
    });
    const data = builder.getCsvData()[0]?.data;
    expect(data).toHaveLength(37_500);
    expect(data?.[0]).toEqual({
      x: 22_500,
      y: 22_500,
      receiveTime: { sec: 22_500, nsec: 0 },
      value: "22500",
    });
    expect(builder.getXRange()).toEqual({ min: 22_500, max: 59_999 });
  });

  it("does not reserve a huge current backing store for points already covered by full data", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const coveredItems = Array.from({ length: 60_000 }, (_, index) => ({
      value: index,
      originalValue: String(index),
      receiveTime: { sec: 0, nsec: 0 },
    }));
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-full-x",
        items: encodeValueItems(items([1], undefined, [{ sec: 1, nsec: 0 }])),
      },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items([1], undefined, [{ sec: 1, nsec: 0 }])),
      },
      { type: "append-current-x", items: encodeValueItems(coveredItems) },
      { type: "append-current", series: config.key, items: encodeValueItems(coveredItems) },
    ]);

    expect(builder.getStorageStats()).toEqual({
      x: {
        currentLength: 0,
        currentCapacity: 0,
        peakCurrentCapacity: 0,
        currentSideTableEntries: 0,
        fullLength: 1,
      },
      series: {
        signal: {
          currentLength: 0,
          currentCapacity: 0,
          peakCurrentCapacity: 0,
          currentSideTableEntries: 0,
          fullLength: 1,
        },
      },
    });
  });

  it("preserves prefix-only full/current reconciliation for non-monotonic receive times", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const currentTimes = [
      { sec: 1, nsec: 0 },
      { sec: 3, nsec: 0 },
      { sec: 2, nsec: 0 },
    ];
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-current-x",
        items: encodeNumericItems(items([10, 30, 20], undefined, currentTimes)),
      },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items([10, 30, 20], undefined, currentTimes)),
      },
      {
        type: "append-full-x",
        items: encodeNumericItems(items([200], undefined, [{ sec: 2, nsec: 0 }])),
      },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items([200], undefined, [{ sec: 2, nsec: 0 }])),
      },
    ]);

    expect(builder.getCsvData()[0]?.data).toEqual([
      { x: 200, y: 200, receiveTime: { sec: 2, nsec: 0 }, value: 200 },
      { x: 30, y: 30, receiveTime: { sec: 3, nsec: 0 }, value: 30 },
      { x: 20, y: 20, receiveTime: { sec: 2, nsec: 0 }, value: 20 },
    ]);
    expect(
      builder.getViewportDatasets(viewport, { sec: 3, nsec: 0 }).currentValuesByConfigIndex,
    ).toEqual([30]);
  });

  it("keeps prefix-only reconciliation stable across an intermediate flush", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const fullTime = [{ sec: 2, nsec: 0 }];
    const currentTimes = [
      { sec: 1, nsec: 0 },
      { sec: 3, nsec: 0 },
      { sec: 2, nsec: 0 },
    ];
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items([200], undefined, fullTime)) },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items([200], undefined, fullTime)),
      },
    ]);
    builder.updateData([
      {
        type: "append-current-x",
        items: encodeNumericItems(items([10, 30, 20], undefined, currentTimes)),
      },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items([10, 30, 20], undefined, currentTimes)),
      },
    ]);

    expect(builder.getCsvData()[0]?.data).toEqual([
      { x: 200, y: 200, receiveTime: { sec: 2, nsec: 0 }, value: 200 },
      { x: 30, y: 30, receiveTime: { sec: 3, nsec: 0 }, value: 30 },
      { x: 20, y: 20, receiveTime: { sec: 2, nsec: 0 }, value: 20 },
    ]);
  });

  it("uses one hard budget across series while preserving ordinal line order", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const first = seriesItem("first", 0);
    const second = seriesItem("second", 1);
    const length = 10_000;
    const ordinal = Array.from({ length }, (_, index) => index);
    const unsortedX = ordinal.map((index) => (index % 2 === 0 ? length - index : index));
    builder.updateData([
      { type: "update-series-config", seriesItems: [first, second] },
      { type: "append-full-x", items: encodeValueItems(items(unsortedX)) },
      { type: "append-full", series: first.key, items: encodeValueItems(items(ordinal)) },
      { type: "append-full", series: second.key, items: encodeValueItems(items(ordinal)) },
    ]);

    const result = builder.getViewportDatasets(viewport);
    const firstData = result.datasetsByConfigIndex[0]?.data ?? [];
    const secondData = result.datasetsByConfigIndex[1]?.data ?? [];
    expect(firstData.length + secondData.length).toBeLessThanOrEqual(5_000);
    expect(firstData.map((datum) => datum.y)).toEqual(
      [...firstData.map((datum) => datum.y)].sort((left, right) => left - right),
    );
    expect(secondData.map((datum) => datum.y)).toEqual(
      [...secondData.map((datum) => datum.y)].sort((left, right) => left - right),
    );
  });

  it("keeps a narrow-window point even when it is not a global y-extremum", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 6_001;
    const xValues = new Array<number>(length).fill(0);
    xValues[3_000] = 5;
    const yValues = Array.from({ length }, (_, index) => index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeValueItems(items(xValues)) },
      { type: "append-full", series: config.key, items: encodeValueItems(items(yValues)) },
    ]);

    const data =
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4.9, max: 5.1 } } })
        .datasetsByConfigIndex[0]?.data ?? [];
    expect(data).toEqual([
      { x: 0, y: 2_999, value: 2_999 },
      { x: 5, y: 3_000, value: 3_000 },
      { x: 0, y: 3_001, value: 3_001 },
    ]);
  });

  it("keeps both endpoints when an append-order segment crosses the x viewport", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeValueItems(items([0, 10])) },
      { type: "append-full", series: config.key, items: encodeValueItems(items([1, 2])) },
    ]);

    expect(
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data,
    ).toEqual([
      { x: 0, y: 1, value: 1 },
      { x: 10, y: 2, value: 2 },
    ]);
  });

  it("uses block metadata instead of scanning a mostly offscreen history", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 100_000;
    const xValues = new Array<number>(length).fill(-1_000);
    xValues[50_000] = 5;
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items(xValues)) },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items(Array.from({ length }, (_, index) => index))),
      },
    ]);

    const data =
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data ?? [];
    expect(data.some((datum) => datum.x === 5 && datum.y === 50_000)).toBe(true);
    expect(builder.getLastViewportQueryStats()).toEqual({
      totalPoints: length,
      totalBlocks: Math.ceil(length / 512),
      metadataBlocksInspected: Math.ceil(length / 512) * 2,
      scannedBlocks: 2,
      scannedPoints: 1_024,
    });
  });

  it("finds a viewport-crossing segment exactly on a block boundary", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const xValues = [...new Array<number>(512).fill(0), ...new Array<number>(512).fill(10)];
    const yValues = Array.from({ length: xValues.length }, (_, index) => index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items(xValues)) },
      { type: "append-full", series: config.key, items: encodeValueItems(items(yValues)) },
    ]);

    expect(
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data,
    ).toEqual([
      { x: 0, y: 511, value: 511 },
      { x: 10, y: 512, value: 512 },
    ]);
  });

  it("finds a viewport-crossing segment across the full/current boundary", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const fullX = new Array<number>(512).fill(0);
    const currentX = new Array<number>(512).fill(10);
    const fullY = Array.from({ length: 512 }, (_, index) => index);
    const currentY = Array.from({ length: 512 }, (_, index) => 512 + index);
    const currentTimes = currentX.map((_, index) => ({ sec: 1_000 + index, nsec: 0 }));
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items(fullX)) },
      { type: "append-full", series: config.key, items: encodeValueItems(items(fullY)) },
      {
        type: "append-current-x",
        items: encodeNumericItems(items(currentX, undefined, currentTimes)),
      },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(currentY, undefined, currentTimes)),
      },
    ]);

    expect(
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data,
    ).toEqual([
      { x: 0, y: 511, value: 511 },
      { x: 10, y: 512, value: 512 },
    ]);
  });

  it("preserves a NaN sentinel from an otherwise skipped block", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 1_536;
    const xValues = new Array<number>(length).fill(-1_000);
    xValues[100] = 5;
    xValues[1_200] = 5;
    const yValues = Array.from({ length }, (_, index) => index);
    yValues[700] = Number.NaN;
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items(xValues)) },
      { type: "append-full", series: config.key, items: encodeValueItems(items(yValues)) },
    ]);

    const data =
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data ?? [];
    expect(data.some((datum) => datum.y === 100)).toBe(true);
    expect(data.some((datum) => Number.isNaN(datum.y))).toBe(true);
    expect(data.some((datum) => datum.y === 1_200)).toBe(true);
    expect(builder.getLastViewportQueryStats()).toEqual({
      totalPoints: length,
      totalBlocks: 3,
      metadataBlocksInspected: 6,
      scannedBlocks: 4,
      scannedPoints: 2_048,
    });
  });

  it("rebuilds the block index after current storage is culled", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const firstX = new Array<number>(40_000).fill(-1_000);
    const firstY = Array.from({ length: firstX.length }, (_, index) => index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-current-x", items: encodeNumericItems(items(firstX)) },
      { type: "append-current", series: config.key, items: encodeValueItems(items(firstY)) },
    ]);
    const secondX = new Array<number>(20_000).fill(-1_000);
    secondX[10_000] = 5;
    const secondY = Array.from({ length: secondX.length }, (_, index) => 40_000 + index);
    const secondTimes = secondX.map((_, index) => ({ sec: 40_000 + index, nsec: 0 }));
    builder.updateData([
      {
        type: "append-current-x",
        items: encodeNumericItems(items(secondX, undefined, secondTimes)),
      },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(secondY, undefined, secondTimes)),
      },
    ]);

    const data =
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data ?? [];
    expect(data.some((datum) => datum.x === 5 && datum.y === 50_000)).toBe(true);
    expect(builder.getLastViewportQueryStats()).toEqual({
      totalPoints: 37_500,
      totalBlocks: Math.ceil(37_500 / 512),
      metadataBlocksInspected: Math.ceil(37_500 / 512) * 2,
      scannedBlocks: 2,
      scannedPoints: 1_024,
    });
  });

  it("retains non-finite x/y discontinuities between visible finite runs", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const xGap = seriesItem("x-gap", 0);
    const yGap = seriesItem("y-gap", 1);
    builder.updateData([
      { type: "update-series-config", seriesItems: [xGap, yGap] },
      {
        type: "append-full-x",
        items: encodeValueItems(items([1, Number.NaN, 2, 2.5, 3])),
      },
      {
        type: "append-full",
        series: xGap.key,
        items: encodeValueItems(items([10, 20, 30, 40, 50])),
      },
      {
        type: "append-full",
        series: yGap.key,
        items: encodeValueItems(items([10, 20, 30, Number.NaN, 50])),
      },
    ]);

    const result = builder.getViewportDatasets({
      ...viewport,
      bounds: { x: { min: 0, max: 3 } },
    });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([
      { x: 1, y: 10, value: 10 },
      { x: Number.NaN, y: 20, value: 20 },
      { x: 2, y: 30, value: 30 },
      { x: 2.5, y: 40, value: 40 },
      { x: 3, y: 50, value: 50 },
    ]);
    expect(result.datasetsByConfigIndex[1]?.data).toEqual([
      { x: 1, y: 10, value: 10 },
      { x: Number.NaN, y: 20, value: 20 },
      { x: 2, y: 30, value: 30 },
      { x: 2.5, y: Number.NaN, value: Number.NaN },
      { x: 3, y: 50, value: 50 },
    ]);
  });

  it("preserves a constant-y x spike during order-preserving 2D line sampling", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 6_000;
    const xValues: number[] = Array.from({ length }, (_, index) => (index % 2 === 0 ? -1 : 1));
    xValues[3_000] = 100;
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeValueItems(items(xValues)) },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items(new Array<number>(length).fill(7))),
      },
    ]);

    const data =
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: -2, max: 2 } } })
        .datasetsByConfigIndex[0]?.data ?? [];
    expect(data.length).toBeLessThanOrEqual(5_000);
    expect(data.some((datum) => datum.x === 100)).toBe(true);
    expect(data.map((datum) => datum.y)).toEqual(new Array<number>(data.length).fill(7));
  });

  it("keeps finite x extrema when a sampling bucket starts with a NaN sentinel", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 6_000;
    const xValues: number[] = Array.from({ length }, (_, index) => (index % 2 === 0 ? -1 : 1));
    xValues[15] = Number.NaN;
    xValues[16] = 100;
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeValueItems(items(xValues)) },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items(new Array<number>(length).fill(7))),
      },
    ]);

    const data =
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: -2, max: 2 } } })
        .datasetsByConfigIndex[0]?.data ?? [];
    expect(data.length).toBeLessThanOrEqual(5_000);
    expect(data.some((datum) => Number.isNaN(datum.x))).toBe(true);
    expect(data.some((datum) => datum.x === 100)).toBe(true);
  });

  it("uses the point budget only to trigger scatter pixel de-duplication", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal", 0, { showLine: false });
    const values = Array.from({ length: 6_001 }, (_, index) => index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeValueItems(items(values)) },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items(new Array<number>(values.length).fill(0))),
      },
    ]);

    const data =
      builder.getViewportDatasets({
        size: { width: 12_002, height: 600 },
        bounds: { x: { min: 0, max: 6_000 } },
      }).datasetsByConfigIndex[0]?.data ?? [];
    expect(data).toHaveLength(6_001);
  });

  it("skips offscreen scatter blocks without changing the pixel result", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal", 0, { showLine: false });
    const length = 100_000;
    const xValues = new Array<number>(length).fill(-1_000);
    xValues[50_000] = 5;
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeNumericItems(items(xValues)) },
      {
        type: "append-full",
        series: config.key,
        items: encodeValueItems(items(Array.from({ length }, (_, index) => index))),
      },
    ]);

    expect(
      builder.getViewportDatasets({ ...viewport, bounds: { x: { min: 4, max: 6 } } })
        .datasetsByConfigIndex[0]?.data,
    ).toEqual([{ x: 5, y: 50_000, value: 50_000 }]);
    expect(builder.getLastViewportQueryStats()).toEqual({
      totalPoints: length,
      totalBlocks: Math.ceil(length / 512),
      metadataBlocksInspected: Math.ceil(length / 512),
      scannedBlocks: 1,
      scannedPoints: 512,
    });
  });

  it("bounds peak current capacity across multiple append actions", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const firstValues = Array.from({ length: 20_000 }, (_, index) => index);
    const secondValues = Array.from({ length: 40_000 }, (_, index) => 20_000 + index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      {
        type: "append-current-x",
        items: encodeValueItems(items(firstValues, firstValues.map(String))),
      },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(firstValues, firstValues.map(String))),
      },
      {
        type: "append-current-x",
        items: encodeValueItems(items(secondValues, secondValues.map(String))),
      },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(secondValues, secondValues.map(String))),
      },
    ]);

    const stats = builder.getStorageStats();
    expect(stats.x).toMatchObject({
      currentLength: 37_500,
      peakCurrentCapacity: 50_000,
      currentSideTableEntries: 0,
    });
    expect(stats.series.signal).toMatchObject({
      currentLength: 37_500,
      peakCurrentCapacity: 50_000,
      currentSideTableEntries: 37_500,
    });
    expect(stats.x.peakCurrentCapacity).toBeLessThanOrEqual(50_000);
    expect(stats.series.signal?.peakCurrentCapacity).toBeLessThanOrEqual(50_000);
    expect(builder.getCsvData()[0]?.data[0]).toEqual({
      x: 22_500,
      y: 22_500,
      receiveTime: { sec: 2_500, nsec: 0 },
      value: "22500",
    });
  });

  it("uses one coordinated drop so unequal current batches cannot be falsely paired", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const xValues = Array.from({ length: 100_000 }, (_, index) => index);
    const yValues = Array.from({ length: 40_000 }, (_, index) => index);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-current-x", items: encodeNumericItems(items(xValues)) },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(yValues)),
      },
    ]);

    expect(builder.getStorageStats()).toEqual({
      x: {
        currentLength: 37_500,
        currentCapacity: 50_000,
        peakCurrentCapacity: 50_000,
        currentSideTableEntries: 0,
        fullLength: 0,
      },
      series: {
        signal: {
          currentLength: 0,
          currentCapacity: 0,
          peakCurrentCapacity: 0,
          currentSideTableEntries: 0,
          fullLength: 0,
        },
      },
    });
    const result = builder.getViewportDatasets(viewport);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.pathsWithMismatchedDataLengths).toEqual(new Set([config.messagePath]));
  });

  it("isolates packed buffers across multiple series and consecutive transfers", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const first = seriesItem("first", 0);
    const second = seriesItem("second", 1);
    builder.updateData([
      { type: "update-series-config", seriesItems: [first, second] },
      { type: "append-full-x", items: encodeValueItems(items([1, 2])) },
      { type: "append-full", series: first.key, items: encodeValueItems(items([3, 4])) },
      { type: "append-full", series: second.key, items: encodeValueItems(items([5, 6])) },
    ]);
    const firstResult = builder.getViewportDatasets(viewport, { sec: 1, nsec: 0 });
    const firstTransferables = collectTransferableBuffers(firstResult);
    const firstClone = structuredClone(firstResult, { transfer: firstTransferables });
    const secondResult = builder.getViewportDatasets(viewport, { sec: 1, nsec: 0 });
    const secondTransferables = collectTransferableBuffers(secondResult);
    const secondClone = structuredClone(secondResult, { transfer: secondTransferables });

    expect(firstTransferables).toHaveLength(6);
    expect(secondTransferables).toHaveLength(6);
    expect(
      [...firstTransferables, ...secondTransferables].every((buffer) => buffer.byteLength === 0),
    ).toBe(true);
    for (const clone of [firstClone, secondClone]) {
      clone.datasetsByConfigIndex.forEach((dataset) => {
        if (dataset) {
          restoreUnpackedDataAccessor(dataset);
        }
      });
      expect(clone.datasetsByConfigIndex[0]?.data).toEqual([
        { x: 1, y: 3, value: 3 },
        { x: 2, y: 4, value: 4 },
      ]);
      expect(clone.datasetsByConfigIndex[1]?.data).toEqual([
        { x: 1, y: 5, value: 5 },
        { x: 2, y: 6, value: 6 },
      ]);
      expect(clone.currentValuesByConfigIndex).toEqual([4, 6]);
    }
  });
});
