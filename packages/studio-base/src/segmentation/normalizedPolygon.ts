// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { NormalizedPoint } from "./types";

/**
 * Why a polygon in normalized image coordinates is not a complete one: a coordinate outside
 * [0, 1] (or not finite), fewer than three vertices, or no enclosed area. The server's own,
 * pixel-space rules are in `polygonContract.ts`.
 */
export type NormalizedPolygonProblem = "coordinates" | "vertices" | "area";

export function normalizedPolygonProblem(
  points: readonly NormalizedPoint[],
): NormalizedPolygonProblem | undefined {
  if (
    points.some(
      ({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1,
    )
  ) {
    return "coordinates";
  }
  if (points.length < 3) {
    return "vertices";
  }
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(area) <= 1e-12 ? "area" : undefined;
}
