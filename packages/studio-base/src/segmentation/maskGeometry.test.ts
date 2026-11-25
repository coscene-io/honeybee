// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { countsFromRuns, runsFromIntervals, runsOfBitmap, subtractRuns } from "./maskCodec";
import {
  ByteLru,
  applyStroke,
  clearMaskGeometryCaches,
  maskGeometryCacheBytes,
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
import * as maskPolygon from "./maskPolygon";
import type { FrameInstance, ObservationGeometry, SegmentationMask } from "./types";

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

jest.mock("./maskPolygon", () => {
  const actual = jest.requireActual<typeof import("./maskPolygon")>("./maskPolygon");
  return { ...actual, maskToSimplePolygons: jest.fn(actual.maskToSimplePolygons) };
});

/** A deterministic blob with a noisy edge, the shape SAM masks on real footage have. */
function noisyMask(width: number, height: number, seed = 7): SegmentationMask {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const bits = new Uint8Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = radius + (random() - 0.5) * 12;
      if (Math.hypot(x - cx, y - cy) < edge) {
        bits[y * width + x] = 1;
      }
    }
  }
  const runs = runsOfBitmap(bits, { x0: 0, y0: 0, w: width, h: height }, width, height);
  return { counts: countsFromRuns(runs), width, height };
}

/**
 * A rectangle whose four edges are 3-pixel teeth: the outline keeps thousands of vertices after
 * simplification (eps=1), the worst case for the ring simplicity check.
 */
function combMask(width: number, height: number): SegmentationMask {
  const bits = new Uint8Array(width * height);
  for (let y = 100; y < height - 100; y++) {
    for (let x = 20; x < width - 20; x++) {
      const toothX = Math.floor(x / 3) % 2 === 0 ? 4 : 0;
      const toothY = Math.floor(y / 3) % 2 === 0 ? 4 : 0;
      if (
        y >= 100 + toothX &&
        y < height - 100 - toothX &&
        x >= 20 + toothY &&
        x < width - 20 - toothY
      ) {
        bits[y * width + x] = 1;
      }
    }
  }
  const runs = runsOfBitmap(bits, { x0: 0, y0: 0, w: width, h: height }, width, height);
  return { counts: countsFromRuns(runs), width, height };
}

describe("mask geometry caches", () => {
  beforeEach(() => {
    clearMaskGeometryCaches();
    jest.mocked(maskPolygon.maskToSimplePolygons).mockClear();
  });

  it("traces a mask once for the loss preview and the conversion that follows", () => {
    const mask = noisyMask(320, 240);
    const loss = maskConversionLoss(mask);
    const polygons = maskToEditorPolygons(mask, "/camera");
    expect(polygons).toHaveLength(loss.polygonCount);
    expect(maskPolygon.maskToSimplePolygons).toHaveBeenCalledTimes(1);
    // Fresh ids every conversion, even from the cached trace.
    expect(maskToEditorPolygons(mask, "/camera")[0]!.id).not.toBe(polygons[0]!.id);
  });

  it("bounds every cache by bytes and drops them on clear", () => {
    for (let seed = 1; seed <= 6; seed++) {
      maskConversionLoss(noisyMask(160, 120, seed));
    }
    const bytes = maskGeometryCacheBytes();
    expect(bytes.runs).toBeGreaterThan(0);
    expect(bytes.rings).toBeGreaterThan(0);
    clearMaskGeometryCaches();
    expect(maskGeometryCacheBytes()).toEqual({ runs: 0, area: 0, polygonRuns: 0, rings: 0 });
  });

  it("evicts least recently used entries past the byte budget, counting the key", () => {
    const cache = new ByteLru<number>(1000, () => 8);
    const key = (index: number) => `${index}:${"x".repeat(100)}`;
    for (let index = 0; index < 20; index++) {
      cache.set(key(index), index);
      cache.get(key(0)); // keep the first one hot
    }
    expect(cache.byteSize()).toBeLessThanOrEqual(1000);
    expect(cache.get(key(0))).toBe(0);
    expect(cache.get(key(1))).toBeUndefined();
    expect(cache.get(key(19))).toBe(19);
    // An entry larger than the whole budget is not kept and evicts nothing.
    cache.set("huge", 1);
    expect(cache.get("huge")).toBe(1);
    const big = new ByteLru<string>(100, (value) => value.length);
    big.set("a", "y".repeat(500));
    expect(big.get("a")).toBeUndefined();
    expect(big.byteSize()).toBe(0);
  });

  it.each([
    ["a noisy edge", () => noisyMask(1920, 1080)],
    ["a toothed edge", () => combMask(1920, 1080)],
  ])("converts a 1080p mask with %s in interactive time", (_name, make) => {
    const mask = make();
    const started = performance.now();
    const polygons = maskToEditorPolygons(mask, "/camera");
    const elapsed = performance.now() - started;
    expect(polygons.length).toBeGreaterThan(0);
    // The toothed mask took ~1.9 s with the all-pairs simplicity check and ~0.3 s with the grid;
    // the bound leaves room for slower CI machines.
    expect(elapsed).toBeLessThan(1500);
  });
});
