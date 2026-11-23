// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { AffineMatrix, EditorPoint } from "../editorGeometry";
import { clampUnit, nearestPolygonEdge, translatePolygon } from "../editorGeometry";
import type {
  Brush,
  Drag,
  EditableVertex,
  HoverTarget,
  Preview,
  VertexGroup,
  VertexRef,
} from "./canvasTypes";

/** Moves the given vertices by (dx, dy), clamped to the image. */
export function moveVertices(
  points: EditorPoint[],
  indices: readonly number[],
  dx: number,
  dy: number,
): EditorPoint[] {
  return points.map((p, i) =>
    indices.includes(i) ? { x: clampUnit(p.x + dx), y: clampUnit(p.y + dy) } : p,
  );
}

/** Shrinks a move delta so none of the grouped vertices leaves the image. */
export function clampDelta(
  groups: readonly VertexGroup[],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  let minX = -Infinity,
    maxX = Infinity,
    minY = -Infinity,
    maxY = Infinity;
  for (const group of groups) {
    for (const index of group.indices) {
      const p = group.points[index];
      if (p) {
        minX = Math.max(minX, -p.x);
        maxX = Math.min(maxX, 1 - p.x);
        minY = Math.max(minY, -p.y);
        maxY = Math.min(maxY, 1 - p.y);
      }
    }
  }
  return {
    dx: Math.min(Math.max(dx, minX), Math.max(minX, maxX)),
    dy: Math.min(Math.max(dy, minY), Math.max(minY, maxY)),
  };
}

/** Even-odd test of a normalized point against a polygon. */
export function pointInPolygon(points: readonly EditorPoint[], location: EditorPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (
      a.y > location.y !== b.y > location.y &&
      location.x < ((b.x - a.x) * (location.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** A normalized image point on screen through the image's screen matrix. */
export function toScreen(
  matrix: AffineMatrix,
  p: EditorPoint,
  width: number,
  height: number,
): EditorPoint {
  return {
    x: matrix.a * p.x * width + matrix.c * p.y * height + matrix.e,
    y: matrix.b * p.x * width + matrix.d * p.y * height + matrix.f,
  };
}

/** Normalized (dx, dy) of one arrow-key nudge of `step` source pixels. */
export function nudgeOffset(
  key: string,
  step: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: key === "ArrowRight" ? step / width : key === "ArrowLeft" ? -step / width : 0,
    y: key === "ArrowDown" ? step / height : key === "ArrowUp" ? -step / height : 0,
  };
}

/** Brush key bindings: B paints, E erases, [ and ] shrink and grow the radius (1-200 px). */
export function brushAfterKey(current: Brush, rawKey: string): Brush {
  const key = rawKey.toLowerCase();
  if (key === "b") {
    return { ...current, mode: "paint" };
  }
  if (key === "e") {
    return { ...current, mode: "erase" };
  }
  return {
    ...current,
    radius: Math.max(1, Math.min(200, Math.round(current.radius * (key === "]" ? 1.25 : 0.8)))),
  };
}

const sameVertex = (a: VertexRef, b: VertexRef): boolean =>
  a.polygonId === b.polygonId && a.vertex === b.vertex;

/** Shift+click: adds the vertex to the selection, or removes it when already selected. */
export function toggleVertex(current: readonly VertexRef[], ref: VertexRef): VertexRef[] {
  return current.some((v) => sameVertex(v, ref))
    ? current.filter((v) => !sameVertex(v, ref))
    : [...current, ref];
}

/** Vertices inside the rectangle (normalized coordinates), as references. */
export function verticesInRect(
  vertices: readonly EditableVertex[],
  a: EditorPoint,
  b: EditorPoint,
): VertexRef[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return vertices
    .filter((v) => v.point.x >= x0 && v.point.x <= x1 && v.point.y >= y0 && v.point.y <= y1)
    .map((v) => ({ polygonId: v.polygonId, vertex: v.vertex }));
}

/** The selection after a rectangle select: replaced, or extended without duplicates. */
export function selectionAfterRect(
  current: readonly VertexRef[],
  hits: readonly VertexRef[],
  options: { additive: boolean },
): VertexRef[] {
  return options.additive
    ? [...current, ...hits.filter((hit) => !current.some((c) => sameVertex(c, hit)))]
    : [...hits];
}

/** The selected vertices grouped per polygon, for moving them together. */
export function groupSelected(
  selected: readonly VertexRef[],
  vertices: readonly EditableVertex[],
): VertexGroup[] {
  const groups = new Map<string, VertexGroup>();
  for (const ref of selected) {
    const owner = vertices.find((v) => v.polygonId === ref.polygonId);
    if (owner) {
      const group = groups.get(ref.polygonId) ?? {
        instanceId: owner.instanceId,
        polygonId: ref.polygonId,
        points: owner.points,
        indices: [],
      };
      group.indices.push(ref.vertex);
      groups.set(ref.polygonId, group);
    }
  }
  return [...groups.values()];
}

/** What a polygon or multi-vertex drag moves, as vertex groups (no indices for a whole polygon). */
export function dragTargets(
  active: Extract<Drag, { type: "polygon" | "vertices" }>,
): VertexGroup[] {
  return active.type === "vertices"
    ? active.targets
    : [
        {
          instanceId: active.instanceId,
          polygonId: active.polygonId,
          points: active.points,
          indices: [],
        },
      ];
}

/** The polygons' points after the pointer moved to `next` during a drag. */
export function previewOf(
  active: Extract<Drag, { type: "polygon" | "vertices" }>,
  next: EditorPoint,
): Preview {
  if (active.type === "vertices") {
    const { dx, dy } = clampDelta(
      active.targets,
      next.x - active.origin.x,
      next.y - active.origin.y,
    );
    return Object.fromEntries(
      active.targets.map((t) => [t.polygonId, moveVertices(t.points, t.indices, dx, dy)]),
    );
  }
  return {
    [active.polygonId]:
      active.vertex == undefined
        ? translatePolygon(active.points, {
            x: next.x - active.origin.x,
            y: next.y - active.origin.y,
          })
        : active.points.map((old, index) =>
            index === active.vertex ? { x: clampUnit(next.x), y: clampUnit(next.y) } : old,
          ),
  };
}

type HitCandidate = { instanceId: string; polygonId: string; points: EditorPoint[] };

/** Radius in screen pixels within which a press grabs a vertex. */
export const VERTEX_HIT_RADIUS = 8;

/**
 * The vertex or edge under the pointer. The forgiving vertex area wins over an adjacent insertion
 * edge; candidates are tried in the order given.
 */
export function findHitTarget(
  candidates: readonly HitCandidate[],
  matrix: AffineMatrix,
  client: EditorPoint,
  width: number,
  height: number,
): HoverTarget | undefined {
  for (const target of candidates) {
    for (const [vertex, p] of target.points.entries()) {
      const at = toScreen(matrix, p, width, height);
      if (Math.hypot(client.x - at.x, client.y - at.y) <= VERTEX_HIT_RADIUS) {
        return { ...target, type: "vertex", vertex };
      }
    }
  }
  for (const target of candidates) {
    const edge = nearestPolygonEdge(client, target.points, matrix, width, height);
    if (edge) {
      return { ...target, type: "edge", ...edge };
    }
  }
  return undefined;
}

/** What deleting `refs` would leave, or "tooFew" when any polygon would keep under 3 vertices. */
export function planVertexRemoval(
  refs: readonly VertexRef[],
  pointsOf: (polygonId: string) => EditorPoint[] | undefined,
): { polygonId: string; kept: EditorPoint[]; first: number }[] | "tooFew" {
  const groups = new Map<string, Set<number>>();
  for (const ref of refs) {
    groups.set(ref.polygonId, (groups.get(ref.polygonId) ?? new Set()).add(ref.vertex));
  }
  const edits: { polygonId: string; kept: EditorPoint[]; first: number }[] = [];
  for (const [polygonId, indices] of groups) {
    const points = pointsOf(polygonId);
    if (!points) {
      continue;
    }
    const kept = points.filter((_point, index) => !indices.has(index));
    if (kept.length < 3) {
      return "tooFew";
    }
    edits.push({ polygonId, kept, first: Math.min(...indices) });
  }
  return edits;
}

/** The polygon with a new point inserted after vertex `after`. */
export function insertPointAfter(
  points: readonly EditorPoint[],
  after: number,
  point: EditorPoint,
): EditorPoint[] {
  return [...points.slice(0, after + 1), point, ...points.slice(after + 1)];
}

/** Screen bounds of the points, and the zoom and pan that frame them in the viewport. */
export function fitToBounds(
  onScreen: readonly EditorPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): { center: EditorPoint; ratio: number; panX: number; panY: number } {
  const left = Math.min(...onScreen.map((p) => p.x));
  const right = Math.max(...onScreen.map((p) => p.x));
  const top = Math.min(...onScreen.map((p) => p.y));
  const bottom = Math.max(...onScreen.map((p) => p.y));
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const ratio =
    0.85 *
    Math.min(bounds.width / Math.max(1, right - left), bounds.height / Math.max(1, bottom - top));
  return {
    center,
    ratio,
    panX: bounds.x + bounds.width / 2 - center.x,
    panY: bounds.y + bounds.height / 2 - center.y,
  };
}

/** The pan delta of an arrow key while Space is held (20 px per press). */
export function panKeyDelta(key: string, step: number): { x: number; y: number } {
  return {
    x: key === "ArrowLeft" ? step : key === "ArrowRight" ? -step : 0,
    y: key === "ArrowUp" ? step : key === "ArrowDown" ? -step : 0,
  };
}

/** The pointer cursor for the canvas' current mode. */
export function cursorFor(mode: {
  panning: boolean;
  panTool: boolean;
  spaceHeld: boolean;
  drawing: boolean;
  brushActive: boolean;
  hover: HoverTarget | undefined;
}): string {
  if (mode.panning) {
    return "grabbing";
  }
  if (mode.panTool || mode.spaceHeld) {
    return "grab";
  }
  if (mode.drawing) {
    return "crosshair";
  }
  if (mode.brushActive) {
    return "none";
  }
  return mode.hover?.type === "edge" ? "copy" : "default";
}
