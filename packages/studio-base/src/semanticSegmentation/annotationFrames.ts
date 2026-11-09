// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Annotation sample grid. Honeybee video frames already carry their own `durationNs`, and the
 * playback bar steps by `SEEK_STEP_MS` (100ms when unset). This is not that clock: while a
 * session is closed, arrows keep using the seek step. While a session is open, they step these
 * samples instead. There is no fixed frame interval on the record to copy.
 */
export const ANNOTATION_FRAME_INTERVAL_SEC = 0.1;

/** Geometry is fetched in this many seconds. The preview must not treat a neighbor window as loaded. */
export const ANNOTATION_WINDOW_SEC = 10;

const ON_SAMPLE_SEC = 0.0005;

/**
 * One real message time per grid point: the latest message at or before that point,
 * and after the previous point. A grid point with no message is skipped.
 */
export function annotationSampleTimes(
  messageTimesSec: readonly number[],
  intervalSec = ANNOTATION_FRAME_INTERVAL_SEC,
): number[] {
  if (intervalSec <= 0) {
    return [];
  }
  const buckets = new Map<number, number>();
  for (const time of messageTimesSec) {
    if (!Number.isFinite(time) || time < -ON_SAMPLE_SEC) {
      continue;
    }
    const index = Math.ceil(Math.max(0, time - ON_SAMPLE_SEC) / intervalSec);
    const grid = index * intervalSec;
    if (time > grid + ON_SAMPLE_SEC) {
      continue;
    }
    const previous = buckets.get(index);
    if (previous == undefined || time > previous) {
      buckets.set(index, time);
    }
  }
  return [...buckets.entries()].sort((left, right) => left[0] - right[0]).map(([, time]) => time);
}

/** Undefined means the clock is already on a sample, or there is nowhere to land. */
export function snapAnnotationTime(
  currentSec: number,
  samples: readonly number[],
  mode: "pause" | "nearest",
): number | undefined {
  if (!Number.isFinite(currentSec) || samples.length === 0) {
    return undefined;
  }
  if (samples.some((sample) => Math.abs(sample - currentSec) <= ON_SAMPLE_SEC)) {
    return undefined;
  }
  if (mode === "pause") {
    let best: number | undefined;
    for (const sample of samples) {
      if (sample <= currentSec + ON_SAMPLE_SEC && (best == undefined || sample > best)) {
        best = sample;
      }
    }
    return best;
  }
  let best = samples[0]!;
  for (const sample of samples) {
    if (Math.abs(sample - currentSec) < Math.abs(best - currentSec)) {
      best = sample;
    }
  }
  return best;
}

/** Start of the 10s geometry window that contains this offset. */
export function previewWindowStartSec(offsetSec: number): number | undefined {
  if (!Number.isFinite(offsetSec)) {
    return undefined;
  }
  return Math.floor(Math.max(0, offsetSec) / ANNOTATION_WINDOW_SEC) * ANNOTATION_WINDOW_SEC;
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
