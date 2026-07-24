// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  appendCollapsedStateSample,
  processCacheFingerprint,
  sliceMergedStateDataForViewport,
  sliceStateDataForViewport,
} from "./stateTransitionData";
import { Datum } from "./types";

function d(x: number, value: number | string): Datum {
  return {
    x,
    y: 0,
    value,
    label: String(value),
    labelColor: "#fff",
  };
}

/**
 * The pre-REI-125 path: materialize the merge, then window it. Kept here as the reference
 * oracle that `sliceMergedStateDataForViewport` must match exactly.
 */
function legacyMergeThenSlice(
  fullData: Datum[],
  currentData: Datum[],
  minX: number,
  maxX: number,
): Datum[] {
  let merged: Datum[];
  if (currentData.length === 0) {
    merged = fullData;
  } else if (fullData.length === 0) {
    merged = currentData;
  } else {
    const lastFullX = fullData[fullData.length - 1]?.x ?? -Infinity;
    merged = [...fullData, ...currentData.filter((datum) => datum.x > lastFullX)];
  }
  return sliceStateDataForViewport(merged, minX, maxX);
}

describe("appendCollapsedStateSample", () => {
  it("keeps every sample when values always change", () => {
    const data: Datum[] = [];
    appendCollapsedStateSample(data, d(0, 1));
    appendCollapsedStateSample(data, d(1, 2));
    appendCollapsedStateSample(data, d(2, 3));
    expect(data.map((p) => [p.x, p.value])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("collapses a long plateau to start + trailing endpoint", () => {
    const data: Datum[] = [];
    for (let i = 0; i < 1000; i++) {
      appendCollapsedStateSample(data, d(i * 0.01, "open"));
    }
    expect(data).toHaveLength(2);
    expect(data[0]!.x).toBe(0);
    expect(data[1]!.x).toBeCloseTo(9.99);
    expect(data[0]!.value).toBe("open");
    expect(data[1]!.value).toBe("open");
  });

  it("preserves segment boundaries across value changes", () => {
    const data: Datum[] = [];
    appendCollapsedStateSample(data, d(0, "a"));
    appendCollapsedStateSample(data, d(1, "a"));
    appendCollapsedStateSample(data, d(2, "a"));
    appendCollapsedStateSample(data, d(3, "b"));
    appendCollapsedStateSample(data, d(4, "b"));
    appendCollapsedStateSample(data, d(5, "a"));

    expect(data.map((p) => [p.x, p.value])).toEqual([
      [0, "a"],
      [2, "a"],
      [3, "b"],
      [4, "b"],
      [5, "a"],
    ]);
  });

  it("benchmark: collapsing 20k plateau samples stays near O(n) and tiny storage", () => {
    const N = 20_000;
    const data: Datum[] = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      // Mostly plateau with rare flips — similar to discrete gripper open/close.
      const value = i > 0 && i % 5000 === 0 ? `s${i}` : "stable";
      appendCollapsedStateSample(data, d(i / 250, value));
    }
    const elapsedMs = performance.now() - t0;

    // 4 stable plateaus × 2 endpoints + transitions ≈ small.
    expect(data.length).toBeLessThan(20);
    // Generous CI bound; local is typically < 20ms.
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("sliceStateDataForViewport", () => {
  const data = [d(0, "a"), d(10, "b"), d(20, "c"), d(30, "d"), d(40, "e")];

  it("includes the last point at or before minX for continuity", () => {
    const sliced = sliceStateDataForViewport(data, 15, 35);
    expect(sliced.map((p) => p.x)).toEqual([10, 20, 30, 40]);
  });

  it("includes the endpoint after a viewport enclosed by a collapsed plateau", () => {
    const plateau = [d(0, "stable"), d(100, "stable")];
    expect(sliceStateDataForViewport(plateau, 40, 50).map((p) => p.x)).toEqual([0, 100]);
  });

  it("returns empty for empty input", () => {
    expect(sliceStateDataForViewport([], 0, 1)).toEqual([]);
  });

  it("returns all data when window covers full range", () => {
    expect(sliceStateDataForViewport(data, -1, 100).map((p) => p.x)).toEqual([0, 10, 20, 30, 40]);
  });

  it("handles a window before the first sample", () => {
    expect(sliceStateDataForViewport(data, -10, -1)).toEqual([]);
  });

  it("handles a window after the last sample by keeping last point before min", () => {
    const sliced = sliceStateDataForViewport(data, 50, 60);
    // startIdx points at last element (x=40 <= 50), endIdx same after search → single continuity point
    expect(sliced.map((p) => p.x)).toEqual([40]);
  });

  it("benchmark: slicing 50k sorted samples is fast", () => {
    const big: Datum[] = [];
    for (let i = 0; i < 50_000; i++) {
      big.push(d(i / 100, i));
    }
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      sliceStateDataForViewport(big, 100, 130);
    }
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("processCacheFingerprint", () => {
  it("changes when plateau endpoint advances without length change", () => {
    const data: Datum[] = [];
    appendCollapsedStateSample(data, d(0, "open"));
    appendCollapsedStateSample(data, d(1, "open"));
    expect(data).toHaveLength(2);

    const before = processCacheFingerprint(data, /*y*/ 0, /*viewMin*/ 0, /*viewMax*/ 10);
    appendCollapsedStateSample(data, d(5, "open"));
    expect(data).toHaveLength(2); // endpoint mutation only
    expect(data[1]!.x).toBe(5);

    const after = processCacheFingerprint(data, 0, 0, 10);
    expect(after).not.toEqual(before);
  });

  it("changes when viewport bounds change", () => {
    const data = [d(0, "a"), d(1, "b")];
    const a = processCacheFingerprint(data, 0, 0, 10);
    const b = processCacheFingerprint(data, 0, 5, 15);
    expect(a).not.toEqual(b);
  });

  it("is stable for identical inputs", () => {
    const data = [d(0, "a"), d(2, "a")];
    expect(processCacheFingerprint(data, 1, 0, 3)).toEqual(processCacheFingerprint(data, 1, 0, 3));
  });
});

describe("sliceMergedStateDataForViewport", () => {
  const full = [d(0, "a"), d(10, "b"), d(20, "c"), d(30, "d")];
  const current = [d(25, "stale"), d(30, "dup"), d(40, "e"), d(50, "f")];

  it("drops currentData samples not newer than the last fullData sample", () => {
    const sliced = sliceMergedStateDataForViewport(full, current, -1, 100);
    expect(sliced.map((p) => p.x)).toEqual([0, 10, 20, 30, 40, 50]);
    // x=30 comes from fullData, not the currentData duplicate.
    expect(sliced[3]!.value).toBe("d");
  });

  it("windows across the fullData/currentData boundary", () => {
    const sliced = sliceMergedStateDataForViewport(full, current, 28, 45);
    // Keeps both the last point before minX and the first point after maxX for line continuity.
    expect(sliced.map((p) => p.x)).toEqual([20, 30, 40, 50]);
  });

  it("windows entirely inside currentData", () => {
    const sliced = sliceMergedStateDataForViewport(full, current, 45, 60);
    expect(sliced.map((p) => p.x)).toEqual([40, 50]);
  });

  it("windows entirely inside fullData", () => {
    const sliced = sliceMergedStateDataForViewport(full, current, 5, 15);
    expect(sliced.map((p) => p.x)).toEqual([0, 10, 20]);
  });

  it("keeps both endpoints when a collapsed plateau surrounds the viewport", () => {
    const plateau = [d(0, "stable"), d(100, "stable")];
    expect(sliceMergedStateDataForViewport(plateau, [], 40, 50).map((p) => p.x)).toEqual([0, 100]);
  });

  it("handles empty inputs", () => {
    expect(sliceMergedStateDataForViewport([], [], 0, 10)).toEqual([]);
    expect(sliceMergedStateDataForViewport([], current, 0, 100).map((p) => p.x)).toEqual([
      25, 30, 40, 50,
    ]);
    expect(sliceMergedStateDataForViewport(full, [], 0, 100).map((p) => p.x)).toEqual([
      0, 10, 20, 30,
    ]);
  });

  it("returns only the continuity point when the window is past the end", () => {
    expect(sliceMergedStateDataForViewport(full, current, 80, 90).map((p) => p.x)).toEqual([50]);
  });

  it("returns empty when the window is before the first sample", () => {
    expect(sliceMergedStateDataForViewport(full, current, -20, -10)).toEqual([]);
  });

  it("matches the legacy merge-then-slice result across randomized inputs", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let trial = 0; trial < 200; trial++) {
      const fullLen = Math.floor(rand() * 12);
      const currentLen = Math.floor(rand() * 12);

      const fullData: Datum[] = [];
      let x = 0;
      for (let i = 0; i < fullLen; i++) {
        x += Math.floor(rand() * 5);
        fullData.push(d(x, `f${i}`));
      }
      // currentData overlaps fullData's tail so the "newer than lastFullX" filter is exercised.
      const currentData: Datum[] = [];
      let cx = Math.max(0, x - Math.floor(rand() * 8));
      for (let i = 0; i < currentLen; i++) {
        cx += Math.floor(rand() * 5);
        currentData.push(d(cx, `c${i}`));
      }

      const minX = Math.floor(rand() * 40) - 5;
      const maxX = minX + Math.floor(rand() * 30);

      expect(sliceMergedStateDataForViewport(fullData, currentData, minX, maxX)).toEqual(
        legacyMergeThenSlice(fullData, currentData, minX, maxX),
      );
    }
  });

  it("benchmark: does not copy full history — 200 windowed merges of 50k+5k samples", () => {
    const bigFull: Datum[] = [];
    for (let i = 0; i < 50_000; i++) {
      bigFull.push(d(i / 100, i));
    }
    const bigCurrent: Datum[] = [];
    for (let i = 0; i < 5_000; i++) {
      bigCurrent.push(d(500 + i / 100, i));
    }

    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      sliceMergedStateDataForViewport(bigFull, bigCurrent, 100, 130);
    }
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(500);
  });
});
