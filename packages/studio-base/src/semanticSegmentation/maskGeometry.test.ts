// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { countsFromRuns, runsFromIntervals, subtractRuns } from "./maskCodec";
import {
  applyStroke,
  maskArea,
  maskConversionLoss,
  maskObservation,
  maskOf,
  maskToEditorPolygons,
  mergeObservations,
  polygonObservation,
  polygonsOf,
  runsOfPolygons,
  strokeRuns,
} from "./maskGeometry";
import type { FrameInstance, ObservationGeometry } from "./types";

describe("maskToEditorPolygons", () => {
  it("never yields a polygon the contract cannot save, and counts what it leaves out", () => {
    const size = 64;
    const intervals: number[] = [];
    // A 20×20 square, a vertical two-pixel speck and a single pixel (column-major index x*H+y).
    for (let x = 10; x < 30; x++) {
      intervals.push(x * size + 10, x * size + 30);
    }
    intervals.push(40 * size + 5, 40 * size + 7);
    intervals.push(50 * size + 50, 50 * size + 51);
    const runs = runsFromIntervals(Uint32Array.from(intervals), size, size);
    const conversion = maskToEditorPolygons(
      { counts: countsFromRuns(runs), width: size, height: size },
      "/camera",
    );
    // The one- and two-pixel components drop out; the contract rejects polygons under three vertices.
    expect(conversion).toHaveLength(1);
    expect(conversion[0]!.points.length).toBeGreaterThanOrEqual(3);
  });
});

/** A square ring: the outer square minus an inner square (one hole), column-major. */
function ringMask(size: number, outer: [number, number], inner: [number, number]) {
  const intervals: number[] = [];
  for (let x = outer[0]; x < outer[1]; x++) {
    if (x >= inner[0] && x < inner[1]) {
      intervals.push(x * size + outer[0], x * size + inner[0]);
      intervals.push(x * size + inner[1], x * size + outer[1]);
    } else {
      intervals.push(x * size + outer[0], x * size + outer[1]);
    }
  }
  const runs = runsFromIntervals(Uint32Array.from(intervals), size, size);
  return { counts: countsFromRuns(runs), width: size, height: size };
}

describe("subtractRuns", () => {
  it("removes exactly the overlapping pixels", () => {
    const a = runsFromIntervals(Uint32Array.from([0, 10, 20, 30]), 10, 4);
    const b = runsFromIntervals(Uint32Array.from([5, 25]), 10, 4);
    expect([...subtractRuns(a, b).intervals]).toEqual([0, 5, 25, 30]);
    expect(subtractRuns(a, a).area).toBe(0);
    expect(subtractRuns(a, runsFromIntervals(new Uint32Array(0), 10, 4)).area).toBe(20);
  });
});

describe("brush strokes", () => {
  it("covers the pixels whose centres are within the radius of the stroke", () => {
    const dot = strokeRuns([{ x: 10.5, y: 10.5 }], 2, 32, 32);
    // A radius-2 disc around a pixel centre: 13 pixel centres within distance 2.
    expect(dot.area).toBe(13);
    const line = strokeRuns(
      [
        { x: 5.5, y: 16.5 },
        { x: 25.5, y: 16.5 },
      ],
      1,
      32,
      32,
    );
    expect(line.bbox).toEqual({ x0: 4, y0: 15, x1: 26, y1: 17 });
  });

  it("paints into polygons as a mask and erases back to nothing", () => {
    const square: ObservationGeometry = {
      kind: "polygons",
      polygons: [
        {
          id: "p",
          points: [
            { x: 0.25, y: 0.25 },
            { x: 0.5, y: 0.25 },
            { x: 0.5, y: 0.5 },
            { x: 0.25, y: 0.5 },
          ],
        },
      ],
    };
    const stroke = strokeRuns([{ x: 40.5, y: 40.5 }], 3, 64, 64);
    const painted = applyStroke(square, stroke, "paint");
    expect(painted).toMatchObject({ width: 64, height: 64, source: "brush" });
    expect(maskArea(painted.counts)).toBe(
      runsOfPolygons(square.polygons, 64, 64).area + stroke.area,
    );
    const erased = applyStroke({ kind: "mask", mask: painted }, stroke, "erase");
    expect(maskArea(erased.counts)).toBe(runsOfPolygons(square.polygons, 64, 64).area);
    const everything = strokeRuns([{ x: 32, y: 32 }], 64, 64, 64);
    expect(maskArea(applyStroke({ kind: "mask", mask: erased }, everything, "erase").counts)).toBe(
      0,
    );
  });
});

describe("observation invariants", () => {
  it("never leaves an empty observation", () => {
    expect(polygonObservation("f", "i", [])).toBeUndefined();
    expect(
      polygonObservation("f", "i", [{ id: "draft", points: [{ x: 0, y: 0 }] }]),
    ).toBeUndefined();
    const empty = runsFromIntervals(new Uint32Array(0), 4, 4);
    expect(maskObservation("f", "i", { counts: countsFromRuns(empty), width: 4, height: 4 })).toBe(
      undefined,
    );
  });

  it("merges polygons into a mask as one mask, and polygons with polygons as polygons", () => {
    const mask = ringMask(32, [4, 20], [8, 12]);
    const polygons: FrameInstance = {
      frameId: "f",
      instanceId: "i",
      kind: "polygons",
      polygons: [
        {
          id: "p",
          points: [
            { x: 0.75, y: 0.75 },
            { x: 0.9, y: 0.75 },
            { x: 0.9, y: 0.9 },
          ],
        },
      ],
    };
    const merged = mergeObservations(
      { frameId: "f", instanceId: "i", kind: "mask", mask },
      polygons,
      "i",
    );
    expect(merged.kind).toBe("mask");
    expect(maskArea(maskOf(merged)!.counts)).toBe(
      maskArea(mask.counts) + runsOfPolygons(polygons.polygons, 32, 32).area,
    );
    const both = mergeObservations(
      polygons,
      { ...polygons, polygons: [{ ...polygons.polygons[0]!, id: "q" }] },
      "i",
    );
    expect(both.kind).toBe("polygons");
    expect(polygonsOf(both).map((polygon) => polygon.id)).toEqual(["p", "q"]);
  });
});

describe("maskConversionLoss", () => {
  it("reports the hole polygons cannot hold", () => {
    const loss = maskConversionLoss(ringMask(32, [4, 20], [8, 12]));
    expect(loss.holes).toBe(1);
    expect(loss.addedPixels).toBeGreaterThan(0);
    expect(loss.iou).toBeLessThan(1);
    expect(loss.polygonCount).toBeGreaterThan(0);
  });

  it("reports slivers that cannot become polygons", () => {
    const size = 32;
    const intervals: number[] = [];
    for (let x = 4; x < 14; x++) {
      intervals.push(x * size + 4, x * size + 14);
    }
    intervals.push(20 * size + 20, 20 * size + 21);
    const runs = runsFromIntervals(Uint32Array.from(intervals), size, size);
    const loss = maskConversionLoss({ counts: countsFromRuns(runs), width: size, height: size });
    expect(loss.droppedComponents).toBe(1);
    expect(loss.holes).toBe(0);
    expect(loss.lostPixels).toBeGreaterThanOrEqual(1);
  });
});
