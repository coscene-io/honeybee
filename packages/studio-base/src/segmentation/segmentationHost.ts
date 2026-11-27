// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSegmentationMaskOverlay } from "./imageSource";
import { clearMaskGeometryCaches } from "./maskGeometry";
import { createMaskOverlayControls, installMaskOverlaySource } from "./maskOverlay/overlaySource";
import { createSharedMaskPlanes } from "./maskOverlay/sharedMaskPlanes";
import { createSegmentationRegistry, createSegmentationSession } from "./runtime";
import type { SegmentationHost } from "./segmentationHostContext";
import { createSourceFrameLoaders } from "./sourceFrames";

/** A new, empty host: its own session and runtime registry, shared by nothing else. */
export function createSegmentationHost(): SegmentationHost {
  const session = createSegmentationSession();
  const registry = createSegmentationRegistry(session);
  const maskOverlay = createSegmentationMaskOverlay();
  const maskOverlayControls = createMaskOverlayControls();
  const maskPlanes = createSharedMaskPlanes();
  const uninstallOverlay = installMaskOverlaySource({
    session,
    overlay: maskOverlay,
    controls: maskOverlayControls,
  });
  return {
    session,
    registry,
    sourceFrames: createSourceFrameLoaders(),
    maskOverlay,
    maskOverlayControls,
    maskPlanes,
    dispose: () => {
      uninstallOverlay();
      registry.dispose();
      maskPlanes.dispose();
      clearMaskGeometryCaches();
    },
  };
}
