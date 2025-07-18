// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Point, Rotation } from "./types";

type vec3 = [number, number, number];

/*
 * Dot-product of two vectors.
 */
export function dot(vec1: number[], vec2: number[]): number {
  let ret = 0.0;
  for (let i = 0; i < vec1.length && i < vec2.length; ++i) {
    ret += vec1[i]! * vec2[i]!;
  }
  return ret;
}

/*
 * Cross-product of two vectors.
 */
export function cross(vec1: vec3, vec2: vec3): vec3 {
  const [ax, ay, az] = vec1;
  const [bx, by, bz] = vec2;
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/*
 * Performs a rotation transformation on a point.
 */
export function rotate(rotation: Rotation, point: Point): Point {
  const v: vec3 = [point.x, point.y, point.z];

  // Extract the vector part of the quaternion
  const u: vec3 = [rotation.x, rotation.y, rotation.z];

  // Extract the scalar part of the quaternion
  const s = -1 * rotation.w;

  // Do the math
  const t1 = scalarMultiply(u, 2.0 * dot(u, v));
  const t2 = scalarMultiply(v, s * s - dot(u, u));
  const t3 = scalarMultiply(cross(u, v), 2 * s);
  const d = vectorAddition([t1, t2, t3]);

  return {
    x: d[0]!,
    y: d[1]!,
    z: d[2]!,
  };
}

/*
 * Scales a vector.
 */
export function scalarMultiply(vector: number[], scalar: number): number[] {
  const ret = vector.slice();
  let i;
  for (i = 0; i < ret.length; ++i) {
    ret[i] *= scalar;
  }
  return ret;
}

/*
 * Sums an array of vectors.
 * NOTE: all the vector arrays must be at least the length of the first vector
 */
export function vectorAddition(vectors: number[][]): number[] {
  const first = vectors[0];
  if (!first) {
    throw new Error("vectorAddition requires vectors");
  }

  const ret = first.slice();
  for (let i = 1; i < vectors.length; ++i) {
    for (let j = 0; j < ret.length; ++j) {
      ret[j] += vectors[i]![j]!;
    }
  }
  return ret;
}
