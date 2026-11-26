// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { vectorAddition, dot, cross, rotateVector, rotateLegacy } from "./vectors";

describe("vectors", () => {
  it("dot", () => {
    expect(dot([2, 4], [1, 2, 3, 4])).toEqual(10);
  });
  it("cross", () => {
    expect(cross([1, 2, 3], [3, 2, 1])).toEqual([-4, 8, -4]);
  });
  it("vectorAddition", () => {
    expect(
      vectorAddition([
        [1, 1, 1],
        [1, 1, 1],
      ]),
    ).toEqual([2, 2, 2]);
  });
  it("distinguishes forward and historical rotations", () => {
    const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    expect(rotateVector(q, { x: 1, y: 0, z: 0 }).y).toBeCloseTo(1);
    expect(rotateLegacy(q, { x: 1, y: 0, z: 0 }).y).toBeCloseTo(-1);
  });
  it("preserves historical non-unit quaternion results", () => {
    expect(rotateLegacy({ x: 1, y: 1, z: 1, w: 1 }, { x: 1, y: 1, z: 1 })).toEqual({
      x: 4,
      y: 4,
      z: 4,
    });
  });
});
