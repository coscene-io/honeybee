// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { TFunction } from "i18next";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { SegmentationSurface } from "../../runtime";
import type {
  SegmentationDocument,
  SegmentationNodeRef,
  SemanticSegmentationStore,
} from "../../types";

/**
 * The store fields the tree reads (actions are stable). A whole-store subscription re-rendered the
 * tree for every queue, error and propagation-progress update.
 */
function pickTreeState(s: SemanticSegmentationStore) {
  return {
    addClass: s.addClass,
    addInstance: s.addInstance,
    currentFrameId: s.currentFrameId,
    deleteClass: s.deleteClass,
    deleteInstance: s.deleteInstance,
    deletePolygon: s.deletePolygon,
    document: s.document,
    drawing: s.drawing,
    editing: s.editing,
    focus: s.focus,
    interactionResetVersion: s.interactionResetVersion,
    loading: s.loading,
    mergeInstances: s.mergeInstances,
    mergePolygons: s.mergePolygons,
    moveInstance: s.moveInstance,
    propagationStatus: s.propagation.status,
    renameClass: s.renameClass,
    renameInstance: s.renameInstance,
    runTransaction: s.runTransaction,
    selection: s.selection,
    setCurrentFrame: s.setCurrentFrame,
    setEditing: s.setEditing,
    setFocus: s.setFocus,
    setSelection: s.setSelection,
    setViewMode: s.setViewMode,
    startDrawing: s.startDrawing,
    supportsInstanceMerge: s.supportsInstanceMerge,
    viewMode: s.viewMode,
  };
}

export type TreeState = ReturnType<typeof pickTreeState>;

export function useTreeState(store: StoreApi<SemanticSegmentationStore>): TreeState {
  return useStore(store, useShallow(pickTreeState));
}

/** What the tree's commands read, rebuilt every render so they always see current state. */
export type TreeEnv = {
  store: StoreApi<SemanticSegmentationStore>;
  state: TreeState;
  document: SegmentationDocument | undefined;
  surfaces: Record<string, SegmentationSurface>;
  selection: SegmentationNodeRef[];
  selecting: boolean;
  disabled: boolean;
  locked: boolean;
  contextKey: string;
  t: TFunction<"segmentation">;
  setError: (message: string | undefined) => void;
  run: (action: () => undefined) => void;
};
