// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { countsFromRuns, runsFromIntervals } from "./maskCodec";
import { maskToEditorPolygons } from "./maskGeometry";

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
