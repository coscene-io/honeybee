// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec, type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

/** Playback seconds between two absolute times, using the same toSec origin as event.secondsSinceStart. */
export function timelineDurationSeconds(startTime: Time, endTime: Time): number {
  return toSec(endTime) - toSec(startTime);
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
  // Keep both bounds on toSec(absolute) - toSec(recordingStart). Reconstructing the origin
  // as toSec(event.startTime) - secondsSinceStart drifts on leftover nanos and can match
  // both sides of a shared [start, end) boundary.
  const recordingStartSec = toSec(recordingStartTime);
  const eventStartSec = toSec(event.startTime) - recordingStartSec;
  const eventEndSec = toSec(event.endTime) - recordingStartSec;

  if (eventStartSec === eventEndSec) {
    return playbackSeconds === eventStartSec;
  }

  return (
    playbackSeconds >= eventStartSec &&
    (playbackSeconds < eventEndSec ||
      (playbackSeconds === durationSeconds && eventEndSec === durationSeconds))
  );
}
