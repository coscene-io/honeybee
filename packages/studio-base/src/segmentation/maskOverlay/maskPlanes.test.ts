// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { maskContains, maskRunsFromCounts } from "../maskCodec";
import { buildMaskPlanes, planeBytes, planeFormat } from "./maskPlanes";
import maskFixture from "../testing/fixtures/masks.json";

describe("mask bit planes", () => {
  it("stores every slot as one bit of a transposed texel, overlaps included", () => {
    const cases = maskFixture.cases.slice(0, 10);
    const planes = buildMaskPlanes(
      1280,
      720,
      cases.map((item) => item.counts),
    );
    expect(planes.format).toBe("R16UI");
    expect(planes.areas).toEqual(cases.map((item) => item.area));
    const plane = planes.planes[0]!;
    cases.forEach((item, slot) => {
      const runs = maskRunsFromCounts(item.counts, 1280, 720);
      // Sample pixels inside and outside the bbox; the texel at x * height + y is pixel (x, y).
      for (let k = 0; k < 200; k++) {
        const x = (k * 97 + slot * 13) % 1280;
        const y = (k * 61 + slot * 7) % 720;
        expect(((plane[x * 720 + y]! >> slot) & 1) === 1).toBe(maskContains(runs, x, y));
      }
      const box = runs.bbox!;
      const cx = Math.floor((box.x0 + box.x1) / 2);
      for (let y = box.y0; y <= box.y1; y++) {
        expect(((plane[cx * 720 + y]! >> slot) & 1) === 1).toBe(maskContains(runs, cx, y));
      }
    });
  });

  it("chooses the narrowest integer format and rejects a wrong size", () => {
    expect([1, 8, 9, 16, 17, 32, 33, 64].map(planeFormat)).toEqual([
      "R8UI",
      "R8UI",
      "R16UI",
      "R16UI",
      "R32UI",
      "R32UI",
      "R32UI",
      "R32UI",
    ]);
    expect(planeBytes(1280, 720, 3)).toBe(1280 * 720);
    expect(planeBytes(1280, 720, 40)).toBe(1280 * 720 * 8);
    expect(() => buildMaskPlanes(640, 360, [maskFixture.cases[0]!.counts])).toThrow(/640×360/);
    const many = buildMaskPlanes(
      1280,
      720,
      Array.from({ length: 40 }, (_, i) => maskFixture.cases[i % 18]!.counts),
    );
    expect(many.planes).toHaveLength(2);
    expect(many.areas[39]).toBe(maskFixture.cases[39 % 18]!.area);
  });
});
