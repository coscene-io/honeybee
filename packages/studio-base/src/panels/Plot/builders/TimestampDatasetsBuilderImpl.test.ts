// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@foxglove/message-path";
import { MAX_POINTS } from "@foxglove/studio-base/components/TimeBasedChart/downsample";

import {
  MAX_CSV_DATUMS_PER_CHUNK,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import {
  DataItem,
  TimestampDatasetsBuilderImpl,
  UpdateDataAction,
} from "./TimestampDatasetsBuilderImpl";

function makeSeries(
  key: string,
  configIndex: number,
  options: Partial<Pick<SeriesItem, "enabled" | "showLine" | "timestampMethod">> & {
    path?: string;
  } = {},
): SeriesItem {
  const messagePath = options.path ?? `/topic_${key}.value`;
  const parsed = parseMessagePath(messagePath);
  if (parsed == undefined) {
    throw new Error(`Failed to parse test message path: ${messagePath}`);
  }

  return {
    key: key as SeriesConfigKey,
    configIndex,
    messagePath,
    parsed,
    color: "red",
    contrastColor: "white",
    timestampMethod: options.timestampMethod ?? "receiveTime",
    showLine: options.showLine ?? true,
    lineSize: 1,
    enabled: options.enabled ?? true,
  };
}

function makeItem(x: number, y: number = x): DataItem {
  return {
    x,
    y,
    value: y,
    receiveTime: { sec: Math.max(0, Math.trunc(x)), nsec: 0 },
  };
}

function updateSeries(seriesItems: SeriesItem[]): UpdateDataAction {
  return { type: "update-series-config", seriesItems };
}

function append(
  type: "append-full" | "append-current",
  series: SeriesItem,
  items: DataItem[],
): UpdateDataAction {
  return { type, series: series.key, items };
}

function viewport(
  x: { min?: number; max?: number } = {},
  size: { width: number; height: number } = { width: 1_000, height: 1_000 },
  options: { following?: boolean } = {},
): Viewport {
  return { bounds: { x }, size, following: options.following };
}

function xValues(impl: TimestampDatasetsBuilderImpl, view: Viewport, configIndex = 0): number[] {
  return (impl.getViewportDatasets(view)[configIndex]?.data ?? []).map((datum) => datum.x);
}

describe("TimestampDatasetsBuilderImpl", () => {
  it("keeps one datum on either side of the visible x range", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("viewport", 0);
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 6 }, (_, x) => makeItem(x)),
      ),
    ]);

    expect(xValues(impl, viewport({ min: 1.5, max: 3.5 }))).toEqual([1, 2, 3, 4]);
  });

  it("uses the datum before the left viewport neighbor when computing a derivative", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("derivative", 0, {
      path: "/topic.value.@derivative",
    });
    impl.applyActions([
      updateSeries([series]),
      append("append-full", series, [
        makeItem(0, 0),
        makeItem(1, 2),
        makeItem(2, 6),
        makeItem(3, 12),
        makeItem(4, 20),
      ]),
    ]);

    expect(impl.getViewportDatasets(viewport({ min: 2.5, max: 3.5 }))[0]?.data).toEqual([
      { x: 2, y: 4, value: 4 },
      { x: 3, y: 6, value: 6 },
      { x: 4, y: 8, value: 8 },
    ]);
  });

  it("keeps the combined line-series result within the global point budget", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const first = makeSeries("first", 0);
    const second = makeSeries("second", 1);
    const items = Array.from({ length: 20_000 }, (_, x) => makeItem(x, Math.sin(x)));
    impl.applyActions([
      updateSeries([first, second]),
      append("append-full", first, items),
      append("append-full", second, items),
    ]);

    const datasets = impl.getViewportDatasets(
      viewport({ min: 0, max: 20_000 }, { width: 10_000, height: 1_000 }),
    );
    const totalPoints = datasets.reduce((sum, dataset) => sum + dataset.data.length, 0);

    expect(totalPoints).toBeGreaterThan(0);
    expect(totalPoints).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("uses pixel occupancy for scatter data instead of enforcing MAX_POINTS as a hard cap", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("scatter", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 6_000 }, (_, x) => makeItem(x)),
      ),
    ]);

    const data = impl.getViewportDatasets(
      viewport({ min: 0, max: 6_000 }, { width: 12_000, height: 1_000 }),
    )[0]?.data;

    expect(data).toHaveLength(6_000);
    expect(data!.length).toBeGreaterThan(MAX_POINTS);
  });

  it("still pixel-downsamples scatter series whose water-fill share is zero", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = Array.from({ length: MAX_POINTS + 1 }, (_, index) =>
      makeSeries(`scatter-${index}`, index, { showLine: false }),
    );
    impl.applyAction(updateSeries(series));
    for (const item of series) {
      impl.applyAction(append("append-full", item, [makeItem(0)]));
    }

    expect(impl.getViewportDatasets(viewport()).at(-1)?.data).toEqual([{ x: 0, y: 0, value: 0 }]);
  });

  it("keeps line datasets within the global budget even when per-series shares are below four", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = Array.from({ length: 2_000 }, (_, index) => makeSeries(`line-${index}`, index));
    const items = Array.from({ length: 10 }, (_, index) => makeItem(index, index % 2));
    impl.applyAction(updateSeries(series));
    for (const item of series) {
      impl.applyAction(append("append-full", item, items));
    }

    const total = impl
      .getViewportDatasets(viewport({}, { width: 1, height: 100 }))
      .reduce((sum, dataset) => sum + dataset.data.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("keeps one visible real point when a discontinuous line receives a one-point budget", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = Array.from({ length: MAX_POINTS }, (_, index) =>
      makeSeries(`one-point-${index}`, index),
    );
    impl.applyAction(updateSeries(series));
    for (const item of series) {
      impl.applyActions([
        append("append-full", item, [makeItem(0, 0)]),
        append("append-current", item, [makeItem(1, 1)]),
      ]);
    }

    const datasets = impl.getViewportDatasets(viewport());
    expect(datasets).toHaveLength(MAX_POINTS);
    expect(datasets.every((dataset) => dataset.data.length === 1)).toBe(true);
    expect(
      datasets.every(
        (dataset) => Number.isFinite(dataset.data[0]?.x) && Number.isFinite(dataset.data[0]?.y),
      ),
    ).toBe(true);
  });

  it("merges full and current data and drops current values already covered by full data", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("full-current", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append("append-full", series, [makeItem(0), makeItem(1)]),
      append("append-current", series, [makeItem(1), makeItem(2), makeItem(3)]),
    ]);

    expect(xValues(impl, viewport())).toEqual([0, 1, 2, 3]);
  });

  it("preserves duplicate full observations through an out-of-order merge", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("full-duplicates", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append("append-full", series, [
        { ...makeItem(1, 7), receiveTime: { sec: 1, nsec: 0 } },
        { ...makeItem(1, 7), receiveTime: { sec: 2, nsec: 0 } },
      ]),
      // Force a merge instead of the ordered append path. Existing equal x/y observations must
      // remain distinct because CSV uses their receive timestamps.
      append("append-full", series, [{ ...makeItem(0, 3), receiveTime: { sec: 3, nsec: 0 } }]),
    ]);

    expect(
      impl.getCsvData()[0]?.data.map(({ x, y, receiveTime }) => ({ x, y, receiveTime })),
    ).toEqual([
      { x: 0, y: 3, receiveTime: { sec: 3, nsec: 0 } },
      { x: 1, y: 7, receiveTime: { sec: 1, nsec: 0 } },
      { x: 1, y: 7, receiveTime: { sec: 2, nsec: 0 } },
    ]);
  });

  it("continues deduplicating identical current observations", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("current-duplicates", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append("append-current", series, [
        { ...makeItem(1, 7), receiveTime: { sec: 1, nsec: 0 } },
        { ...makeItem(1, 7), receiveTime: { sec: 2, nsec: 0 } },
      ]),
    ]);

    expect(impl.getCsvData()[0]?.data).toHaveLength(1);
    expect(impl.getCsvData()[0]?.data[0]?.receiveTime).toEqual({ sec: 1, nsec: 0 });
  });

  it("does not encode side-table entries for discarded current duplicates", () => {
    let encoded = 0;
    const impl = new TimestampDatasetsBuilderImpl({
      onStoredPointEncoded: () => encoded++,
    });
    const series = makeSeries("current-side-table", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-current",
        series,
        Array.from({ length: 10_000 }, (_, index) => ({
          ...makeItem(1, 7),
          value: `unique-${index}`,
          receiveTime: { sec: 1, nsec: 1_000_000_000 + index },
        })),
      ),
      append("append-current", series, [
        {
          ...makeItem(1, 7),
          value: "another-duplicate",
          receiveTime: { sec: 2, nsec: 1_000_000_000 },
        },
      ]),
    ]);

    expect(encoded).toBe(1);
    expect(impl.getCsvData()[0]?.data).toEqual([expect.objectContaining({ value: "unique-0" })]);
  });

  it("culls current data in batches and retains the newest 37,500 values", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("current-cull", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-current",
        series,
        Array.from({ length: 40_000 }, (_, x) => makeItem(x)),
      ),
      append(
        "append-current",
        series,
        Array.from({ length: 20_000 }, (_, index) => makeItem(index + 40_000)),
      ),
    ]);

    const data = impl.getViewportDatasets(viewport({}, { width: 100_000, height: 100_000 }))[0]
      ?.data;

    expect(data).toHaveLength(37_500);
    expect(data?.[0]).toEqual({ x: 22_500, y: 22_500, value: 22_500 });
    expect(data?.[37_499]).toEqual({ x: 59_999, y: 59_999, value: 59_999 });
  });

  it("caps a single oversized current batch and retains its newest 37,500 values", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("single-current-cull", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-current",
        series,
        Array.from({ length: 60_000 }, (_, x) => makeItem(x)),
      ),
    ]);

    const data = impl.getViewportDatasets(viewport({}, { width: 100_000, height: 100_000 }))[0]
      ?.data;
    expect(data).toHaveLength(37_500);
    expect(data?.[0]?.x).toBe(22_500);
    expect(data?.at(-1)?.x).toBe(59_999);
  });

  it("omits disabled series from the result", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const disabled = makeSeries("disabled", 0, { enabled: false });
    const enabled = makeSeries("enabled", 1);
    impl.applyActions([
      updateSeries([disabled, enabled]),
      append("append-full", disabled, [makeItem(0, 1)]),
      append("append-full", enabled, [makeItem(0, 2)]),
    ]);

    const datasets = impl.getViewportDatasets(viewport());
    expect(datasets[0]).toBeUndefined();
    expect(datasets[1]?.data).toEqual([{ x: 0, y: 2, value: 2 }]);
  });

  it("does not let disabled series consume the line-series point budget", () => {
    const items = Array.from({ length: 20_000 }, (_, x) => makeItem(x, Math.sin(x)));
    const enabled = makeSeries("enabled-budget", 1);

    const withDisabled = new TimestampDatasetsBuilderImpl();
    const disabled = makeSeries("disabled-budget", 0, { enabled: false });
    withDisabled.applyActions([
      updateSeries([disabled, enabled]),
      append("append-full", disabled, items),
      append("append-full", enabled, items),
    ]);

    const enabledOnly = new TimestampDatasetsBuilderImpl();
    enabledOnly.applyActions([updateSeries([enabled]), append("append-full", enabled, items)]);

    expect(withDisabled.getViewportDatasets(viewport())[1]?.data).toEqual(
      enabledOnly.getViewportDatasets(viewport())[1]?.data,
    );
  });

  it("sorts header-stamp batches and preserves compact original values for CSV", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("original-values", 0, {
      showLine: false,
      timestampMethod: "headerStamp",
    });
    const receiveTime = { sec: 7, nsec: 8 };
    const headerStamp = { sec: 9, nsec: 10 };
    impl.applyActions([
      updateSeries([series]),
      append("append-full", series, [
        { x: 2, y: 2, value: "2", receiveTime, headerStamp },
        { x: 0, y: 1, value: true, receiveTime },
        { x: 1, y: 3, value: -18_446_744_073_709_551_616n, receiveTime, headerStamp },
      ]),
    ]);

    expect(xValues(impl, viewport())).toEqual([0, 1, 2]);
    expect(impl.getCsvData()[0]?.data.map((datum) => datum.value)).toEqual([
      true,
      -18_446_744_073_709_551_616n,
      "2",
    ]);
    expect(impl.getCsvData()[0]?.data[2]).toMatchObject({ receiveTime, headerStamp });
  });

  it("preserves noncanonical Time shapes in CSV and tooltip values", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("noncanonical-times", 0, { showLine: false });
    const receiveTime = { sec: 1, nsec: 1_000_000_000 };
    const headerStamp = { sec: 3, nsec: -1 };
    const value = { sec: 5, nsec: 1_000_000_000 };
    impl.applyActions([
      updateSeries([series]),
      append("append-full", series, [{ x: 0, y: 5, receiveTime, headerStamp, value }]),
    ]);

    expect(impl.getCsvData()[0]?.data[0]).toEqual({
      x: 0,
      y: 5,
      receiveTime,
      headerStamp,
      value,
    });
    expect(impl.getViewportDatasets(viewport())[0]?.data).toEqual([{ x: 0, y: 5, value }]);
  });

  it("continues a CSV cursor across enabled series without changing value or time types", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const first = makeSeries("csv-first", 0);
    const disabled = makeSeries("csv-disabled", 1, { enabled: false });
    const second = makeSeries("csv-second", 2);
    const receiveTime = { sec: 7, nsec: 8 };
    const headerStamp = { sec: 9, nsec: 10 };
    impl.applyActions([
      updateSeries([first, disabled, second]),
      append("append-full", first, [
        { x: 0, y: 1, receiveTime, headerStamp, value: 9_999_999_999_999_001n },
        { x: 1, y: 2, receiveTime, value: { sec: 5, nsec: 1_000_000_000 } },
      ]),
      append("append-full", disabled, [makeItem(99)]),
      append("append-full", second, [makeItem(2), makeItem(3), makeItem(4)]),
    ]);

    const firstChunk = impl.getCsvDataChunk(undefined, 3);
    expect(firstChunk.nextCursor).toEqual({ seriesIndex: 1, datumIndex: 1 });
    expect(
      firstChunk.datasets.map(({ label, data }) => ({
        label,
        values: data.map((item) => item.value),
      })),
    ).toEqual([
      {
        label: first.messagePath,
        values: [9_999_999_999_999_001n, { sec: 5, nsec: 1_000_000_000 }],
      },
      { label: second.messagePath, values: [2] },
    ]);
    expect(firstChunk.datasets[0]?.data[0]).toMatchObject({ receiveTime, headerStamp });

    const secondChunk = impl.getCsvDataChunk(firstChunk.nextCursor, 3);
    expect(secondChunk).toEqual({
      datasets: [
        {
          label: second.messagePath,
          data: [
            expect.objectContaining({ x: 3, value: 3 }),
            expect.objectContaining({ x: 4, value: 4 }),
          ],
        },
      ],
    });
  });

  it("hard-caps a CSV cursor response at 10k datums", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("csv-cap", 0);
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: MAX_CSV_DATUMS_PER_CHUNK + 1 }, (_, index) => makeItem(index)),
      ),
    ]);

    const firstChunk = impl.getCsvDataChunk(undefined, MAX_CSV_DATUMS_PER_CHUNK * 2);
    expect(firstChunk.datasets[0]?.data).toHaveLength(MAX_CSV_DATUMS_PER_CHUNK);
    expect(firstChunk.nextCursor).toEqual({
      seriesIndex: 0,
      datumIndex: MAX_CSV_DATUMS_PER_CHUNK,
    });
    expect(impl.getCsvDataChunk(firstChunk.nextCursor, MAX_CSV_DATUMS_PER_CHUNK)).toEqual({
      datasets: [
        {
          label: series.messagePath,
          data: [expect.objectContaining({ x: MAX_CSV_DATUMS_PER_CHUNK })],
        },
      ],
    });
  });

  it("returns stable defaults for empty data and a correct all-negative x range", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("range", 0, { showLine: false });
    impl.applyAction(updateSeries([series]));
    expect(impl.getXRange()).toEqual({ min: 0, max: 100 });

    impl.applyAction(append("append-full", series, [makeItem(-5), makeItem(-2)]));
    expect(impl.getXRange()).toEqual({ min: -5, max: -2 });
  });

  it("owns exact-length packed viewport columns", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("packed", 0, { showLine: false });
    impl.applyActions([
      updateSeries([series]),
      append("append-full", series, [makeItem(0), makeItem(1), makeItem(2)]),
    ]);

    const dataset = impl.getViewportDatasets(viewport())[0]!;
    expect(dataset.packedData?.points).toHaveLength(6);
    expect(dataset.packedData?.valueKinds).toHaveLength(3);
    expect(dataset.packedData?.valuePayloads).toHaveLength(3);
  });

  it("returns only the narrow viewport neighborhood from a million-point series", () => {
    const impl = new TimestampDatasetsBuilderImpl();
    const series = makeSeries("million", 0);
    impl.applyAction(updateSeries([series]));

    const batchSize = 10_000;
    for (let start = 0; start < 1_000_000; start += batchSize) {
      impl.applyAction(
        append(
          "append-full",
          series,
          Array.from({ length: batchSize }, (_, offset) => makeItem(start + offset)),
        ),
      );
    }

    expect(xValues(impl, viewport({ min: 10.25, max: 19.75 }))).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it("continues line downsampling from only a newly appended tail", () => {
    let visited = 0;
    const impl = new TimestampDatasetsBuilderImpl({
      onDownsamplePointVisited: () => visited++,
    });
    const series = makeSeries("incremental", 0);
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 10_000 }, (_, x) => makeItem(x, Math.sin(x))),
      ),
    ]);
    const autoRangeViewport: Viewport = {
      bounds: { y: { min: -2, max: 2 } },
      size: { width: 1_000, height: 1_000 },
    };
    impl.getViewportDatasets(autoRangeViewport);
    expect(visited).toBe(10_000);

    visited = 0;
    impl.applyAction(
      append(
        "append-full",
        series,
        Array.from({ length: 1_000 }, (_, offset) =>
          makeItem(10_000 + offset, Math.sin(10_000 + offset)),
        ),
      ),
    );
    impl.getViewportDatasets(autoRangeViewport);
    expect(visited).toBe(1_000);
  });

  it("matches a fresh downsample after cached appends and an auto-range grid change", () => {
    const series = makeSeries("cached-equivalence", 0);
    const cached = new TimestampDatasetsBuilderImpl();
    cached.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 10_000 }, (_, x) => makeItem(x, Math.sin(x))),
      ),
    ]);
    const autoRangeViewport: Viewport = {
      bounds: { y: { min: -2, max: 2 } },
      size: { width: 1_000, height: 1_000 },
    };
    cached.getViewportDatasets(autoRangeViewport);

    cached.applyAction(
      append(
        "append-full",
        series,
        Array.from({ length: 1_000 }, (_, offset) =>
          makeItem(10_000 + offset, Math.sin(10_000 + offset)),
        ),
      ),
    );
    const freshAtElevenThousand = new TimestampDatasetsBuilderImpl();
    freshAtElevenThousand.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 11_000 }, (_, x) => makeItem(x, Math.sin(x))),
      ),
    ]);
    expect(cached.getViewportDatasets(autoRangeViewport)[0]?.data).toEqual(
      freshAtElevenThousand.getViewportDatasets(autoRangeViewport)[0]?.data,
    );

    cached.applyAction(
      append(
        "append-full",
        series,
        Array.from({ length: 7_000 }, (_, offset) =>
          makeItem(11_000 + offset, Math.sin(11_000 + offset)),
        ),
      ),
    );
    const freshAtEighteenThousand = new TimestampDatasetsBuilderImpl();
    freshAtEighteenThousand.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 18_000 }, (_, x) => makeItem(x, Math.sin(x))),
      ),
    ]);
    expect(cached.getViewportDatasets(autoRangeViewport)[0]?.data).toEqual(
      freshAtEighteenThousand.getViewportDatasets(autoRangeViewport)[0]?.data,
    );
  });

  it("reuses the aligned following window when the playback head moves within one grid cell", () => {
    let downsampleVisited = 0;
    let extremaVisited = 0;
    const impl = new TimestampDatasetsBuilderImpl({
      onDownsamplePointVisited: () => downsampleVisited++,
      onExtremaPointVisited: () => extremaVisited++,
    });
    const series = makeSeries("following", 0);
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 30_000 }, (_, x) => makeItem(x, Math.sin(x))),
      ),
    ]);

    impl.getViewportDatasets(
      viewport({ min: 20_000, max: 21_000 }, { width: 100, height: 100 }, { following: true }),
    );
    expect(downsampleVisited).toBeGreaterThan(0);
    expect(extremaVisited).toBeGreaterThan(0);

    downsampleVisited = 0;
    extremaVisited = 0;
    impl.getViewportDatasets(
      viewport(
        { min: 20_000.25, max: 21_000.25 },
        { width: 100, height: 100 },
        { following: true },
      ),
    );
    expect(downsampleVisited).toBe(0);
    expect(extremaVisited).toBe(0);
  });

  it("scans only an appended derivative tail when auto-ranging", () => {
    let downsampleVisited = 0;
    let extremaVisited = 0;
    const impl = new TimestampDatasetsBuilderImpl({
      onDownsamplePointVisited: () => downsampleVisited++,
      onExtremaPointVisited: () => extremaVisited++,
    });
    const series = makeSeries("derivative-tail", 0, {
      path: "/topic.value.@derivative",
    });
    impl.applyActions([
      updateSeries([series]),
      append(
        "append-full",
        series,
        Array.from({ length: 10_000 }, (_, x) => makeItem(x, x * 2)),
      ),
    ]);
    const autoRangeViewport = viewport({}, { width: 1_000, height: 1_000 });
    impl.getViewportDatasets(autoRangeViewport);
    expect(downsampleVisited).toBe(9_999);
    expect(extremaVisited).toBe(9_999);

    downsampleVisited = 0;
    extremaVisited = 0;
    impl.applyAction(
      append(
        "append-full",
        series,
        Array.from({ length: 1_000 }, (_, offset) =>
          makeItem(10_000 + offset, (10_000 + offset) * 2),
        ),
      ),
    );
    impl.getViewportDatasets(autoRangeViewport);
    expect(downsampleVisited).toBe(1_000);
    expect(extremaVisited).toBe(1_000);
  });
});
