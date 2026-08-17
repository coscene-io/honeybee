// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { collectTransferableBuffers } from "@foxglove/den/worker";
import { parseMessagePath } from "@foxglove/message-path";
import { Time } from "@foxglove/studio";

import { CustomDatasetsBuilderImpl } from "./CustomDatasetsBuilderImpl";
import { encodeValueItems, ValueItem } from "./CustomValueStore";
import { SeriesConfigKey, SeriesItem, Viewport } from "./IDatasetsBuilder";
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
        items: encodeValueItems(items([3, 1, 2, 0, -1, 4], undefined, receiveTimes)),
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

  it("physically compacts current columns and their high-cardinality side tables", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    const length = 60_000;
    const numericValues = Array.from({ length }, (_, index) => index);
    const originalValues = numericValues.map(String);
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-current-x", items: encodeValueItems(items(numericValues)) },
      {
        type: "append-current",
        series: config.key,
        items: encodeValueItems(items(numericValues, originalValues)),
      },
    ]);

    expect(builder.getStorageStats()).toEqual({
      x: { currentLength: 37_500, currentCapacity: 37_500, fullLength: 0 },
      series: {
        signal: {
          currentLength: 37_500,
          currentCapacity: 37_500,
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
      x: { currentLength: 0, currentCapacity: 0, fullLength: 1 },
      series: {
        signal: {
          currentLength: 0,
          currentCapacity: 0,
          currentSideTableEntries: 0,
          fullLength: 1,
        },
      },
    });
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

  it("produces independently transferable viewport columns", () => {
    const builder = new CustomDatasetsBuilderImpl();
    const config = seriesItem("signal");
    builder.updateData([
      { type: "update-series-config", seriesItems: [config] },
      { type: "append-full-x", items: encodeValueItems(items([1, 2])) },
      { type: "append-full", series: config.key, items: encodeValueItems(items([3, 4])) },
    ]);
    const result = builder.getViewportDatasets(viewport);
    const transferables = collectTransferableBuffers(result);
    const clone = structuredClone(result, { transfer: transferables });

    expect(transferables).toHaveLength(3);
    expect(transferables.every((buffer) => buffer.byteLength === 0)).toBe(true);
    clone.datasetsByConfigIndex.forEach((dataset) => {
      if (dataset) {
        restoreUnpackedDataAccessor(dataset);
      }
    });
    expect(clone.datasetsByConfigIndex[0]?.data).toEqual([
      { x: 1, y: 3, value: 3 },
      { x: 2, y: 4, value: 4 },
    ]);
  });
});
