// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FieldReader, getReader } from "./readers";
import { Point, Header, RGBA } from "./types";

interface sensor_msgs__PointField {
  name: string;
  offset: number;
  datatype: number;
  count: number;
}

export interface sensor_msgs__PointCloud2 {
  header: Header;
  height: number;
  width: number;
  fields: sensor_msgs__PointField[];
  is_bigendian: boolean;
  point_step: number;
  row_step: number;
  data: Uint8Array;
  is_dense: boolean;
}

type Reader = { datatype: number; offset: number; reader: FieldReader };

function getFieldOffsetsAndReaders(fields: sensor_msgs__PointField[]): Reader[] {
  const result: Reader[] = [];
  for (const { datatype, offset = 0 } of fields) {
    result.push({ datatype, offset, reader: getReader(datatype, offset) });
  }
  return result;
}

type Field = number | string;

/**
 * Read points from a sensor_msgs.PointCloud2 message. Returns a nested array
 * of values whose index corresponds to that of the 'fields' value.
 */
export const readPoints = (message: sensor_msgs__PointCloud2): Array<Field[]> => {
  const { fields, height, point_step, row_step, width, data } = message;
  const readers = getFieldOffsetsAndReaders(fields);

  const points: Array<Field[]> = [];
  for (let i = 0; i < height; i++) {
    const dataOffset = i * row_step;
    for (let j = 0; j < width; j++) {
      const row: Field[] = [];
      const dataStart = j * point_step + dataOffset;
      for (const reader of readers) {
        const value = reader.reader.read(data, dataStart);
        row.push(value);
      }
      points.push(row);
    }
  }
  return points;
};

export function norm({ x, y, z }: Point): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function setRayDistance(pt: Point, distance: number): Point {
  const { x, y, z } = pt;
  const scale = distance / norm(pt);
  return {
    x: x * scale,
    y: y * scale,
    z: z * scale,
  };
}

// eslint-disable-next-line @foxglove/no-boolean-parameters
export function convertToRangeView(points: Point[], range: number, makeColors: boolean): RGBA[] {
  const colors: RGBA[] = makeColors ? new Array(points.length) : [];
  // First pass to get min and max ranges
  let maxRange = Number.MIN_VALUE;
  if (makeColors) {
    for (const point of points) {
      maxRange = Math.max(maxRange, norm(point));
    }
  }
  // actually move the points and generate colors if specified
  for (let i = 0; i < points.length; ++i) {
    const pt = points[i]!;
    if (makeColors) {
      const dist = norm(pt);
      if (dist <= range) {
        // don't go all the way to white
        const extent = 0.8;
        // closest to target range is lightest,
        // closest to AV is darkest
        const other = (extent * dist) / range;
        colors[i] = { r: 1, g: other, b: other, a: 1 };
      } else {
        // don't go all the way to white
        const extent = 0.8;
        // closest to target range is lightest,
        // closest to max range is darkest
        const upper = maxRange - range;
        const other = extent * (1.0 - dist / upper);
        colors[i] = { r: other, g: other, b: 1, a: 1 };
      }
    }
    points[i] = setRayDistance(pt, range);
  }
  return colors;
}
