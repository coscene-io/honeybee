// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { countsFromRuns, runsOfBitmap } from "./maskCodec";
import {
  ByteLru,
  clearMaskGeometryCaches,
  maskConversionLoss,
  maskGeometryCacheBytes,
  maskToEditorPolygons,
} from "./maskGeometry";
import * as maskPolygon from "./maskPolygon";
import type { SegmentationMask } from "./types";

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

beforeEach(() => {
  clearMaskGeometryCaches();
  jest.mocked(maskPolygon.maskToSimplePolygons).mockClear();
});

describe("mask geometry caches", () => {
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
