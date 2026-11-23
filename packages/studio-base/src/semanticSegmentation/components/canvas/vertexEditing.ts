// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { polygonsOf } from "../../maskGeometry";
import type { EditorPoint } from "../editorGeometry";
import { claimShownFrame, pointOf, run } from "./canvasActions";
import {
  clampDelta,
  findHitTarget,
  groupSelected,
  insertPointAfter,
  moveVertices,
  nudgeOffset,
  planVertexRemoval,
  pointInPolygon,
  selectionAfterRect,
  toggleVertex,
  verticesInRect,
} from "./canvasMath";
import type { HoverTarget, PolygonTarget, Preview, VertexGroup, VertexRef } from "./canvasTypes";
import type { CanvasContext } from "./canvasUi";

type PointerLike = { clientX: number; clientY: number };

/** The vertex or edge of an editable polygon under the pointer, when editing allows hits. */
export function hitTarget(c: CanvasContext, event: PointerLike): HoverTarget | undefined {
  const { locked, drawing, frameId, document, editsVertices } = c.d;
  if (
    locked ||
    !c.state.editing ||
    drawing ||
    c.ui.panTool ||
    c.ui.space.current ||
    c.ui.peekOriginal ||
    c.state.viewMode === "original"
  ) {
    return undefined;
  }
  const matrix = c.ui.content.current?.getScreenCTM();
  if (!matrix) {
    return undefined;
  }
  const candidates = Object.values(document?.annotations ?? {})
    .filter((annotation) => annotation.frameId === frameId)
    .flatMap((annotation) =>
      polygonsOf(annotation)
        .filter((polygon) => editsVertices(annotation.instanceId, polygon.id))
        .map((polygon) => ({
          instanceId: annotation.instanceId,
          polygonId: polygon.id,
          points: polygon.points,
        })),
    )
    .reverse();
  return findHitTarget(
    candidates,
    matrix,
    { x: event.clientX, y: event.clientY },
    c.ui.size.width,
    c.ui.size.height,
  );
}

/** What a right-click or context key acts on: a vertex or edge nearby, else the polygon under it. */
export function contextTarget(
  c: CanvasContext,
  event: PointerLike,
): HoverTarget | PolygonTarget | undefined {
  if (c.d.drawing) {
    return undefined;
  }
  const nearby = hitTarget(c, event);
  if (nearby) {
    return nearby;
  }
  if (c.ui.peekOriginal || c.state.viewMode === "original") {
    return undefined;
  }
  const location = pointOf(c, event);
  if (!location) {
    return undefined;
  }
  const { document, frameId, inFocus } = c.d;
  return Object.values(document?.annotations ?? {})
    .filter((a) => a.frameId === frameId)
    .flatMap((a) =>
      polygonsOf(a)
        .filter((p) => c.state.viewMode === "all" || inFocus(a.instanceId, p.id))
        .map((p) => ({
          type: "polygon" as const,
          instanceId: a.instanceId,
          polygonId: p.id,
          points: p.points,
        })),
    )
    .reverse()
    .find(({ points }) => pointInPolygon(points, location));
}

/** The selected vertices grouped per polygon. */
export function selectedGroups(c: CanvasContext): VertexGroup[] {
  return groupSelected(c.d.selectedEditable, c.d.vertices);
}

/** Deletes the given vertices; every affected polygon must keep at least 3 (all-or-nothing). */
export function removeVertices(c: CanvasContext, refs: VertexRef[], known?: Preview): void {
  const plan = planVertexRemoval(
    refs,
    (polygonId) =>
      known?.[polygonId] ?? c.d.vertices.find((v) => v.polygonId === polygonId)?.points,
  );
  if (plan === "tooFew") {
    c.ui.setError(c.t("polygonMinVertices"));
    return;
  }
  const last = plan.at(-1);
  if (!last) {
    return;
  }
  run(c, () => {
    const apply = (): undefined => {
      for (const edit of plan) {
        c.state.setPolygonPoints(edit.polygonId, edit.kept);
      }
    };
    if (plan.length > 1) {
      c.state.runTransaction("Delete vertices", apply);
    } else {
      apply();
    }
    c.ui.setSelectedVertices([
      { polygonId: last.polygonId, vertex: Math.min(last.first, last.kept.length - 1) },
    ]);
  });
}

export function removeVertexAt(
  c: CanvasContext,
  polygonId: string,
  points: EditorPoint[],
  vertex: number,
): void {
  removeVertices(c, [{ polygonId, vertex }], { [polygonId]: points });
}

/** Inserts a point on the edge under the pointer and selects it. */
export function insertVertex(
  c: CanvasContext,
  event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>,
  instanceId: string,
  polygonId: string,
  points: EditorPoint[],
): void {
  event.stopPropagation();
  if (
    c.d.locked ||
    !c.state.editing ||
    !c.d.editsVertices(instanceId, polygonId) ||
    c.d.drawing ||
    c.ui.panTool ||
    event.button !== 0
  ) {
    return;
  }
  const edge = hitTarget(c, event);
  if (edge?.type !== "edge" || edge.polygonId !== polygonId) {
    return;
  }
  event.preventDefault();
  c.ui.setHover(undefined);
  c.ui.drag.current = undefined;
  c.ui.setPreview(undefined);
  run(c, () => {
    c.state.setPolygonPoints(polygonId, insertPointAfter(points, edge.after, edge.point));
    c.ui.setSelectedVertices([{ polygonId, vertex: edge.after + 1 }]);
  });
}

/** Selects every editable vertex inside the rectangle (normalized coordinates). */
export function selectInRect(
  c: CanvasContext,
  a: EditorPoint,
  b: EditorPoint,
  options: { additive: boolean },
): void {
  const hits = verticesInRect(c.d.vertices, a, b);
  c.ui.setSelectedVertices((current) => selectionAfterRect(current, hits, options));
}

/** Arrow-key nudge of the selected vertices by `step` source pixels. */
export function nudge(c: CanvasContext, key: string, step: 1 | 10): void {
  if (c.d.locked) {
    return;
  }
  const groups = selectedGroups(c);
  const raw = nudgeOffset(key, step, c.ui.size.width, c.ui.size.height);
  const { dx, dy } = clampDelta(groups, raw.x, raw.y);
  if (groups.length === 0 || (dx === 0 && dy === 0)) {
    return;
  }
  run(c, () => {
    const apply = (): undefined => {
      for (const group of groups) {
        c.state.setPolygonPoints(
          group.polygonId,
          moveVertices(group.points, group.indices, dx, dy),
        );
      }
    };
    if (groups.length > 1) {
      c.state.runTransaction("Move vertices", apply);
    } else {
      apply();
    }
  });
}

/** A press on a polygon, its outline or one of its vertices: select it and maybe start a drag. */
export function startShape(
  c: CanvasContext,
  event: ReactPointerEvent<SVGElement>,
  instanceId: string,
  polygonId: string,
  points: EditorPoint[],
  vertex?: number,
): void {
  const { navigationLocked, drawing, locked, editsVertices, inFocus, selectedEditable } = c.d;
  const { ui, state } = c;
  if (
    navigationLocked ||
    drawing ||
    ui.panTool ||
    ui.space.current ||
    ui.peekOriginal ||
    event.button !== 0
  ) {
    return;
  }
  if (!claimShownFrame(c)) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  ui.setHover(undefined);
  ui.viewport.current?.focus({ preventScroll: true });
  // Pressing another polygon in scope first makes it the active one; only that one drags.
  const canEdit = !locked && state.editing && editsVertices(instanceId, polygonId);
  const pressed: VertexRef | undefined = vertex == undefined ? undefined : { polygonId, vertex };
  state.setSelection([{ type: "polygon", id: polygonId }]);
  if (!canEdit) {
    if (pressed) {
      ui.setSelectedVertices([pressed]);
    }
    // Inside the edit scope the press only activates this polygon (the selection above); the
    // scope, e.g. a focused class, stays. Outside it, focus moves to the pressed instance.
    if (!(state.editing && inFocus(instanceId, polygonId))) {
      state.setFocus({ type: "instance", id: instanceId });
    }
    return;
  }
  if (pressed && event.shiftKey && !event.altKey) {
    // Shift+click adds/removes a point from the selection without starting a drag.
    ui.setSelectedVertices((current) => toggleVertex(current, pressed));
    return;
  }
  const grouped =
    pressed != undefined &&
    selectedEditable.length > 1 &&
    selectedEditable.some((v) => v.polygonId === polygonId && v.vertex === vertex);
  if (pressed && !grouped) {
    ui.setSelectedVertices([pressed]);
  }
  if (event.altKey && vertex != undefined) {
    event.preventDefault();
    ui.drag.current = undefined;
    ui.setPreview(undefined);
    removeVertexAt(c, polygonId, points, vertex);
    return;
  }
  // Hovering/clicking a line inserts a point; grab the fill to drag the whole polygon.
  if (vertex == undefined) {
    const edge = hitTarget(c, event);
    if (edge?.type === "edge" && edge.polygonId === polygonId) {
      insertVertex(c, event, instanceId, polygonId, points);
      return;
    }
  }
  const origin = pointOf(c, event);
  if (!origin) {
    return;
  }
  event.currentTarget.setPointerCapture(event.pointerId);
  ui.capture.current = { element: event.currentTarget, pointerId: event.pointerId };
  const screenOrigin = { x: event.clientX, y: event.clientY };
  ui.drag.current = grouped
    ? { type: "vertices", origin, screenOrigin, targets: selectedGroups(c), pressed }
    : { type: "polygon", instanceId, polygonId, origin, screenOrigin, points, vertex };
}
