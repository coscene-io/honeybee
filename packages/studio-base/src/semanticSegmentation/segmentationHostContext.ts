// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext } from "react";
import { useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

import type { CameraStepState } from "./cameraFrames";
import type { SegmentationMaskOverlay } from "./imageSource";
import type { MaskOverlayControls } from "./maskOverlay/overlaySource";
import type { SharedMaskPlanes } from "./maskOverlay/sharedMaskPlanes";
import type {
  SegmentationRegistry,
  SegmentationSession,
  SegmentationSessionState,
} from "./runtime";
import type { SegmentationChrome } from "./segmentationChrome";
import type { SourceFrameLoaders } from "./sourceFrames";

/**
 * Everything one spatial-annotation workspace shares between its image panels, sidebar and app
 * bar: the session (what is open, which panel edits), the runtime registry, and what later layers
 * add. It is created by whoever mounts the feature and reached through `SegmentationHostContext`;
 * there is no module-level instance. `createSegmentationHost` builds one.
 */
export type SegmentationHost = {
  session: SegmentationSession;
  registry: SegmentationRegistry;
  /** The live image panels that can open the annotation space. */
  chrome: SegmentationChrome;
  /** Playback-bar frame stepping state (the step still being decoded). */
  cameraStep: CameraStepState;
  /** The frame loader of each video bound to the open session, by video id. */
  sourceFrames: SourceFrameLoaders;
  /** Masks the editor publishes for every Image panel to draw. */
  maskOverlay: SegmentationMaskOverlay;
  /** Display controls of the editor's overlay, mirrored for the GPU layer. */
  maskOverlayControls: MaskOverlayControls;
  /** The mask-plane cache and worker shared by the host's Image panels. */
  maskPlanes: SharedMaskPlanes;
  /** Releases every runtime and listener the host holds. Called when its owner unmounts. */
  dispose: () => void;
};

export const SegmentationHostContext = createContext<SegmentationHost | undefined>(undefined);

/** The host of the enclosing workspace. Throws outside one (the feature is flag-gated). */
export function useSegmentationHost(): SegmentationHost {
  return useGuaranteedContext(SegmentationHostContext);
}

/** Reads the session with a selector, like `useCoreData`. */
export function useSegmentationSession<T>(selector: (state: SegmentationSessionState) => T): T {
  return useStore(useSegmentationHost().session, selector);
}
