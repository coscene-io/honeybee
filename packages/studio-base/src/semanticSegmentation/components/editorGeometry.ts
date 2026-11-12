// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type EditorPoint = { x: number; y: number };
export type AffineMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Convert viewport pixels using the inverse of the rendered image's screen matrix. */
export function screenToNormalized(
  point: EditorPoint,
  matrix: AffineMatrix,
  width: number,
  height: number,
): EditorPoint | undefined {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12 || width <= 0 || height <= 0) {
    return undefined;
  }
  const x = point.x - matrix.e;
  const y = point.y - matrix.f;
  const normalized = {
    x: (matrix.d * x - matrix.c * y) / determinant / width,
    y: (-matrix.b * x + matrix.a * y) / determinant / height,
  };
  return Number.isFinite(normalized.x) && Number.isFinite(normalized.y) ? normalized : undefined;
}

/** Keep the shape intact at image edges rather than clamping each vertex independently. */
export function translatePolygon(
  points: readonly EditorPoint[],
  delta: EditorPoint,
): EditorPoint[] {
  if (points.length === 0) {
    return [];
  }
  const dx = Math.max(
    -Math.min(...points.map((p) => p.x)),
    Math.min(1 - Math.max(...points.map((p) => p.x)), delta.x),
  );
  const dy = Math.max(
    -Math.min(...points.map((p) => p.y)),
    Math.min(1 - Math.max(...points.map((p) => p.y)), delta.y),
  );
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

export function polygonPath(points: readonly EditorPoint[], width: number, height: number): string {
  return points.length === 0
    ? ""
    : `${points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x * width},${p.y * height}`).join(" ")} Z`;
}

/** Hit-test in screen pixels, then interpolate on the original normalized edge. */
export function nearestPolygonEdge(
  pointer: EditorPoint,
  points: readonly EditorPoint[],
  matrix: AffineMatrix,
  width: number,
  height: number,
  tolerance = 8,
): { after: number; point: EditorPoint } | undefined {
  let nearest: { after: number; point: EditorPoint } | undefined;
  let bestDistance = tolerance * tolerance;
  for (const [index, start] of points.entries()) {
    const end = points[(index + 1) % points.length]!;
    const x = matrix.a * start.x * width + matrix.c * start.y * height + matrix.e;
    const y = matrix.b * start.x * width + matrix.d * start.y * height + matrix.f;
    const dx = matrix.a * (end.x - start.x) * width + matrix.c * (end.y - start.y) * height;
    const dy = matrix.b * (end.x - start.x) * width + matrix.d * (end.y - start.y) * height;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      continue;
    }
    const t = ((pointer.x - x) * dx + (pointer.y - y) * dy) / lengthSquared;
    // Clicking a vertex must not insert a duplicate endpoint.
    if (t <= 0 || t >= 1) {
      continue;
    }
    const distance = (pointer.x - x - t * dx) ** 2 + (pointer.y - y - t * dy) ** 2;
    if (distance <= bestDistance) {
      bestDistance = distance;
      nearest = {
        after: index,
        point: { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) },
      };
    }
  }
  return nearest;
}

/** Repeated or collinear vertices do not enclose an annotatable region. */
export function hasPolygonArea(points: readonly EditorPoint[]): boolean {
  if (points.length < 3) {
    return false;
  }
  const doubledArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(doubledArea) > 1e-12;
}
