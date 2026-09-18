// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subtract, toSec, type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

/** Subtract before conversion to preserve the relative-time axis used by synchronized charts. */
export function timelineDurationSeconds(startTime: Time, endTime: Time): number {
  return toSec(subtract(endTime, startTime));
}

export function isPlaybackSecondsInEvent({
  playbackSeconds,
  event,
  recordingStartTime,
  durationSeconds,
}: {
  playbackSeconds: number;
  event: TimelinePositionedEvent;
  recordingStartTime: Time;
  durationSeconds: number;
}): boolean {
  // Derive each bound directly from the same Time origin. Adding a converted duration
  // to the start offset can drift at shared boundaries and at the recording end.
  const eventStartSec = timelineDurationSeconds(recordingStartTime, event.startTime);
  const eventEndSec = timelineDurationSeconds(recordingStartTime, event.endTime);

  return isSecondsInRange(playbackSeconds, eventStartSec, eventEndSec, durationSeconds);
}

/**
 * Numeric extension timestamps have already lost sub-ULP precision. Compare their bounds at
 * that same precision rather than inventing nanoseconds by converting the input back to Time.
 */
export function isAbsoluteSecondsInEvent({
  absoluteSeconds,
  event,
  recordingEndTime,
}: {
  absoluteSeconds: number;
  event: TimelinePositionedEvent;
  recordingEndTime: Time;
}): boolean {
  return isSecondsInRange(
    absoluteSeconds,
    toSec(event.startTime),
    toSec(event.endTime),
    toSec(recordingEndTime),
  );
}

export function isSecondsInRange(
  seconds: number,
  eventStartSec: number,
  eventEndSec: number,
  timelineEndSec: number,
): boolean {
  if (eventStartSec === eventEndSec) {
    return seconds === eventStartSec;
  }

  return (
    seconds >= eventStartSec &&
    (seconds < eventEndSec || (seconds === timelineEndSec && eventEndSec === timelineEndSec))
  );
}
