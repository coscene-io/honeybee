// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationRuntime, SegmentationSession } from "../runtime";

/**
 * Removes an Image panel's surface from the session. When that panel held the edit (`owned` is
 * the session's runtime) and another surface remains, the edit passes to it: the session points
 * at the successor, and the store's current frame moves to the successor's frame, so frame-scoped
 * actions never act on the camera that went away. Without a successor the session closes.
 */
export function removeSegmentationSurface(
  session: SegmentationSession,
  panelId: string,
  owned: SegmentationRuntime | undefined,
): void {
  if (!owned && session.getState().surfaces[panelId] == undefined) {
    return;
  }
  session.setState((state) => {
    const surfaces = { ...state.surfaces };
    delete surfaces[panelId];
    const successor = Object.keys(surfaces)[0];
    if (!owned || successor == undefined) {
      return owned
        ? {
            open: false,
            imageUrl: undefined,
            decodedFrame: undefined,
            panelId: undefined,
            sourceReady: false,
            surfaces: {},
          }
        : { surfaces };
    }
    const next = surfaces[successor]!;
    return {
      surfaces,
      panelId: successor,
      imageUrl: next.imageUrl,
      decodedFrame: next.decodedFrame,
      sourceReady: next.sourceReady,
    };
  });
  const { panelId: successor, surfaces } = session.getState();
  const frameId = successor == undefined ? undefined : surfaces[successor]?.frameId;
  const store = owned?.store.getState();
  if (
    !store ||
    frameId == undefined ||
    store.currentFrameId === frameId ||
    store.document?.frames.some((frame) => frame.id === frameId) !== true ||
    // A running propagation moves the frame itself; the successor follows it.
    store.propagation.status === "running" ||
    store.propagation.status === "stopping"
  ) {
    return;
  }
  store.setCurrentFrame(frameId);
}
