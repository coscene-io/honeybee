// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { SegmentationStore } from "../../types";

/**
 * The store fields the canvas reads (actions are stable): a whole-store subscription re-rendered
 * this component for every queue, error and propagation-progress update.
 */
function pickCanvasState(s: SegmentationStore) {
  return {
    addMask: s.addMask,
    addPolygon: s.addPolygon,
    cancelDrawing: s.cancelDrawing,
    convertToMask: s.convertToMask,
    convertToPolygons: s.convertToPolygons,
    creationTool: s.creationTool,
    currentFrameId: s.currentFrameId,
    document: s.document,
    drawing: s.drawing,
    editing: s.editing,
    focus: s.focus,
    interactionResetVersion: s.interactionResetVersion,
    propagationStatus: s.propagation.status,
    replaceMask: s.replaceMask,
    runTransaction: s.runTransaction,
    selection: s.selection,
    setCreationTool: s.setCreationTool,
    setEditing: s.setEditing,
    setFocus: s.setFocus,
    setPolygonPoints: s.setPolygonPoints,
    setSelection: s.setSelection,
    stagedOperations: s.stagedOperations,
    viewMode: s.viewMode,
  };
}

export type CanvasState = ReturnType<typeof pickCanvasState>;

export function useCanvasState(store: StoreApi<SegmentationStore>): CanvasState {
  return useStore(store, useShallow(pickCanvasState));
}
