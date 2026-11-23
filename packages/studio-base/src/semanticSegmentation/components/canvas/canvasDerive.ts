// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { polygonsOf } from "../../maskGeometry";
import type { DecodedSegmentationFrame } from "../../runtime";
import { frameInstanceKey } from "../../service";
import type { SegmentationDocument, SegmentationFrame } from "../../types";
import { findPolygonOwner, focusContains } from "../polygonEdit";
import type { CanvasState } from "./canvasState";
import type { EditableVertex, VertexRef } from "./canvasTypes";

export type CanvasDeriveInput = {
  state: CanvasState;
  /** Frame this canvas draws; omitted canvases follow the store's current frame. */
  shownFrameId: string | undefined;
  imageUrl: string | undefined;
  decodedFrame: DecodedSegmentationFrame | undefined;
  disabled: boolean;
  panTool: boolean;
  selectedVertices: readonly VertexRef[];
  /** Frame that received the first vertex of the drawing in progress, if any. */
  strokeFrameId: string | undefined;
};

type Observation = SegmentationDocument["annotations"][string] | undefined;

const PROPAGATING = ["running", "stopping"];

/** The instance an edit applies to: the focused instance, or the owner of a focused polygon. */
function focusedInstanceOf(state: CanvasState, frameId: string | undefined): string | undefined {
  const { focus, document } = state;
  if (focus?.type === "instance") {
    return focus.id;
  }
  return focus?.type === "polygon"
    ? findPolygonOwner(document, frameId, focus.id)?.instanceId
    : undefined;
}

/** Polygons on this frame inside the edit scope (the focused instance or class). */
function scopePolygonsOf(
  document: SegmentationDocument | undefined,
  frameId: string | undefined,
  inFocus: (instanceId: string, polygonId: string) => boolean,
): string[] {
  if (frameId == undefined) {
    return [];
  }
  return Object.values(document?.annotations ?? {})
    .filter((annotation) => annotation.frameId === frameId)
    .flatMap((annotation) =>
      polygonsOf(annotation)
        .filter((polygon) => inFocus(annotation.instanceId, polygon.id))
        .map((polygon) => polygon.id),
    );
}

/**
 * The one polygon whose vertices are edited: the focused polygon, else the single selected one,
 * else the only polygon in scope. Other polygons in scope are only highlighted; pressing one
 * makes it the active polygon.
 */
export function activePolygonOf(
  focus: CanvasState["focus"],
  selection: CanvasState["selection"],
  scopePolygons: readonly string[],
): string | undefined {
  if (focus?.type === "polygon" && scopePolygons.includes(focus.id)) {
    return focus.id;
  }
  const selected = selection.filter(
    (node) => node.type === "polygon" && scopePolygons.includes(node.id),
  );
  if (selected.length === 1) {
    return selected[0]!.id;
  }
  return scopePolygons.length === 1 ? scopePolygons[0] : undefined;
}

/** Every vertex of every polygon whose vertices can be edited right now. */
function editableVerticesOf(
  document: SegmentationDocument | undefined,
  frameId: string | undefined,
  editsVertices: (instanceId: string, polygonId: string) => boolean,
): EditableVertex[] {
  return Object.values(document?.annotations ?? {})
    .filter((a) => a.frameId === frameId)
    .flatMap((a) =>
      polygonsOf(a)
        .filter((p) => editsVertices(a.instanceId, p.id))
        .flatMap((p) =>
          p.points.map((point, vertex) => ({
            instanceId: a.instanceId,
            polygonId: p.id,
            vertex,
            point,
            points: p.points,
          })),
        ),
    );
}

/** Everything the canvas works out from the store, its props and its local view state. */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- the shape is the return value; `CanvasDerived` names it for callers
export function deriveCanvas(input: CanvasDeriveInput) {
  const { state, shownFrameId, decodedFrame, disabled, selectedVertices } = input;
  const document = state.document;
  const activeFrameId = state.currentFrameId;
  const frameId = shownFrameId ?? activeFrameId;
  const frame: SegmentationFrame | undefined = document?.frames.find((item) => item.id === frameId);
  const source = input.imageUrl ?? frame?.imageUrl;
  const nativeView = decodedFrame?.nativeView;
  const draftElsewhere =
    shownFrameId != undefined &&
    input.strokeFrameId != undefined &&
    shownFrameId !== input.strokeFrameId;
  const propagating = PROPAGATING.includes(state.propagationStatus);
  const navigationLocked = disabled || propagating;
  const locked = disabled || draftElsewhere || propagating || !source || !nativeView;
  const drawing = state.drawing;
  const tool = state.creationTool;
  const focusedInstanceId = focusedInstanceOf(state, frameId);
  const focusedObservation: Observation =
    focusedInstanceId != undefined && frameId != undefined
      ? document?.annotations[frameInstanceKey(frameId, focusedInstanceId)]
      : undefined;
  /**
   * Editing a mask, or an instance with nothing on this frame yet, paints with the brush: a mask
   * stays pixels (lossless). Polygon observations keep vertex editing.
   */
  const brushActive =
    !locked &&
    state.editing &&
    drawing == undefined &&
    focusedInstanceId != undefined &&
    state.viewMode !== "original" &&
    focusedObservation?.kind !== "polygons";
  const inFocus = (instanceId: string, polygonId: string): boolean =>
    focusContains(document, state.focus, frameId, instanceId, polygonId);
  const scopePolygons = scopePolygonsOf(document, frameId, inFocus);
  const activePolygonId = activePolygonOf(state.focus, state.selection, scopePolygons);
  /** Vertex handles, edge insertion and dragging belong to the active polygon only. */
  const editsVertices = (instanceId: string, polygonId: string): boolean =>
    polygonId === activePolygonId && inFocus(instanceId, polygonId);
  const vertices =
    !locked && state.editing && !drawing && state.viewMode !== "original"
      ? editableVerticesOf(document, frameId, editsVertices)
      : [];
  const activeVertex = selectedVertices.at(-1);
  return {
    document,
    activeFrameId,
    frameId,
    frame,
    source,
    nativeView,
    draftElsewhere,
    navigationLocked,
    locked,
    drawing,
    tool,
    // Quick annotation (SAM2 clicks) and vertex drawing are the two ways to create geometry.
    quickMode: drawing != undefined && tool === "quick",
    focusedInstanceId,
    focusedObservation,
    brushActive,
    unreadableHere: Object.values(document?.unreadableObservations ?? {}).filter(
      (item) => item.frameId === frameId,
    ),
    inFocus,
    scopePolygons,
    activePolygonId,
    editsVertices,
    vertices,
    activePoint: vertices.find(
      (v) => v.polygonId === activeVertex?.polygonId && v.vertex === activeVertex.vertex,
    ),
    /** Vertices that are selected and still editable; keyboard edits act on these. */
    selectedEditable: selectedVertices.filter((ref) =>
      vertices.some((v) => v.polygonId === ref.polygonId && v.vertex === ref.vertex),
    ),
  };
}

export type CanvasDerived = ReturnType<typeof deriveCanvas>;
