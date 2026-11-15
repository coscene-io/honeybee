// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SemanticSegmentationStore } from "../types";
import { polygonInstance } from "./editorTree";

export function focusContains(
  doc: SemanticSegmentationStore["document"],
  focus: SemanticSegmentationStore["focus"],
  frameId: string | undefined,
  instanceId: string,
  polygonId: string,
): boolean {
  if (!focus) {
    return false;
  }
  if (focus.type === "polygon") {
    const inFrame = Object.values(doc?.annotations ?? {}).some(
      (annotation) =>
        annotation.frameId === frameId &&
        annotation.polygons.some((polygon) => polygon.id === focus.id),
    );
    return inFrame
      ? focus.id === polygonId
      : doc != undefined && polygonInstance(doc, focus.id) === instanceId;
  }
  return focus.type === "instance"
    ? focus.id === instanceId
    : doc?.instances.some(
        (instance) => instance.id === instanceId && instance.classId === focus.id,
      ) === true;
}

/** Finds the polygon with this id in the given frame, with the instance that owns it. */
export function findPolygonOwner(
  doc: SemanticSegmentationStore["document"],
  frameId: string | undefined,
  polygonId: string,
): { instanceId: string; pointCount: number } | undefined {
  for (const annotation of Object.values(doc?.annotations ?? {})) {
    if (annotation.frameId !== frameId) {
      continue;
    }
    const polygon = annotation.polygons.find((item) => item.id === polygonId);
    if (polygon) {
      return { instanceId: annotation.instanceId, pointCount: polygon.points.length };
    }
  }
  return undefined;
}

/**
 * Starts editing a polygon of the current frame (or drawing it, when it has no vertices yet).
 * Shared by Enter on the canvas, Enter on the tree and double-click. Returns false when the
 * polygon is not in the current frame.
 */
export function beginPolygonEdit(state: SemanticSegmentationStore, polygonId: string): boolean {
  const found = findPolygonOwner(state.document, state.currentFrameId, polygonId);
  if (!found) {
    return false;
  }
  if (
    !focusContains(state.document, state.focus, state.currentFrameId, found.instanceId, polygonId)
  ) {
    state.setFocus({ type: "instance", id: found.instanceId });
  }
  const selected = state.selection.length === 1 && state.selection[0]?.id === polygonId;
  if (!selected) {
    state.setSelection([{ type: "polygon", id: polygonId }]);
  }
  if (state.viewMode === "original") {
    state.setViewMode("all");
  }
  if (found.pointCount === 0) {
    state.setDrawingPolygonId(polygonId);
  } else {
    state.setEditing(true);
  }
  return true;
}
