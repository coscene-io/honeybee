// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Geometry and frame lists are read in windows of this many seconds from the recording start (the
 * service caps ListFrames at ten seconds). The preview must not treat a neighbor window as loaded.
 */
export const ANNOTATION_WINDOW_SEC = 10;

/** The window that contains this offset, clipped to the recording. */
export function annotationWindow(
  offsetSec: number,
  durationSec: number,
): { startSec: number; endSec: number } {
  const startSec =
    Math.floor(Math.max(0, offsetSec) / ANNOTATION_WINDOW_SEC) * ANNOTATION_WINDOW_SEC;
  return { startSec, endSec: Math.min(startSec + ANNOTATION_WINDOW_SEC, durationSec) };
}

/** Start of the 10s geometry window that contains this offset. */
export function previewWindowStartSec(offsetSec: number): number | undefined {
  if (!Number.isFinite(offsetSec)) {
    return undefined;
  }
  return annotationWindow(offsetSec, Number.POSITIVE_INFINITY).startSec;
}

/**
 * True when this window has at least one frame whose geometry is not loaded yet.
 * A ready frame from the previous window does not count.
 */
export function previewWindowNeedsLoad<Frame extends { timestampSec: number }>(
  frames: readonly Frame[],
  isReady: (frame: Frame) => boolean,
  windowStartSec: number,
  durationSec: number,
): boolean {
  const end = Math.min(windowStartSec + ANNOTATION_WINDOW_SEC, durationSec);
  const inWindow = frames.filter(
    (frame) => frame.timestampSec >= windowStartSec && frame.timestampSec <= end,
  );
  return inWindow.length > 0 && inWindow.some((frame) => !isReady(frame));
}
