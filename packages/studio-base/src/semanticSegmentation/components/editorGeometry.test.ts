// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  hasPolygonArea,
  nearestPolygonEdge,
  polygonPath,
  screenToNormalized,
  translatePolygon,
} from "./editorGeometry";

describe("editor coordinate transforms", () => {
  it("inverts zoom, pan and letterboxing without rounding normalized coordinates", () => {
    expect(
      screenToNormalized(
        { x: 310.5, y: 195.25 },
        { a: 2, b: 0, c: 0, d: 2, e: 110, f: 95 },
        400,
        200,
      ),
    ).toEqual({ x: 0.250625, y: 0.250625 });
  });
  it("uses each frame's own resolution", () => {
    expect(
      screenToNormalized(
        { x: 512, y: 256 },
        { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 },
        2048,
        1024,
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
  });
  it("rejects unavailable and singular transforms", () => {
    expect(
      screenToNormalized({ x: 1, y: 1 }, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 10, 10),
    ).toBeUndefined();
    expect(
      screenToNormalized({ x: 1, y: 1 }, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 0, 10),
    ).toBeUndefined();
  });
  it("constrains whole polygon translation without distorting the shape", () => {
    const points = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.4 },
      { x: 0.6, y: 0.9 },
    ];
    expect(translatePolygon(points, { x: 0.9, y: -0.8 })).toEqual([
      { x: 0.39999999999999997, y: 0 },
      { x: 1, y: 0.10000000000000003 },
      { x: 0.7999999999999999, y: 0.6000000000000001 },
    ]);
    expect(points[0]).toEqual({ x: 0.2, y: 0.3 });
  });
  it("preserves float precision in paths and supports empty drafts", () => {
    expect(polygonPath([], 100, 100)).toBe("");
    expect(polygonPath([{ x: 0.125, y: 0.375 }], 200, 80)).toBe("M25,30 Z");
  });
});

describe("polygon edge insertion", () => {
  const points = [
    { x: 0.1, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const matrix = { a: 2, b: 0, c: 0, d: 2, e: 110, f: 95 };
  it("includes the closing edge and projects onto it in original image coordinates", () => {
    const hit = nearestPolygonEdge({ x: 194, y: 295 }, points, matrix, 400, 200);
    expect(hit?.after).toBe(3);
    expect(hit?.point.x).toBeCloseTo(0.1);
    expect(hit?.point.y).toBeCloseTo(0.5);
  });
  it("uses a screen-pixel tolerance and ignores interiors, endpoints and degenerate edges", () => {
    expect(nearestPolygonEdge({ x: 199, y: 295 }, points, matrix, 400, 200)).toBeUndefined();
    expect(nearestPolygonEdge({ x: 470, y: 295 }, points, matrix, 400, 200)).toBeUndefined();
    expect(nearestPolygonEdge({ x: 190, y: 135 }, points, matrix, 400, 200)).toBeUndefined();
    expect(
      nearestPolygonEdge({ x: 190, y: 135 }, [points[0]!, points[0]!], matrix, 400, 200),
    ).toBeUndefined();
    expect(nearestPolygonEdge({ x: 190, y: 135 }, [], matrix, 400, 200)).toBeUndefined();
  });
});

it("rejects repeated and collinear drawing vertices", () => {
  expect(
    hasPolygonArea([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]),
  ).toBe(false);
  expect(
    hasPolygonArea([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]),
  ).toBe(false);
  expect(
    hasPolygonArea([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
    ]),
  ).toBe(true);
});

it("rejects nonfinite pointer coordinates", () => {
  expect(
    screenToNormalized({ x: Number.NaN, y: 1 }, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 10, 10),
  ).toBeUndefined();
});
