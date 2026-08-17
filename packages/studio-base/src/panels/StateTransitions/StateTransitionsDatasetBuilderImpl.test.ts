// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { collectTransferableBuffers } from "@foxglove/den/worker";

import {
  PackedStateDatumBatch,
  StateDatum,
  StateTransitionsDatasetBuilderImpl,
  packStateDatums,
  unpackStateTransitionDataset,
} from "./StateTransitionsDatasetBuilderImpl";

function setup(timestampMethod: "receiveTime" | "headerStamp" = "receiveTime") {
  const impl = new StateTransitionsDatasetBuilderImpl();
  impl.applyActions([
    {
      type: "set-series",
      series: [
        {
          key: "4:/state",
          configIndex: 4,
          enabled: true,
          label: "State",
          timestampMethod,
          y: -90,
        },
      ],
    },
  ]);
  return impl;
}

function build(
  impl: StateTransitionsDatasetBuilderImpl,
  args: {
    min?: number;
    max?: number;
    showPoints?: boolean;
    width?: number;
  } = {},
) {
  const min = args.min ?? 0;
  const max = args.max ?? 100;
  const viewport =
    args.width != undefined
      ? {
          width: args.width,
          height: 100,
          bounds: { x: { min, max }, y: { min: -100, max: -3 } },
        }
      : undefined;
  const dataset = impl.getViewportDatasets({
    xBounds: { min, max },
    viewport,
    showPoints: args.showPoints === true,
  })[0]!;
  return { dataset, data: unpackStateTransitionDataset(dataset) };
}

describe("StateTransitionsDatasetBuilderImpl", () => {
  it("sorts incrementally loaded header stamps and merges interleaved current samples", () => {
    const impl = setup("headerStamp");
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 0, value: 0 },
          { x: 100, value: 4 },
          { x: 50, value: 2 },
        ]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 75, value: 3 },
          { x: 25, value: 1 },
        ]),
      },
      {
        type: "append-current",
        key: "4:/state",
        batch: packStateDatums([
          { x: 60, value: "live" },
          // Exact stamps already covered by full history are ignored.
          { x: 75, value: "duplicate" },
        ]),
      },
    ]);

    const { dataset, data } = build(impl, { max: 120 });
    expect(dataset.configIndex).toBe(4);
    expect(data.map(({ x }) => x)).toEqual([0, 25, 50, 60, 75, 100]);
    expect(data.map(({ value }) => value)).toEqual([0, 1, 2, "live", 3, 4]);
  });

  it("preserves append chronology for equal stamps across immutable sorted runs", () => {
    const impl = setup("headerStamp");
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 10, value: "base-first" },
          { x: 20, value: "base-last" },
          { x: 10, value: "base-second" },
        ]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 5, value: "older-run" },
          { x: 10, value: "equal-older-run" },
        ]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 15, value: "newer-run" },
          { x: 10, value: "equal-newer-run" },
        ]),
      },
    ]);

    const { data } = build(impl, { min: 0, max: 20, showPoints: true });
    expect(data.map(({ x }) => x)).toEqual([5, 10, 10, 10, 10, 15, 20]);
    expect(data.map(({ value }) => value)).toEqual([
      "older-run",
      "base-first",
      "base-second",
      "equal-older-run",
      "equal-newer-run",
      "newer-run",
      "base-last",
    ]);
    expect(impl.getFullStoreStatsForTests()).toEqual({ runCount: 2, mergedPointCopies: 4 });
  });

  it("selects the global predecessor and successor across sorted runs", () => {
    const impl = setup("headerStamp");
    for (const datum of [
      { x: 12, value: "base" },
      { x: 8, value: "predecessor" },
      { x: 14, value: "successor" },
      { x: 10, value: "inside" },
    ]) {
      impl.applyActions([
        { type: "append-full", key: "4:/state", batch: packStateDatums([datum]) },
      ]);
    }

    // xBounds 10..12 are prepared with the normal half-window buffer, i.e. 9..13.
    expect(build(impl, { min: 10, max: 12, showPoints: true }).data.map(({ x }) => x)).toEqual([
      8, 10, 12, 14,
    ]);
  });

  it("removes current/header overlaps found in either the base or a pending run", () => {
    const impl = setup("headerStamp");
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 20, value: "full-20" }]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 10, value: "full-10" }]),
      },
      {
        type: "append-current",
        key: "4:/state",
        batch: packStateDatums([
          { x: 10, value: "duplicate-run" },
          { x: 15, value: "live-15" },
          { x: 20, value: "duplicate-base" },
          { x: 25, value: "live-25" },
        ]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 15, value: "full-15" }]),
      },
    ]);

    const { data } = build(impl, { min: 0, max: 30, showPoints: true });
    expect(data.map(({ x, value }) => [x, value])).toEqual([
      [10, "full-10"],
      [15, "full-15"],
      [20, "full-20"],
      [25, "live-25"],
    ]);
  });

  it("uses the global full-history maximum when trimming receive-time current data", () => {
    const impl = setup("receiveTime");
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 100, value: "base" }]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 50, value: "older-run" }]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 200, value: "newer-run-maximum" }]),
      },
      {
        type: "append-current",
        key: "4:/state",
        batch: packStateDatums([
          { x: 150, value: "stale" },
          { x: 201, value: "live" },
        ]),
      },
    ]);

    expect(
      build(impl, { min: 0, max: 220, showPoints: true }).data.map(({ x, value }) => [x, value]),
    ).toEqual([
      [50, "older-run"],
      [100, "base"],
      [200, "newer-run-maximum"],
      [201, "live"],
    ]);
  });

  it("remaps metadata referenced by the base and sorted runs after current reset", () => {
    const impl = setup("headerStamp");
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 20, value: true }]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 5, value: 1n }]),
      },
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([{ x: 10, value: "kept" }]),
      },
      {
        type: "append-current",
        key: "4:/state",
        batch: packStateDatums(
          Array.from({ length: 1_500 }, (_, index) => ({
            x: 100 + index,
            value: `discarded-${index}`,
          })),
        ),
      },
      { type: "reset-current" },
    ]);

    expect(
      build(impl, { min: 0, max: 30, showPoints: true }).data.map(({ value }) => value),
    ).toEqual([1n, "kept", true]);
  });

  it("bounds reverse-range merge copies by binomial run levels", () => {
    const monotonic = setup("headerStamp");
    const reverse = setup("headerStamp");
    const batchCount = 256;
    const pointsPerBatch = 16;
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const ascendingStart = batchIndex * pointsPerBatch;
      const descendingStart = (batchCount - batchIndex - 1) * pointsPerBatch;
      monotonic.applyActions([
        {
          type: "append-full",
          key: "4:/state",
          batch: packStateDatums(
            Array.from({ length: pointsPerBatch }, (_, offset) => ({
              x: ascendingStart + offset,
              value: (ascendingStart + offset) % 2,
            })),
          ),
        },
      ]);
      reverse.applyActions([
        {
          type: "append-full",
          key: "4:/state",
          batch: packStateDatums(
            Array.from({ length: pointsPerBatch }, (_, offset) => ({
              x: descendingStart + offset,
              value: (descendingStart + offset) % 2,
            })),
          ),
        },
      ]);
    }

    expect(monotonic.getFullStoreStatsForTests()).toEqual({
      runCount: 1,
      mergedPointCopies: 0,
    });
    const pendingBatchCount = batchCount - 1;
    let expectedMergedPointCopies = 0;
    for (
      let batchesPerMergedRun = 2;
      batchesPerMergedRun <= pendingBatchCount;
      batchesPerMergedRun *= 2
    ) {
      expectedMergedPointCopies +=
        Math.floor(pendingBatchCount / batchesPerMergedRun) * batchesPerMergedRun * pointsPerBatch;
    }
    expect(reverse.getFullStoreStatsForTests()).toEqual({
      // One monotonic base plus popcount(255) pending runs.
      runCount: 9,
      mergedPointCopies: expectedMergedPointCopies,
    });

    const statsBeforeViewport = reverse.getFullStoreStatsForTests();
    expect(
      build(reverse, { min: 2_047, max: 2_049, showPoints: true }).data.map(({ x }) => x),
    ).toEqual([2_046, 2_047, 2_048, 2_049, 2_050, 2_051]);
    expect(reverse.getFullStoreStatsForTests()).toEqual(statsBeforeViewport);

    expect(reverse.getStorageByteLengthsForTests().full).toBeGreaterThan(0);
    reverse.applyActions([{ type: "reset-series", key: "4:/state" }]);
    expect(reverse.getFullStoreStatsForTests()).toEqual({ runCount: 0, mergedPointCopies: 0 });
    expect(reverse.getStorageByteLengthsForTests()).toEqual({ full: 0, current: 0 });
  });

  it("retains raw plateau samples when Show Points is toggled", () => {
    const impl = setup();
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 0, value: true },
          { x: 1, value: true },
          { x: 2, value: true },
        ]),
      },
    ]);

    const collapsed = build(impl);
    expect(collapsed.data.map(({ x }) => x)).toEqual([0, 2]);
    expect(collapsed.dataset.pointRadius).toBe(0);

    const expanded = build(impl, { showPoints: true });
    expect(expanded.data.map(({ x }) => x)).toEqual([0, 1, 2]);
    expect(expanded.dataset.pointRadius).toBe(1.25);
    expect(expanded.data.map(({ label }) => label)).toEqual(["true", undefined, undefined]);
  });

  it("preserves exact primitive types in the discrete side table", () => {
    const impl = setup();
    const datums: StateDatum[] = [
      { x: 0, value: 1 },
      { x: 1, value: 1n },
      { x: 2, value: "1" },
      { x: 3, value: true },
    ];
    impl.applyActions([{ type: "append-full", key: "4:/state", batch: packStateDatums(datums) }]);

    expect(build(impl).data.map(({ value }) => value)).toEqual([1, 1n, "1", true]);
  });

  it("survives dataset-to-main and main-to-chart ownership transfers", () => {
    const impl = setup();
    const datums: StateDatum[] = [
      { x: 0, value: 1 },
      { x: 1, value: 1n },
      { x: 2, value: "1" },
      { x: 3, value: true },
    ];
    impl.applyActions([{ type: "append-full", key: "4:/state", batch: packStateDatums(datums) }]);
    const datasetWorkerResult = build(impl, { showPoints: true }).dataset;

    expect(datasetWorkerResult.x.buffer).not.toBe(datasetWorkerResult.metadataIndices.buffer);
    expect(datasetWorkerResult.x.byteLength).toBe(
      datasetWorkerResult.x.length * Float64Array.BYTES_PER_ELEMENT,
    );
    expect(datasetWorkerResult.metadataIndices.byteLength).toBe(
      datasetWorkerResult.metadataIndices.length * Uint32Array.BYTES_PER_ELEMENT,
    );
    const datasetTransferables = collectTransferableBuffers(datasetWorkerResult);
    expect(datasetTransferables).toHaveLength(2);
    const mainThreadResult = structuredClone(datasetWorkerResult, {
      transfer: datasetTransferables,
    });
    expect(datasetWorkerResult.x.byteLength).toBe(0);
    expect(datasetWorkerResult.metadataIndices.byteLength).toBe(0);
    expect(mainThreadResult.configIndex).toBe(4);

    const chartTransferables = collectTransferableBuffers(mainThreadResult);
    expect(chartTransferables).toHaveLength(2);
    const chartWorkerResult = structuredClone(mainThreadResult, { transfer: chartTransferables });
    expect(mainThreadResult.x.byteLength).toBe(0);
    expect(mainThreadResult.metadataIndices.byteLength).toBe(0);
    expect(chartWorkerResult.configIndex).toBe(4);
    expect(unpackStateTransitionDataset(chartWorkerResult).map(({ value }) => value)).toEqual([
      1,
      1n,
      "1",
      true,
    ]);
  });

  it("keeps compressed interval state labels for tooltips", () => {
    const impl = setup();
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 10, value: 0, constantName: "OFF" },
          { x: 10.01, value: 1, constantName: "ON" },
          { x: 10.02, value: 2, constantName: "ERROR" },
        ]),
      },
    ]);

    const compressed = build(impl, { min: 0, max: 100, width: 300 }).data.find(
      ({ label }) => label === "[...]",
    );
    expect(compressed?.states).toEqual(["OFF (0)", "ON (1)", "ERROR (2)"]);
  });

  it("keeps sparse transitions in their true pixel buckets when they fit the budget", () => {
    const impl = setup();
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums([
          { x: 0, value: 0 },
          { x: 1, value: 1 },
          { x: 2, value: 0 },
          { x: 3, value: 1 },
        ]),
      },
    ]);

    expect(build(impl, { min: 0, max: 10, width: 300 }).data.map(({ x }) => x)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("uses binary viewport slicing over million-point compact history", () => {
    const impl = setup();
    const length = 1_000_000;
    const x = new Float64Array(length);
    const metadataIndices = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      x[i] = i;
      metadataIndices[i] = i % 2;
    }
    const batch: PackedStateDatumBatch = {
      x,
      metadataIndices,
      metadata: [{ value: false }, { value: true }],
    };
    impl.applyActions([{ type: "append-full", key: "4:/state", batch }]);

    const xs = build(impl, { min: 500_000, max: 500_010 }).data.map(({ x: value }) => value);
    // The worker keeps the half-window pan buffer (499_995..500_015) plus the first successor.
    expect(xs[0]).toBe(499_995);
    expect(xs.at(-1)).toBe(500_016);
    expect(xs).toHaveLength(22);
  });

  it("bounds dense multi-series output with a shared point budget", () => {
    const impl = new StateTransitionsDatasetBuilderImpl();
    impl.applyActions([
      {
        type: "set-series",
        series: [0, 1, 2].map((configIndex) => ({
          key: String(configIndex),
          configIndex,
          enabled: true,
          label: String(configIndex),
          timestampMethod: "receiveTime" as const,
          y: (configIndex + 1) * -18,
        })),
      },
    ]);
    // Fill the complete half-window pan buffer and include both continuity boundary points.
    const datums = Array.from({ length: 22_001 }, (_, x) => ({
      x: x / 10 - 600,
      // Two-sample plateaus exercise the unlabeled endpoint path in the downsampler. Those
      // endpoints used to be appended outside each allocated per-series budget.
      value: Math.floor(x / 2) % 4,
    }));
    impl.applyActions(
      [0, 1, 2].map((key) => ({
        type: "append-full" as const,
        key: String(key),
        batch: packStateDatums(datums),
      })),
    );

    const datasets = impl.getViewportDatasets({
      xBounds: { min: 0, max: 1_000 },
      viewport: {
        width: 20_000,
        height: 100,
        bounds: { x: { min: 0, max: 1_000 }, y: { min: -100, max: -3 } },
      },
      showPoints: false,
    });
    const total = datasets.reduce((sum, dataset) => sum + dataset.x.length, 0);
    expect(total).toBeLessThanOrEqual(5_000);
  });

  it("honors one-point allocations for degenerate viewports", () => {
    const seriesCount = 2_501;
    const impl = new StateTransitionsDatasetBuilderImpl();
    impl.applyActions([
      {
        type: "set-series",
        series: Array.from({ length: seriesCount }, (_, configIndex) => ({
          key: String(configIndex),
          configIndex,
          enabled: true,
          label: String(configIndex),
          timestampMethod: "receiveTime" as const,
          y: -configIndex,
        })),
      },
    ]);
    impl.applyActions(
      Array.from({ length: seriesCount }, (_, key) => ({
        type: "append-full" as const,
        key: String(key),
        batch: packStateDatums([
          { x: 0, value: false },
          { x: 1, value: true },
        ]),
      })),
    );

    const datasets = impl.getViewportDatasets({
      xBounds: { min: 0, max: 0 },
      viewport: {
        width: 300,
        height: 100,
        bounds: { x: { min: 0, max: 0 }, y: { min: -100, max: -3 } },
      },
      showPoints: false,
    });
    expect(datasets.reduce((sum, dataset) => sum + dataset.x.length, 0)).toBeLessThanOrEqual(5_000);
    expect(datasets.at(-1)?.x.length).toBeLessThanOrEqual(1);
  });

  it("never sends unbounded history before canvas dimensions are known", () => {
    const impl = setup();
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: packStateDatums(
          Array.from({ length: 20_000 }, (_, x) => ({ x, value: x % 2 === 0 })),
        ),
      },
    ]);

    expect(build(impl, { max: 20_000 }).dataset.x.length).toBeLessThanOrEqual(5_002);
    expect(build(impl, { max: 20_000, showPoints: true }).dataset.x.length).toBeLessThanOrEqual(
      5_002,
    );
  });

  it("caps live-only history without copying an object per retained sample", () => {
    const impl = setup();
    const length = 60_000;
    const x = new Float64Array(length);
    const metadataIndices = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      x[i] = i;
      metadataIndices[i] = i % 2;
    }
    impl.applyActions([
      {
        type: "append-current",
        key: "4:/state",
        batch: { x, metadataIndices, metadata: [{ value: false }, { value: true }] },
      },
    ]);

    const { data } = build(impl, { max: length });
    expect(data[0]?.x).toBeGreaterThanOrEqual(10_000);
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(5_002);
  });

  it("releases peak typed-column capacity after live retention and series reset", () => {
    const impl = setup();
    const length = 200_000;
    const batch: PackedStateDatumBatch = {
      x: Float64Array.from({ length }, (_, index) => index),
      metadataIndices: Uint32Array.from({ length }, (_, index) => index % 2),
      metadata: [{ value: false }, { value: true }],
    };

    impl.applyActions([{ type: "append-current", key: "4:/state", batch }]);
    expect(impl.getStorageByteLengthsForTests().current).toBeLessThanOrEqual(
      50_000 * 2 * (Float64Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT),
    );

    impl.applyActions([{ type: "append-full", key: "4:/state", batch }]);
    expect(impl.getStorageByteLengthsForTests().full).toBeGreaterThan(0);
    impl.applyActions([{ type: "reset-series", key: "4:/state" }]);
    expect(impl.getStorageByteLengthsForTests()).toEqual({ full: 0, current: 0 });
  });

  it.each([
    { name: "NaN range", min: Number.NaN, max: 10, width: 300 },
    { name: "infinite range", min: 0, max: Number.POSITIVE_INFINITY, width: 300 },
    { name: "reversed range", min: 10, max: 0, width: 300 },
    { name: "negative viewport width", min: 0, max: 10, width: -1 },
  ])("rejects an invalid $name before preparing stored history", ({ min, max, width }) => {
    const impl = setup();
    const length = 100_000;
    impl.applyActions([
      {
        type: "append-full",
        key: "4:/state",
        batch: {
          x: Float64Array.from({ length }, (_, index) => index),
          metadataIndices: new Uint32Array(length),
          metadata: [{ value: false }],
        },
      },
    ]);
    const before = impl.getStorageByteLengthsForTests();

    const result = impl.getViewportDatasets({
      xBounds: { min, max },
      viewport: {
        width,
        height: 100,
        bounds: { x: { min, max }, y: { min: -100, max: -3 } },
      },
      showPoints: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.x).toHaveLength(0);
    expect(impl.getStorageByteLengthsForTests()).toEqual(before);
  });
});
