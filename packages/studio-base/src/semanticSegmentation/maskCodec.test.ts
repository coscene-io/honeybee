// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  countsFromRuns,
  decodeCounts,
  encodeCounts,
  maskContains,
  maskIou,
  maskRunsFromCounts,
  unionRuns,
} from "./maskCodec";
import { maskToPolygons, polygonsToRuns, type PixelPolygon } from "./maskPolygon";
import codecFixture from "./testing/fixtures/detSegCodec.json";
import maskFixture from "./testing/fixtures/detSegMasks.json";

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
      expect(pixels).toEqual(item.pixels);
      expect(countsFromRuns(mask)).toBe(item.counts);
      expect(encodeCounts(decodeCounts(item.counts))).toBe(item.counts);
      // pixels are Fortran-ordered: index = x * height + y.
      const first = item.pixels.indexOf(1);
      if (first >= 0) {
        expect(maskContains(mask, Math.floor(first / height), first % height)).toBe(true);
      }
    },
  );

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

// The fixture polygons come from the Python/OpenCV oracle. det_seg's Go port is accepted against
// that oracle by IoU, not vertex identity (it keeps degenerate components the oracle drops), so
// this port is held to the same two acceptance tests.
describe("det_seg MaskToPolygons/PolygonsToMask parity", () => {
  it.each(maskFixture.cases.map((item) => [item.base, item] as const))(
    "%s round-trips no worse than the OpenCV oracle and rasterizes like cv2.fillPoly",
    (_base, item) => {
      const [height, width] = item.size as [number, number];
      const mask = maskRunsFromCounts(item.counts, width, height);
      expect(mask.area).toBe(item.area);
      const polygons = maskToPolygons(mask, 1);
      expect(polygons.every((ring) => ring.length > 0)).toBe(true);
      const roundTrip = polygonsToRuns(polygons, width, height);
      expect(maskIou(mask, roundTrip)).toBeGreaterThanOrEqual(item.roundtripIou - 0.001);
      const want = maskRunsFromCounts(item.polygonsCounts, width, height);
      const raster = polygonsToRuns(item.polygons as PixelPolygon[], width, height);
      expect(maskIou(want, raster)).toBeGreaterThanOrEqual(0.98);
    },
  );
});
