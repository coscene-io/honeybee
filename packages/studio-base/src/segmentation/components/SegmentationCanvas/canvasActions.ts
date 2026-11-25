// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MouseEvent as ReactMouseEvent } from "react";
import type { StoreApi } from "zustand";

import type { CanvasContext, CanvasUi } from "./canvasUi";
import { hasPolygonArea, screenToNormalized } from "../../editorGeometry";
import type { EditorPoint } from "../../editorGeometry";
import { segmentationErrorText } from "../../errors";
import { maskContains } from "../../maskCodec";
import {
  applyStroke,
  maskConversionLoss,
  maskOf,
  runsOfMask,
  strokeRuns,
} from "../../maskGeometry";
import { beginPolygonEdit, findPolygonOwner, focusContains } from "../../polygonEdit";
import { frameInstanceKey } from "../../service";
import type { CreationTool, SegmentationStore } from "../../types";

/** Runs a store command; a failure becomes the canvas' error banner instead of an exception. */
export function run(c: CanvasContext, action: () => void): void {
  try {
    action();
    c.ui.setError(undefined);
  } catch (err) {
    c.ui.setError(segmentationErrorText(err));
  }
}

/** A client position as a normalized image point, or undefined before the image is mapped. */
export function pointOf(
  c: CanvasContext,
  event: { clientX: number; clientY: number },
): EditorPoint | undefined {
  const matrix = c.ui.content.current?.getScreenCTM();
  return matrix
    ? screenToNormalized(
        { x: event.clientX, y: event.clientY },
        matrix,
        c.ui.size.width,
        c.ui.size.height,
      )
    : undefined;
}

/** Drops the gesture in flight, its previews and the pointer capture. */
export function cancelGesture(ui: CanvasUi): void {
  ui.drag.current = undefined;
  ui.previewRef.current = undefined;
  ui.setPreview(undefined);
  ui.setStroke(undefined);
  ui.setMarquee(undefined);
  ui.setPanning(false);
  ui.setHover(undefined);
  const captured = ui.capture.current;
  ui.capture.current = undefined;
  if (
    captured != undefined &&
    typeof captured.element.hasPointerCapture === "function" &&
    captured.element.hasPointerCapture(captured.pointerId)
  ) {
    captured.element.releasePointerCapture(captured.pointerId);
  }
}

/** Ends held-key modes (Space pan, peek original) and the gesture they started. */
export function resetTemporaryInput(ui: CanvasUi): void {
  cancelGesture(ui);
  ui.space.current = false;
  ui.setSpaceHeld(false);
  ui.setPeekOriginal(false);
}

/**
 * Commits a polygon or vertex drag before environmental clears (image size discovery, lost
 * capture). Intentional cancels call cancelGesture first, so drag/preview are already empty here.
 */
export function commitPolygonPreview(store: StoreApi<SegmentationStore>, ui: CanvasUi): void {
  const active = ui.drag.current;
  const latest = ui.previewRef.current;
  const current = store.getState();
  if (
    (active?.type !== "polygon" && active?.type !== "vertices") ||
    !latest ||
    ["running", "stopping"].includes(current.propagation.status) ||
    !current.currentFrameId ||
    !current.editing
  ) {
    return;
  }
  const targets =
    active.type === "polygon"
      ? [
          {
            instanceId: active.instanceId,
            polygonId: active.polygonId,
            points: active.points,
            indices: [],
          },
        ]
      : active.targets;
  const inScope = targets.every((target) =>
    focusContains(
      current.document,
      current.focus,
      current.currentFrameId,
      target.instanceId,
      target.polygonId,
    ),
  );
  const changed = targets.filter((target) => {
    const next = latest[target.polygonId];
    return next?.some((p, i) => p.x !== target.points[i]?.x || p.y !== target.points[i].y) === true;
  });
  if (!inScope || changed.length === 0) {
    return;
  }
  try {
    if (changed.length === 1) {
      current.setPolygonPoints(changed[0]!.polygonId, latest[changed[0]!.polygonId]!);
    } else {
      // One undo step for a batch that spans several polygons.
      current.runTransaction("opLabelMoveVertices", () => {
        for (const target of changed) {
          current.setPolygonPoints(target.polygonId, latest[target.polygonId]!);
        }
      });
    }
    ui.setError(undefined);
  } catch (err) {
    ui.setError(segmentationErrorText(err));
  }
}

/** The decoded source size of the shown frame's camera, which masks are bound to. */
export function sourceSize(c: CanvasContext): { width: number; height: number } {
  const { document } = c.d;
  const video = document?.videos.find((item) => item.id === c.d.frame?.videoId);
  return { width: video?.width ?? c.ui.size.width, height: video?.height ?? c.ui.size.height };
}

/** Applies a finished brush or eraser stroke to the focused instance's mask. */
export function finishStroke(c: CanvasContext, points: EditorPoint[]): void {
  const { focusedInstanceId, focusedObservation } = c.d;
  if (!focusedInstanceId || points.length === 0) {
    return;
  }
  const { width, height } = sourceSize(c);
  const { brush } = c.ui;
  const pixels = points.map((p) => ({ x: p.x * width, y: p.y * height }));
  run(c, () => {
    const runs = strokeRuns(pixels, brush.radius, width, height);
    if (runs.area === 0) {
      return;
    }
    if (focusedObservation?.kind === "polygons") {
      throw new Error(c.t("convertBeforePainting"));
    }
    const mask = applyStroke(focusedObservation, runs, brush.mode);
    c.state.replaceMask(
      focusedInstanceId,
      mask,
      brush.mode === "paint" ? "opLabelBrush" : "opLabelErase",
    );
  });
}

/** Asks to convert a mask to polygons, directly when nothing is lost. */
export function openPolygonConversion(c: CanvasContext, instanceId: string): void {
  const { frameId, document } = c.d;
  const observation =
    frameId != undefined ? document?.annotations[frameInstanceKey(frameId, instanceId)] : undefined;
  if (observation?.kind !== "mask") {
    return;
  }
  run(c, () => {
    const loss = maskConversionLoss(observation.mask);
    // Lossless conversions need no confirmation.
    if (loss.lostPixels === 0 && loss.addedPixels === 0 && loss.holes === 0) {
      c.state.convertToPolygons(instanceId);
      c.ui.setNotice(c.t("convertedMaskPolygons"));
    } else {
      c.ui.setConversion({ instanceId, loss });
    }
  });
}

/** Makes this canvas' frame the one that receives edits; false when it must not. */
export function claimShownFrame(c: CanvasContext): boolean {
  const { draftElsewhere, activeFrameId } = c.d;
  const shownFrameId = c.props.frameId;
  if (draftElsewhere || shownFrameId == undefined || shownFrameId === activeFrameId) {
    return !draftElsewhere;
  }
  const live = c.store.getState();
  try {
    if (live.drawing != undefined) {
      if (c.host.session.getState().strokeFrameId != undefined) {
        return false;
      }
      live.retargetDrawing(shownFrameId);
    } else {
      live.setCurrentFrame(shownFrameId);
    }
  } catch (err) {
    c.ui.setError(segmentationErrorText(err));
    return false;
  }
  c.props.onClaimFocus?.();
  return true;
}

/** Remembers which frame the drawing started on, once its first point is placed. */
export function markStrokeFrame(c: CanvasContext): void {
  if (c.host.session.getState().strokeFrameId == undefined) {
    c.host.session.setState({ strokeFrameId: c.props.frameId ?? c.d.frameId });
  }
}

export function switchTool(c: CanvasContext, next: CreationTool): void {
  if (next === c.d.tool) {
    return;
  }
  c.ui.setDraft([]);
  c.host.session.setState({ strokeFrameId: undefined });
  run(c, () => {
    c.state.setCreationTool(next);
  });
}

/** Commits the quick mask or the drawn polygon of the drawing in progress. */
export function finishDrawing(c: CanvasContext): void {
  const { drawing, locked, frameId, document, quickMode } = c.d;
  const { quickBusy, quickResult, draft } = c.ui;
  if (!drawing || locked || !frameId) {
    return;
  }
  const before = document?.annotations[frameInstanceKey(frameId, drawing.instanceId)]?.kind;
  if (quickMode) {
    if (quickBusy) {
      c.ui.setError(c.t("maskStillComputing"));
      return;
    }
    if (!quickResult) {
      c.ui.setError(c.t("quickClickFirst"));
      return;
    }
    const mask = { ...quickResult.mask, source: "quick" as const };
    run(c, () => {
      c.state.addMask(drawing.instanceId, mask);
      if (before === "polygons") {
        c.ui.setNotice(c.t("polygonsMergedIntoMask"));
      }
    });
    c.host.session.setState({ strokeFrameId: undefined });
    return;
  }
  if (draft.length < 3) {
    c.ui.setError(c.t("addThreeVertices"));
    return;
  }
  if (!hasPolygonArea(draft)) {
    c.ui.setError(c.t("verticesZeroArea"));
    return;
  }
  run(c, () => {
    c.state.addPolygon(drawing.instanceId, draft);
    c.ui.setDraft([]);
    if (before === "mask") {
      c.ui.setNotice(c.t("polygonRasterized"));
    }
  });
  c.host.session.setState({ strokeFrameId: undefined });
}

/** Enter on a selected polygon: start editing it. */
export function enterEditMode(c: CanvasContext): void {
  const { locked, document, frameId } = c.d;
  if (locked) {
    return;
  }
  const { selection, focus } = c.state;
  const polygonId =
    selection.find(
      (node) =>
        node.type === "polygon" && findPolygonOwner(document, frameId, node.id) != undefined,
    )?.id ?? (focus?.type === "polygon" ? focus.id : undefined);
  if (polygonId) {
    run(c, () => {
      beginPolygonEdit(c.store.getState(), polygonId);
    });
  }
}

/** Double-clicking a polygon edits it. */
export function doubleClickPolygon(
  c: CanvasContext,
  event: ReactMouseEvent<SVGElement>,
  polygonId: string,
): void {
  const { locked, navigationLocked, drawing } = c.d;
  if (
    locked ||
    navigationLocked ||
    drawing ||
    c.ui.panTool ||
    c.ui.peekOriginal ||
    event.button !== 0
  ) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  run(c, () => {
    beginPolygonEdit(c.store.getState(), polygonId);
  });
}

/**
 * Double-clicking a mask (drawn on the GPU, so no SVG element receives it) edits that instance's
 * mask on this frame with the brush. It stays a mask: converting to polygons is explicit.
 */
export function doubleClickMask(c: CanvasContext, event: ReactMouseEvent<SVGSVGElement>): void {
  const { locked, navigationLocked, drawing, document, frameId } = c.d;
  const { focus, selection, viewMode } = c.state;
  if (
    locked ||
    navigationLocked ||
    drawing ||
    c.ui.panTool ||
    c.ui.peekOriginal ||
    event.button !== 0 ||
    viewMode === "original" ||
    !document ||
    frameId == undefined
  ) {
    return;
  }
  const at = pointOf(c, event);
  if (!at) {
    return;
  }
  // Topmost first, matching the overlay: a selected instance, then the highest slot.
  const candidates = document.instances
    .filter((instance) => {
      const mask = maskOf(document.annotations[frameInstanceKey(frameId, instance.id)]);
      return (
        mask != undefined &&
        (viewMode === "all" || focus?.id === instance.id || focus?.id === instance.classId) &&
        maskContains(runsOfMask(mask), at.x * mask.width, at.y * mask.height)
      );
    })
    .reverse();
  const hit =
    candidates.find((instance) =>
      selection.some((ref) => ref.id === instance.id || ref.id === instance.classId),
    ) ?? candidates[0];
  if (!hit || !claimShownFrame(c)) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  run(c, () => {
    const live = c.store.getState();
    live.setFocus({ type: "instance", id: hit.id });
    live.setSelection([{ type: "instance", id: hit.id }]);
    if (live.viewMode === "original") {
      live.setViewMode("all");
    }
    live.setEditing(true);
  });
}
