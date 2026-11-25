// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand";

import { treeFrameIdsOf } from "./treeLogic";
import type { TreeState } from "./treeState";
import type { SegmentationSurface } from "../../runtime";
import { useSegmentationHost, useSegmentationSession } from "../../segmentationHostContext";
import { frameIndexOf } from "../../spatialTreeIndex";
import type { FrameIndex } from "../../spatialTreeIndex";
import { filterSegmentationSelection } from "../../store";
import type { SegmentationNodeRef, SemanticSegmentationStore } from "../../types";
import { preloadCameraStrip } from "../CameraFrameStrip";

export type TreeIndex = {
  document: TreeState["document"];
  index: FrameIndex | undefined;
  surfaces: Record<string, SegmentationSurface>;
  treeFrameIds: string[];
  /** The multi-camera tree; otherwise a single video with a presence row around its frame. */
  overview: boolean;
  selection: SegmentationNodeRef[];
  /** Identifies the view a drag or dialog started in. */
  contextKey: string;
};

/** The document, its frame index, the frames the tree lists and the filtered selection. */
export function useTreeIndex(state: TreeState): TreeIndex {
  const surfaces = useSegmentationSession((session) => session.surfaces);
  const sessionOpen = useSegmentationSession((session) => session.open);
  const previewFrames = useSegmentationSession((session) => session.previewFrames);
  const document = state.document;
  const index = document ? frameIndexOf(document) : undefined;
  const treeFrameIds = treeFrameIdsOf({
    sessionOpen,
    surfaces,
    previewFrames,
    frameById: index?.frameById,
    currentFrameId: state.currentFrameId,
  });
  const overview = sessionOpen || Object.keys(previewFrames).length > 0;
  const selection: SegmentationNodeRef[] = document
    ? filterSegmentationSelection(document, state.selection, state.currentFrameId)
    : [];
  const videoId =
    state.currentFrameId == undefined
      ? undefined
      : index?.frameById.get(state.currentFrameId)?.videoId;
  const contextKey = `${document?.record.id}:${videoId}:${state.currentFrameId}:${state.viewMode}:${state.focus?.type}:${state.focus?.id}`;
  return { document, index, surfaces, treeFrameIds, overview, selection, contextKey };
}

/**
 * Strips decide whether to show from the frames read around the shown frame, so every camera the
 * tree lists is read, including strips that are scrolled out of view.
 */
export function useStripPreload({
  document,
  overview,
  treeFrameIds,
}: Pick<TreeIndex, "document" | "overview" | "treeFrameIds">): void {
  const { sourceFrames } = useSegmentationHost();
  const stripFramesKey =
    overview && document && document.instances.length > 0 ? treeFrameIds.join("\u0000") : "";
  const latestDocument = useRef(document);
  latestDocument.current = document;
  useEffect(() => {
    const current = latestDocument.current;
    if (!current || stripFramesKey === "") {
      return;
    }
    for (const id of stripFramesKey.split("\u0000")) {
      preloadCameraStrip(current, id, sourceFrames);
    }
  }, [stripFramesKey, sourceFrames]);
}

/** Clears component-owned transient work when the store asks for an interaction reset. */
export function useInteractionReset(
  store: StoreApi<SemanticSegmentationStore>,
  version: number,
  reset: () => void,
): void {
  const previous = useRef({ store, version });
  const latestReset = useRef(reset);
  latestReset.current = reset;
  useEffect(() => {
    const before = previous.current;
    previous.current = { store, version };
    // A store switch retains the existing stale-session rejection UI. Only an explicit reset
    // within the same store discards component-owned transient work.
    if (before.store !== store || before.version === version) {
      return;
    }
    latestReset.current();
  }, [store, version]);
}
