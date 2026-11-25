// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getReader as getRenderReader } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/pointClouds/fieldReaders";

import {
  sensor_msgs__PointCloud2,
  readPoints,
  norm,
  setRayDistance,
  convertToRangeView,
} from "./pointClouds"; // Adjust the import path as needed
import { Point } from "./types"; // Adjust the import path as needed

describe("readPoints", () => {
  it.each([true, false])(
    "reads signed, unsigned and double fields in sliced buffers (big endian %p)",
    (bigEndian) => {
      const data = new Uint8Array(40).subarray(3);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (const base of [0, 16]) {
        view.setInt8(base, -3);
        view.setUint32(base + 1, 4_000_000_000, !bigEndian);
        view.setFloat64(base + 5, base + 1.5, !bigEndian);
      }
      const message: sensor_msgs__PointCloud2 = {
        header: { frame_id: "", stamp: { sec: 0, nsec: 0 }, seq: 0 },
        height: 2,
        width: 1,
        point_step: 13,
        row_step: 16,
        is_dense: true,
        is_bigendian: bigEndian,
        data,
        fields: [
          { name: "i", offset: 0, datatype: 1, count: 1 },
          { name: "u", offset: 1, datatype: 6, count: 1 },
          { name: "f", offset: 5, datatype: 8, count: 1 },
        ],
      };
      expect(readPoints(message)).toEqual([
        [-3, 4_000_000_000, 1.5],
        [-3, 4_000_000_000, 17.5],
      ]);
      if (!bigEndian) {
        const renderValues = [0, message.row_step].map((base) =>
          message.fields.map((field) => getRenderReader(field, message.point_step)!(view, base)),
        );
        expect(readPoints(message)).toEqual(renderValues);
      }
      expect(() => readPoints({ ...message, data: data.subarray(0, 28) })).toThrow(
        "not enough data",
      );
    },
  );
});

describe("norm", () => {
  it("should return the correct norm of a point", () => {
    const point: Point = { x: 3, y: 4, z: 12 };
    const result = norm(point);
    expect(result).toBe(13);
  });
});

describe("setRayDistance", () => {
  it("should set the correct distance for a point", () => {
    const point: Point = { x: 3, y: 4, z: 0 };
    const distance = 10;
    const result = setRayDistance(point, distance);
    expect(result).toEqual({ x: 6, y: 8, z: 0 });
  });
});

describe("convertToRangeView", () => {
  it("should convert points to range view and create colors if specified", () => {
    const points: Point[] = [
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
    ];
    const range = 5;
    const makeColors = true;
    const colors = convertToRangeView(points, range, makeColors);
    expect(colors).toHaveLength(points.length);
    expect(points[0]).toEqual(setRayDistance({ x: 1, y: 1, z: 1 }, range));
  });

  it("should convert points to range view without creating colors", () => {
    const points: Point[] = [
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
    ];
    const range = 5;
    const makeColors = false;
    const colors = convertToRangeView(points, range, makeColors);
    expect(colors).toHaveLength(0);
    expect(points[0]).toEqual(setRayDistance({ x: 1, y: 1, z: 1 }, range));
  });
});
