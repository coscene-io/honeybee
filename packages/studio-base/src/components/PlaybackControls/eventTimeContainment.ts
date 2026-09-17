// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

export function isPlaybackSecondsInEvent({
  playbackSeconds,
  event,
  timelineDurationSeconds,
}: {
  playbackSeconds: number;
  event: TimelinePositionedEvent;
  timelineDurationSeconds: number;
}): boolean {
  const eventStartSec = event.secondsSinceStart;
  const recordingStartSec = toSec(event.startTime) - event.secondsSinceStart;
  const eventEndSec = toSec(event.endTime) - recordingStartSec;

  if (eventStartSec === eventEndSec) {
    return playbackSeconds === eventStartSec;
  }

  return (
    playbackSeconds >= eventStartSec &&
    (playbackSeconds < eventEndSec ||
      (playbackSeconds === timelineDurationSeconds && eventEndSec === timelineDurationSeconds))
  );
}
