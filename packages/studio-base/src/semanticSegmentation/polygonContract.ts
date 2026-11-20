// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * The polygon rules of the annotation contract (cosceneapis `resources/annotation.proto`: at least
 * three distinct, non-collinear vertices, no self-intersection), checked exactly as the server's
 * `AnnotationGeometry.validatePolygon` does, so a bad polygon is reported before any request
 * instead of failing a save or a propagation with INVALID_ARGUMENT.
 */

export type ContractPoint = { x: number; y: number };

export const MAX_POLYGON_VERTICES = 1024;

/** The server's message for the first rule the polygon breaks, or undefined when it is valid. */
export type PolygonViolation =
  | "Polygon exceeds 1024 vertices"
  | "Polygon requires at least three vertices"
  | "Polygon coordinates must be finite and nonnegative"
  | "Duplicate polygon vertex"
  | "Polygon vertices must not be collinear"
  | "Polygon edges must not backtrack"
  | "Polygon must not self-intersect";

const VIOLATION_TEXT: Record<PolygonViolation, string> = {
  "Polygon exceeds 1024 vertices": `顶点超过 ${MAX_POLYGON_VERTICES} 个`,
  "Polygon requires at least three vertices": "顶点少于 3 个",
  "Polygon coordinates must be finite and nonnegative": "坐标超出画面",
  "Duplicate polygon vertex": "有重复的顶点",
  "Polygon vertices must not be collinear": "所有顶点在一条直线上",
  "Polygon edges must not backtrack": "有折回的边（尖刺）",
  "Polygon must not self-intersect": "边自相交",
};

export function describeViolation(violation: PolygonViolation): string {
  return VIOLATION_TEXT[violation];
}

function cross(a: ContractPoint, b: ContractPoint, c: ContractPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: ContractPoint, b: ContractPoint, p: ContractPoint): boolean {
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

function intersects(
  a: ContractPoint,
  b: ContractPoint,
  c: ContractPoint,
  d: ContractPoint,
): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b)) ||
    (Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB))
  );
}

/** A line-by-line mirror of data-platform-server `AnnotationGeometry.validatePolygon`. */
export function polygonViolation(points: readonly ContractPoint[]): PolygonViolation | undefined {
  const n = points.length;
  if (n > MAX_POLYGON_VERTICES) {
    return "Polygon exceeds 1024 vertices";
  }
  if (n < 3) {
    return "Polygon requires at least three vertices";
  }
  const distinct = new Set<string>();
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0) {
      return "Polygon coordinates must be finite and nonnegative";
    }
    // Java's `x + ":" + y` keeps -0.0 and 0.0 apart; Object.is does too.
    const key = `${Object.is(p.x, -0) ? "-0" : p.x}:${Object.is(p.y, -0) ? "-0" : p.y}`;
    if (distinct.has(key)) {
      return "Duplicate polygon vertex";
    }
    distinct.add(key);
    area += p.x * q.y - q.x * p.y;
  }
  if (area === 0) {
    return "Polygon vertices must not be collinear";
  }
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const previous = points[(i + n - 1) % n]!;
    const adjacentDot = (previous.x - a.x) * (b.x - a.x) + (previous.y - a.y) * (b.y - a.y);
    if (cross(previous, a, b) === 0 && adjacentDot >= 0) {
      return "Polygon edges must not backtrack";
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) {
        continue;
      }
      if (intersects(a, b, points[j]!, points[(j + 1) % n]!)) {
        return "Polygon must not self-intersect";
      }
    }
  }
  return undefined;
}
