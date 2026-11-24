// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  countsFromRuns,
  decodeCounts,
  encodeCounts,
  inferMaskFrameSize,
  maskContains,
  maskCountsCoverage,
  maskIou,
  maskRunsFromCounts,
  unionRuns,
} from "./maskCodec";
import { maskToSimplePolygons, polygonsToRuns, type PixelPolygon } from "./maskPolygon";
import codecFixture from "./testing/fixtures/codec.json";
import maskFixture from "./testing/fixtures/masks.json";

describe("mask frame size inference", () => {
  it("covers the counts and names common sizes and the current aspect ratio", () => {
    expect(maskCountsCoverage(encodeCounts([5, 5, 90]))).toBe(100);
    expect(inferMaskFrameSize(1280 * 720, 854, 480)).toEqual({ width: 1280, height: 720 });
    expect(inferMaskFrameSize(720 * 360, 800, 400)).toEqual({ width: 720, height: 360 });
    expect(inferMaskFrameSize(12345, 854, 480)).toBeUndefined();
  });
});

describe("COCO RLE counts", () => {
  it.each(codecFixture.cases.map((item, index) => [index, item] as const))(
    "matches pycocotools pair %i byte for byte",
    (_index, item) => {
      const [height, width] = item.size as [number, number];
      const mask = maskRunsFromCounts(item.counts, width, height);
      const pixels = new Array<number>(width * height).fill(0);
      for (let i = 0; i < mask.intervals.length; i += 2) {
        pixels.fill(1, mask.intervals[i], mask.intervals[i + 1]);
      }
      // One "0"/"1" string per column, so the joined string is the column-major pixel order.
      const expected = Array.from(item.columns.join(""), Number);
      expect(pixels).toEqual(expected);
      expect(countsFromRuns(mask)).toBe(item.counts);
      expect(encodeCounts(decodeCounts(item.counts))).toBe(item.counts);
      // pixels are Fortran-ordered: index = x * height + y.
      const first = expected.indexOf(1);
      if (first >= 0) {
        expect(maskContains(mask, Math.floor(first / height), first % height)).toBe(true);
      }
    },
  );

  it("round-trips run lengths that need a seventh character", () => {
    // 2^31 + 5 needs 32 bits; a 32-bit shift decoder wraps it negative and rejects it.
    const runs = [0, 2 ** 31 + 5, 3, 2 ** 33 + 1, 7];
    const counts = encodeCounts(runs);
    expect(encodeCounts([2 ** 33])).toHaveLength(7);
    expect(decodeCounts(counts)).toEqual(runs);
    // Large negative deltas between alternate runs stay exact too.
    const falling = [0, 2 ** 32, 1, 5, 2];
    expect(decodeCounts(encodeCounts(falling))).toEqual(falling);
  });

  it("rejects counts that do not cover the bound frame size", () => {
    const counts = maskFixture.cases[0]!.counts;
    expect(() => maskRunsFromCounts(counts, 1280, 720)).not.toThrow();
    expect(() => maskRunsFromCounts(counts, 640, 360)).toThrow(/bound 640×360/);
    expect(() => maskRunsFromCounts(counts, 0, 0)).toThrow(/positive decoded frame size/);
    expect(() => decodeCounts("0\u0001")).toThrow(/Malformed/);
  });

  it("unions masks in run space", () => {
    const a = maskRunsFromCounts(maskFixture.cases[5]!.counts, 1280, 720);
    const b = maskRunsFromCounts(maskFixture.cases[6]!.counts, 1280, 720);
    const union = unionRuns(a, b);
    expect(maskIou(union, a)).toBeLessThanOrEqual(1);
    expect(union.area).toBeGreaterThanOrEqual(Math.max(a.area, b.area));
    expect(union.area).toBeLessThanOrEqual(a.area + b.area);
    expect(maskRunsFromCounts(countsFromRuns(union), 1280, 720).area).toBe(union.area);
  });
});

// The fixture polygons come from the OpenCV reference in testing/fixtures/generate.py. The port is
// held to it by IoU, not vertex identity: it must round-trip no worse, and rasterize its polygons
// like cv2.fillPoly.
describe("MaskToPolygons/PolygonsToMask against the OpenCV reference", () => {
  it.each(maskFixture.cases.map((item) => [item.base, item] as const))(
    "%s round-trips no worse than the OpenCV oracle and rasterizes like cv2.fillPoly",
    (_base, item) => {
      const [height, width] = item.size as [number, number];
      const mask = maskRunsFromCounts(item.counts, width, height);
      expect(mask.area).toBe(item.area);
      const polygons = maskToSimplePolygons(mask, 1);
      if (item.base === "thin-line") {
        // A one-pixel filament has no polygon the annotation contract accepts: it drops out.
        expect(polygons).toEqual([]);
        return;
      }
      expect(polygons.every((ring) => ring.length > 0)).toBe(true);
      const roundTrip = polygonsToRuns(polygons, width, height);
      expect(maskIou(mask, roundTrip)).toBeGreaterThanOrEqual(item.roundtripIou - 0.001);
      const want = maskRunsFromCounts(item.polygonsCounts, width, height);
      const raster = polygonsToRuns(item.polygons as PixelPolygon[], width, height);
      expect(maskIou(want, raster)).toBeGreaterThanOrEqual(0.98);
    },
  );
});
