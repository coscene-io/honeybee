// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  attachUnpackedDataAccessor,
  getPackedDatasetTransferables,
  PackedDatasetWriter,
  restoreUnpackedDataAccessor,
  unpackPackedDatasetData,
} from "./PackedDataset";

describe("PackedDataset", () => {
  it("round-trips tooltip values without losing bigint, string, boolean, or time semantics", () => {
    const writer = new PackedDatasetWriter(8);
    const time = { sec: 12, nsec: 34 };
    const oversizedBigInt = 1n << 70n;
    writer.set(0, 0, 1);
    writer.set(1, 1, 2, 2);
    writer.set(2, 2, 1, true);
    writer.set(3, 3, 3, 3n);
    writer.set(4, 4, -4, -4n);
    writer.set(5, 5, 5, "05");
    writer.set(6, 6, 12, time);
    writer.set(7, 7, Number(oversizedBigInt), oversizedBigInt);

    expect(unpackPackedDatasetData(writer.finish())).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 2, value: 2 },
      { x: 2, y: 1, value: true },
      { x: 3, y: 3, value: 3n },
      { x: 4, y: -4, value: -4n },
      { x: 5, y: 5, value: "05" },
      { x: 6, y: 12, value: time },
      { x: 7, y: Number(oversizedBigInt), value: oversizedBigInt },
    ]);
  });

  it("does not normalize noncanonical Time tooltip values", () => {
    const writer = new PackedDatasetWriter(2);
    const overflowingNanoseconds = { sec: 1, nsec: 1_000_000_000 };
    const negativeNanoseconds = { sec: 3, nsec: -1 };
    writer.set(0, 0, 1, overflowingNanoseconds);
    writer.set(1, 1, 2, negativeNanoseconds);

    expect(unpackPackedDatasetData(writer.finish())).toEqual([
      { x: 0, y: 1, value: overflowingNanoseconds },
      { x: 1, y: 2, value: negativeNanoseconds },
    ]);
  });

  it("creates exact, independent transfer columns", () => {
    const writer = new PackedDatasetWriter(3);
    writer.set(0, 0, 1, 1);
    writer.set(1, 1, 2, 2);
    writer.set(2, 2, 3, 3);
    const packed = writer.finish();

    expect(packed.points).toHaveLength(6);
    expect(packed.valueKinds).toHaveLength(3);
    expect(packed.valuePayloads).toHaveLength(3);
    const transferables = getPackedDatasetTransferables(packed);
    expect(transferables).toHaveLength(3);
    expect(transferables[0]).toBe(packed.points.buffer);
    expect(transferables[1]).toBe(packed.valueKinds.buffer);
    expect(transferables[2]).toBe(packed.valuePayloads.buffer);
  });

  it("survives both transfer stages without detaching a canonical history buffer", () => {
    const writer = new PackedDatasetWriter(3);
    writer.set(0, 1, 2, true);
    writer.set(1, 3, 4, 9_007_199_254_740_993n);
    writer.set(2, 5, 6, "six");
    const datasetWorkerResult = writer.finish();

    const mainThreadResult = structuredClone(datasetWorkerResult, {
      transfer: getPackedDatasetTransferables(datasetWorkerResult),
    });
    expect(datasetWorkerResult.points.byteLength).toBe(0);
    expect(datasetWorkerResult.valueKinds.byteLength).toBe(0);
    expect(datasetWorkerResult.valuePayloads.byteLength).toBe(0);

    const chartWorkerResult = structuredClone(mainThreadResult, {
      transfer: getPackedDatasetTransferables(mainThreadResult),
    });
    expect(mainThreadResult.points.byteLength).toBe(0);
    expect(unpackPackedDatasetData(chartWorkerResult)).toEqual([
      { x: 1, y: 2, value: true },
      { x: 3, y: 4, value: 9_007_199_254_740_993n },
      { x: 5, y: 6, value: "six" },
    ]);
  });

  it("keeps the compatibility data accessor out of structured-clone properties", () => {
    const writer = new PackedDatasetWriter(1);
    writer.set(0, 1, 2, 2);
    const dataset = attachUnpackedDataAccessor({ packedData: writer.finish() });

    expect(dataset.data).toEqual([{ x: 1, y: 2, value: 2 }]);
    expect(Object.keys(dataset)).toEqual(["packedData"]);

    const clonedShape: { packedData: typeof dataset.packedData; data?: unknown } = {
      packedData: dataset.packedData,
    };
    restoreUnpackedDataAccessor(clonedShape);
    expect(clonedShape.data).toEqual([{ x: 1, y: 2, value: 2 }]);
    expect(Object.keys(clonedShape)).toEqual(["packedData"]);
  });
});
