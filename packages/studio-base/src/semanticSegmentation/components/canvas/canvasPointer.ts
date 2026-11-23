// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { clampUnit, screenToNormalized } from "../editorGeometry";
import {
  cancelGesture,
  claimShownFrame,
  commitPolygonPreview,
  finishStroke,
  markStrokeFrame,
  pointOf,
  resetTemporaryInput,
} from "./canvasActions";
import { dragTargets, previewOf } from "./canvasMath";
import type { Drag } from "./canvasTypes";
import type { CanvasContext } from "./canvasUi";
import { addQuickPoint } from "./quickMask";
import { contextTarget, hitTarget, insertVertex, selectInRect } from "./vertexEditing";
import { nativePanOnly, panelView } from "./viewControls";

type PointerEvent = ReactPointerEvent<SVGSVGElement>;

/** Captures the pointer on the canvas so a drag survives leaving it. */
function capturePointer(c: CanvasContext, event: PointerEvent): void {
  event.currentTarget.setPointerCapture(event.pointerId);
  c.ui.capture.current = { element: event.currentTarget, pointerId: event.pointerId };
}

/** The viewport first: Image panel presses (pan, zoom) never reach the shapes. */
export function handleViewportPointerDownCapture(
  c: CanvasContext,
  event: ReactPointerEvent<HTMLElement>,
): void {
  if (nativePanOnly(c, event)) {
    event.stopPropagation();
  }
}

/** The same presses reach the Image panel as a native mousedown, so it can pan its camera. */
export function handleViewportMouseDownCapture(
  c: CanvasContext,
  event: ReactMouseEvent<HTMLElement>,
): void {
  if (nativePanOnly(c, event)) {
    c.props.decodedFrame?.nativeCanvas?.dispatchEvent(
      new MouseEvent("mousedown", event.nativeEvent),
    );
    event.stopPropagation();
  }
}

/** Middle button, right button, or Space / the pan tool with the left button, start a pan. */
export function handlePointerDownCapture(c: CanvasContext, event: PointerEvent): void {
  const { ui } = c;
  if (c.d.navigationLocked) {
    return;
  }
  if (
    event.button === 1 ||
    event.button === 2 ||
    ((ui.panTool || ui.space.current) && event.button === 0)
  ) {
    event.preventDefault();
    event.stopPropagation();
    ui.viewport.current?.focus({ preventScroll: true });
    cancelGesture(ui);
    capturePointer(c, event);
    ui.drag.current = {
      type: "pan",
      origin: { x: event.clientX, y: event.clientY },
      pan: ui.view.current.pan,
      button: event.button,
      moved: false,
      temporarySpace: ui.space.current && event.button === 0,
    };
    ui.setPanning(true);
    ui.setContextMenu(undefined);
    ui.setHover(undefined);
  }
}

function startBrushStroke(c: CanvasContext, event: PointerEvent): void {
  const at = pointOf(c, event);
  if (!at) {
    return;
  }
  const start = { x: clampUnit(at.x), y: clampUnit(at.y) };
  capturePointer(c, event);
  c.ui.drag.current = { type: "stroke", points: [start] };
  c.ui.setStroke([start]);
}

/** A left press while editing: an edge inserts a vertex, empty canvas starts a rubber band. */
function startEditPress(c: CanvasContext, event: PointerEvent): boolean {
  const target = hitTarget(c, event);
  if (target?.type === "edge") {
    insertVertex(c, event, target.instanceId, target.polygonId, target.points);
    return true;
  }
  // Dragging over empty canvas in edit mode draws a selection rectangle.
  const origin = c.state.editing ? pointOf(c, event) : undefined;
  if (!origin) {
    return false;
  }
  capturePointer(c, event);
  c.ui.drag.current = {
    type: "marquee",
    origin,
    screenOrigin: { x: event.clientX, y: event.clientY },
    additive: event.shiftKey,
    moved: false,
  };
  return true;
}

function placeDraftVertex(c: CanvasContext, event: PointerEvent): void {
  const next = pointOf(c, event);
  if (!next) {
    c.ui.setError(c.t("pointerUnmapped"));
    return;
  }
  // The nearest point on the image rectangle is each axis clamped to [0, 1].
  const placed = { x: clampUnit(next.x), y: clampUnit(next.y) };
  c.ui.setDraft((points) => [...points, placed]);
  markStrokeFrame(c);
  c.ui.setError(undefined);
}

export function handlePointerDown(c: CanvasContext, event: PointerEvent): void {
  const { ui, d } = c;
  ui.setHover(undefined);
  ui.viewport.current?.focus({ preventScroll: true });
  if (d.draftElsewhere || !claimShownFrame(c)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (d.navigationLocked) {
    return;
  }
  const idle = !ui.peekOriginal && !ui.panTool && !ui.space.current && event.button === 0;
  if (d.brushActive && idle) {
    startBrushStroke(c, event);
    return;
  }
  const visible = c.state.viewMode !== "original";
  if (!d.drawing && !d.locked && idle && visible && startEditPress(c, event)) {
    return;
  }
  if (d.drawing && !d.locked && !ui.peekOriginal && visible && event.button === 0) {
    if (d.quickMode) {
      addQuickPoint(c, event, event.shiftKey || event.altKey ? "negative" : "positive");
    } else {
      placeDraftVertex(c, event);
    }
  }
}

/** Pans the Image panel's camera, or this canvas' own view, by the pointer movement. */
function movePan(
  c: CanvasContext,
  event: PointerEvent,
  active: Extract<Drag, { type: "pan" }>,
): void {
  const { ui } = c;
  if (c.d.navigationLocked) {
    ui.drag.current = undefined;
    ui.setPanning(false);
    return;
  }
  if (
    Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) < 4 &&
    !active.moved
  ) {
    return;
  }
  active.moved = true;
  const panel = panelView(c);
  if (panel) {
    // Over the Image panel, pan its camera by the pointer's screen movement.
    const last = active.last ?? active.origin;
    panel.panBy(event.clientX - last.x, event.clientY - last.y);
    active.last = { x: event.clientX, y: event.clientY };
    return;
  }
  const matrix = event.currentTarget.getScreenCTM();
  if (!matrix) {
    return;
  }
  const origin = screenToNormalized(active.origin, matrix, 1, 1);
  const current = screenToNormalized({ x: event.clientX, y: event.clientY }, matrix, 1, 1);
  if (origin && current) {
    const nextPan = {
      x: active.pan.x + current.x - origin.x,
      y: active.pan.y + current.y - origin.y,
    };
    ui.view.current = { ...ui.view.current, pan: nextPan };
    ui.setPan(nextPan);
  }
}

/** Drags a polygon or its selected vertices: shows the preview, cancels if edits stopped. */
function moveShape(
  c: CanvasContext,
  event: PointerEvent,
  active: Extract<Drag, { type: "polygon" | "vertices" }>,
): void {
  const { ui, d } = c;
  const travelled = Math.hypot(
    event.clientX - active.screenOrigin.x,
    event.clientY - active.screenOrigin.y,
  );
  if (travelled < 4) {
    ui.previewRef.current = undefined;
    ui.setPreview(undefined);
    return;
  }
  const next = pointOf(c, event);
  if (
    !next ||
    d.locked ||
    !c.state.editing ||
    !dragTargets(active).every((target) => d.editsVertices(target.instanceId, target.polygonId))
  ) {
    cancelGesture(ui);
    return;
  }
  const moved = previewOf(active, next);
  ui.previewRef.current = moved;
  ui.setPreview(moved);
}

export function handlePointerMove(c: CanvasContext, event: PointerEvent): void {
  const { ui, d } = c;
  const active = ui.drag.current;
  if (d.brushActive) {
    const at = pointOf(c, event);
    ui.setBrushCursor(at);
    if (active?.type === "stroke" && at) {
      active.points.push({ x: clampUnit(at.x), y: clampUnit(at.y) });
      ui.setStroke([...active.points]);
    }
  }
  if (active?.type === "stroke") {
    return;
  }
  if (!active) {
    ui.setHover(hitTarget(c, event));
    return;
  }
  if (active.type === "pan") {
    movePan(c, event, active);
  } else if (active.type === "marquee") {
    if (
      !active.moved &&
      Math.hypot(event.clientX - active.screenOrigin.x, event.clientY - active.screenOrigin.y) < 4
    ) {
      return;
    }
    active.moved = true;
    const current = pointOf(c, event);
    if (current) {
      ui.setMarquee({ a: active.origin, b: current });
    }
  } else {
    moveShape(c, event, active);
  }
}

export function handlePointerUp(c: CanvasContext, event: PointerEvent): void {
  const { ui, d } = c;
  const active = ui.drag.current;
  if (active?.type === "stroke") {
    const points = active.points;
    cancelGesture(ui);
    finishStroke(c, points);
    return;
  }
  if (active?.type === "pan" && active.button === 2 && !active.moved && !d.navigationLocked) {
    if (d.drawing && d.quickMode && !d.locked && !ui.peekOriginal) {
      addQuickPoint(c, event, "negative");
    } else {
      ui.setContextMenu({ x: event.clientX, y: event.clientY, target: contextTarget(c, event) });
    }
  }
  if (active?.type === "marquee") {
    const end = pointOf(c, event);
    if (active.moved && end) {
      selectInRect(c, active.origin, end, { additive: active.additive });
    } else if (!active.moved && !active.additive) {
      ui.setSelectedVertices([]);
    }
  } else if (active?.type === "vertices" && !ui.previewRef.current) {
    // A plain click on one of several selected points keeps just that point.
    ui.setSelectedVertices([active.pressed]);
  }
  commitPolygonPreview(c.store, ui);
  cancelGesture(ui);
}

export function handleLostPointerCapture(c: CanvasContext): void {
  const { ui } = c;
  const active = ui.drag.current;
  if (active?.type === "stroke") {
    cancelGesture(ui);
    finishStroke(c, active.points);
    return;
  }
  if (ui.drag.current) {
    // DOM remounts (late frame-window merge, viewBox resize) can drop capture
    // before pointerup; commit the preview instead of reverting the gesture.
    commitPolygonPreview(c.store, ui);
    resetTemporaryInput(ui);
  }
}
