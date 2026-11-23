// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { buildCanvasPropagationScope } from "./components/propagationSeeds";
import { countsFromRuns, runsFromIntervals, type MaskRuns } from "./maskCodec";
import { maskToEditorPolygons, runsOfMask, runsOfPolygons } from "./maskGeometry";
import { polygonViolation, toContractPolygon } from "./polygonContract";
import { frameInstanceKey } from "./service";

const SIZE = 64;

/** Mask from a predicate over pixels (column-major runs, as the codec stores them). */
function maskOf(inside: (x: number, y: number) => boolean): MaskRuns {
  const intervals: number[] = [];
  for (let x = 0; x < SIZE; x++) {
    let start = -1;
    for (let y = 0; y <= SIZE; y++) {
      const on = y < SIZE && inside(x, y);
      if (on && start < 0) {
        start = y;
      } else if (!on && start >= 0) {
        intervals.push(x * SIZE + start, x * SIZE + y);
        start = -1;
      }
    }
  }
  return runsFromIntervals(Uint32Array.from(intervals), SIZE, SIZE);
}

function pixelsOf(runs: MaskRuns): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < runs.intervals.length; i += 2) {
    for (let p = runs.intervals[i]!; p < runs.intervals[i + 1]!; p++) {
      out.add(p);
    }
  }
  return out;
}

/** Editor polygons in wire (pixel) coordinates, the way liveService sends them. */
function wireRings(runs: MaskRuns) {
  const mask = { counts: countsFromRuns(runs), width: SIZE, height: SIZE };
  return maskToEditorPolygons(mask, "/camera").map((polygon) =>
    polygon.points.map((point) => ({ x: point.x * SIZE, y: point.y * SIZE })),
  );
}

/** Each case: the mask, and pixels that must stay empty (hole centres). */
const CASES: Record<string, [(x: number, y: number) => boolean, [number, number][]]> = {
  "a square with a hole": [
    (x, y) => x >= 10 && x < 40 && y >= 10 && y < 40 && !(x >= 20 && x < 30 && y >= 20 && y < 30),
    [[25, 25]],
  ],
  "a ring with two holes": [
    (x, y) =>
      x >= 5 &&
      x < 60 &&
      y >= 10 &&
      y < 40 &&
      !(x >= 10 && x < 20 && y >= 15 && y < 30) &&
      !(x >= 35 && x < 50 && y >= 20 && y < 35),
    [
      [15, 22],
      [42, 27],
    ],
  ],
  "two squares touching at a corner": [
    (x, y) => (x >= 5 && x < 20 && y >= 5 && y < 20) || (x >= 20 && x < 35 && y >= 20 && y < 35),
    [],
  ],
  "a square with a one-pixel tail": [
    (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30) || (y === 20 && x >= 30 && x < 45),
    [],
  ],
  // A hole too small to survive simplification fills, as OpenCV's approxPolyDP does.
  "a one-pixel hole": [
    (x, y) => x >= 10 && x < 20 && y >= 10 && y < 20 && !(x === 15 && y === 15),
    [],
  ],
  "nested ring with an island": [
    (x, y) => {
      const outer =
        x >= 5 && x < 55 && y >= 5 && y < 55 && !(x >= 15 && x < 45 && y >= 15 && y < 45);
      const island = x >= 25 && x < 35 && y >= 25 && y < 35;
      return outer || island;
    },
    [
      [20, 20],
      [40, 40],
    ],
  ],
};

describe("mask → editor polygons satisfy the AnnotationGeometry contract", () => {
  for (const [name, [inside, empty]] of Object.entries(CASES)) {
    it(`${name}: every polygon is valid and the union is the mask`, () => {
      const runs = maskOf(inside);
      const rings = wireRings(runs);
      expect(rings.length).toBeGreaterThan(0);
      for (const ring of rings) {
        expect(polygonViolation(ring)).toBeUndefined();
      }
      // Rasterized back (union of polygons, outline included), holes stay holes.
      const mask = { counts: countsFromRuns(runs), width: SIZE, height: SIZE };
      const back = pixelsOf(runsOfPolygons(maskToEditorPolygons(mask, undefined), SIZE, SIZE));
      const original = pixelsOf(runsOfMask(mask));
      let missing = 0;
      for (const p of original) {
        if (!back.has(p)) {
          missing++;
        }
      }
      let extra = 0;
      for (const p of back) {
        if (!original.has(p)) {
          extra++;
        }
      }
      // eps=1 simplification (as approxPolyDP) and dropped one-pixel filaments move a few edge pixels.
      expect(missing + extra).toBeLessThanOrEqual(original.size * 0.06 + 16);
      for (const [x, y] of empty) {
        expect(back.has(x * SIZE + y)).toBe(false);
      }
    });
  }
});

describe("random masks", () => {
  it("noisy blobs with holes, pinches and filaments always convert to valid polygons", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 40; trial++) {
      const density = 0.35 + random() * 0.4;
      const grid = Array.from({ length: SIZE * SIZE }, () => random() < density);
      const rings = wireRings(maskOf((x, y) => grid[y * SIZE + x]!));
      for (const ring of rings) {
        expect(polygonViolation(ring)).toBeUndefined();
      }
    }
  });
});

describe("polygonViolation mirrors the server", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it("accepts a simple polygon, also with a straight-through vertex", () => {
    expect(polygonViolation(square)).toBeUndefined();
    expect(
      polygonViolation([...square.slice(0, 1), { x: 5, y: 0 }, ...square.slice(1)]),
    ).toBeUndefined();
  });
  it("rejects what AnnotationGeometry rejects", () => {
    expect(polygonViolation(square.slice(0, 2))).toBe("Polygon requires at least three vertices");
    expect(polygonViolation([...square, { x: 10, y: 0 }])).toBe("Duplicate polygon vertex");
    expect(
      polygonViolation([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe("Polygon vertices must not be collinear");
    expect(
      polygonViolation([
        { x: 10, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 5, y: 0 },
      ]),
    ).toBe("Polygon edges must not backtrack");
    expect(
      polygonViolation([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 20 },
      ]),
    ).toBe("Polygon must not self-intersect");
    expect(polygonViolation([{ x: -1, y: 0 }, ...square.slice(1)])).toBe(
      "Polygon coordinates must be finite and nonnegative",
    );
  });
});

describe("toContractPolygon", () => {
  const size = { width: 100, height: 50 };

  it("scales, drops a repeated vertex and passes a valid outline", () => {
    const result = toContractPolygon(
      [
        { x: 0.1, y: 0.2 },
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.2 },
        { x: 0.5, y: 0.6 },
      ],
      size,
    );
    expect(result).toEqual({
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 30 },
      ],
      clamped: false,
      violation: undefined,
    });
  });

  it("says when clamping into the frame created the violation", () => {
    // Two non-adjacent vertices outside the same corner both land on (100, 50).
    const result = toContractPolygon(
      [
        { x: 0.5, y: 0.5 },
        { x: 1.2, y: 1.1 },
        { x: 0.6, y: 0.9 },
        { x: 1.5, y: 1.3 },
      ],
      size,
    );
    expect(result.clamped).toBe(true);
    expect(result.violation).toBe("Duplicate polygon vertex");
  });

  it("rejects non-finite coordinates", () => {
    expect(() =>
      toContractPolygon(
        [
          { x: Number.NaN, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        size,
      ),
    ).toThrow(/finite/);
  });

  it("keeps a seed polygon with a vertex outside the frame, as a save would clamp it", () => {
    const scope = buildCanvasPropagationScope(
      {
        frames: [
          { id: "f", videoId: "v", index: 0, timestampSec: 0, logTimeNs: "0", imageUrl: "" },
        ],
        instances: [{ id: "i", classId: "c", name: "i" }],
        annotations: {
          [frameInstanceKey("f", "i")]: {
            frameId: "f",
            instanceId: "i",
            kind: "polygons",
            polygons: [
              {
                id: "p",
                points: [
                  { x: 0.5, y: 0.5 },
                  { x: 1.1, y: 0.5 },
                  { x: 0.5, y: 0.9 },
                ],
              },
            ],
          },
        },
      },
      "f",
    );
    expect(scope?.seeds).toHaveLength(1);
  });
});
