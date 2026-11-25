// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationViewControls } from "../../imageSource";
import { runsOfMask } from "../../maskGeometry";
import type { EditorPoint } from "../editorGeometry";
import { focusContains } from "../polygonEdit";
import { cancelGesture } from "./canvasActions";
import { fitToBounds, toScreen } from "./canvasMath";
import type { CanvasContext } from "./canvasUi";
import { hitTarget } from "./vertexEditing";

/** Over the Image panel the view is the panel's camera; drive it instead of our own zoom. */
export function panelView(c: CanvasContext): SegmentationViewControls | undefined {
  return c.props.decodedFrame?.viewControls;
}

/**
 * Presses that belong to the Image panel alone: middle button, Space or the pan tool, and a
 * left press on empty canvas when not editing. While editing, a left drag on empty canvas
 * box-selects vertices (handled by the canvas); right-drag pans.
 */
export function nativePanOnly(
  c: CanvasContext,
  event: { button: number; clientX: number; clientY: number },
): boolean {
  return (
    event.button === 1 ||
    c.ui.space.current ||
    c.ui.panTool ||
    (event.button === 0 && !c.d.drawing && !c.state.editing && !hitTarget(c, event))
  );
}

export function viewportCenter(c: CanvasContext): EditorPoint | undefined {
  const bounds = c.ui.viewport.current?.getBoundingClientRect();
  return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : undefined;
}

export function zoomAt(c: CanvasContext, next: number, client?: EditorPoint): void {
  const native = panelView(c);
  const at = client ?? viewportCenter(c);
  if (!c.d.navigationLocked && native && at && c.ui.zoom > 0) {
    native.zoom(next / c.ui.zoom, at.x, at.y);
  }
}

export function fit(c: CanvasContext): void {
  if (c.d.navigationLocked) {
    return;
  }
  panelView(c)?.reset();
}

/** Normalized corners of everything in the edit scope on this frame. */
function scopePoints(c: CanvasContext): EditorPoint[] {
  const { document, frameId, inFocus } = c.d;
  return Object.values(document?.annotations ?? {})
    .filter((a) => a.frameId === frameId)
    .flatMap((a) => {
      if (a.kind === "mask") {
        // A mask observation in focus contributes its bounding box.
        const box = focusContains(document, c.state.focus, frameId, a.instanceId, "")
          ? runsOfMask(a.mask).bbox
          : undefined;
        return box
          ? [
              { x: box.x0 / a.mask.width, y: box.y0 / a.mask.height },
              { x: (box.x1 + 1) / a.mask.width, y: (box.y1 + 1) / a.mask.height },
            ]
          : [];
      }
      return a.polygons.filter((p) => inFocus(a.instanceId, p.id)).flatMap((p) => p.points);
    });
}

/** Zooms and centers the Image panel's camera on the edit scope. */
export function fitSelection(c: CanvasContext): void {
  if (c.d.navigationLocked) {
    return;
  }
  cancelGesture(c.ui);
  const points = scopePoints(c);
  const bounds = c.ui.viewport.current?.getBoundingClientRect();
  if (!bounds || points.length === 0) {
    return;
  }
  // Selection bounds on screen through the native transform, then zoom and center them.
  const native = panelView(c);
  const matrix = c.ui.content.current?.getScreenCTM();
  if (!native || !matrix) {
    return;
  }
  const { size } = c.ui;
  const target = fitToBounds(
    points.map((p) => toScreen(matrix, p, size.width, size.height)),
    bounds,
  );
  native.zoom(target.ratio, target.center.x, target.center.y);
  native.panBy(target.panX, target.panY);
}
