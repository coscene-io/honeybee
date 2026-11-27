// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { segmentationText, type SegmentationTextCode } from "./errors";

/**
 * The only client-side copy of the annotation contract's polygon rules; every path that sends a
 * polygon (save, propagation seeds) goes through `toContractPolygon`. Keep it in step with the
 * server: if the server changes a rule, a save fails with INVALID_ARGUMENT instead of the named
 * message here, so drift shows up as a worse error, not as stored bad data.
 *
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

const VIOLATION_TEXT: Record<PolygonViolation, SegmentationTextCode> = {
  "Polygon exceeds 1024 vertices": "violationTooManyVertices",
  "Polygon requires at least three vertices": "violationFewVertices",
  "Polygon coordinates must be finite and nonnegative": "violationOutsideFrame",
  "Duplicate polygon vertex": "violationDuplicateVertex",
  "Polygon vertices must not be collinear": "violationCollinear",
  "Polygon edges must not backtrack": "violationBacktrack",
  "Polygon must not self-intersect": "violationSelfIntersect",
};

/** The violation in the active language (the server's own text is the `violation` itself). */
export function describeViolation(violation: PolygonViolation): string {
  return segmentationText(VIOLATION_TEXT[violation], { max: MAX_POLYGON_VERTICES });
}

/**
 * Normalized editor vertices as contract pixels: scaled to the source size, clamped into the frame,
 * with consecutive repeats dropped (a vertex clicked twice is the same outline). `clamped` says a
 * vertex lay outside the frame, which can create a violation the editor does not show.
 */
export function toContractPolygon(
  normalized: readonly ContractPoint[],
  size: { width: number; height: number },
): { points: ContractPoint[]; clamped: boolean; violation: PolygonViolation | undefined } {
  let clamped = false;
  const clamp = (value: number, max: number) => {
    const inside = Math.min(Math.max(value, 0), max);
    clamped ||= inside !== value;
    return inside;
  };
  const scaled = normalized.map((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("Annotation coordinate must be finite");
    }
    return {
      x: clamp(point.x * size.width, size.width),
      y: clamp(point.y * size.height, size.height),
    };
  });
  const points = scaled.filter((point, i, all) => {
    const next = all[(i + 1) % all.length]!;
    return all.length === 1 || point.x !== next.x || point.y !== next.y;
  });
  return { points, clamped, violation: polygonViolation(points) };
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
