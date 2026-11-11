// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { snapAnnotationTime } from "./annotationFrames";
import { segmentationSession } from "./runtime";

/**
 * While a segmentation session is open, the playback bar's back and forward buttons step by
 * annotation frame instead of by a fixed time. Returns undefined when no session is open (the
 * caller keeps its normal behavior). Otherwise `timestampSec` is the target frame's offset from
 * the player start, or undefined when there is nowhere to go (first or last frame, or the editor
 * is busy loading or propagating).
 */
export function segmentationFrameStep(
  direction: 1 | -1,
  count = 1,
): { timestampSec: number | undefined } | undefined {
  const session = segmentationSession.getState();
  const state = session.open ? session.runtime?.store.getState() : undefined;
  const document = state?.document;
  if (!state || !document) {
    return undefined;
  }
  const current = document.frames.find((frame) => frame.id === state.currentFrameId);
  if (!current) {
    return { timestampSec: undefined };
  }
  const busy =
    !session.sourceReady ||
    state.loading ||
    !state.isFrameReady(current.id) ||
    ["running", "stopping"].includes(state.propagation.status);
  if (busy) {
    return { timestampSec: undefined };
  }
  const videoFrames = document.frames
    .filter((frame) => frame.videoId === current.videoId)
    .sort((a, b) => a.index - b.index);
  const frames = videoFrames;
  const index = frames.findIndex((frame) => frame.id === current.id);
  if (index < 0) {
    return { timestampSec: undefined };
  }
  const target = frames[Math.min(frames.length - 1, Math.max(0, index + direction * count))];
  return { timestampSec: target && target.id !== current.id ? target.timestampSec : undefined };
}

/**
 * Where a pause or a committed seek should land, as seconds from the player start.
 * Only an open annotation session moves the playhead. The read-only preview does not.
 * Samples come from the current video, so another camera's message cannot win the same slot.
 */
export function segmentationCommitOffset(
  currentOffsetSec: number,
  mode: "pause" | "nearest",
): number | undefined {
  const session = segmentationSession.getState();
  if (!session.open) {
    return undefined;
  }
  const state = session.runtime?.store.getState();
  const document = state?.document;
  const current = document?.frames.find((frame) => frame.id === state?.currentFrameId);
  if (!state || !document || !current || state.loading) {
    return undefined;
  }
  if (state.drawingPolygonId != undefined || session.strokeFrameId != undefined) {
    return undefined;
  }
  const times = document.frames
    .filter((frame) => frame.videoId === current.videoId)
    .map((frame) => frame.timestampSec);
  return snapAnnotationTime(currentOffsetSec, times, mode);
}
