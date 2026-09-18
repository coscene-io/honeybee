// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { timestampDate } from "@bufbuild/protobuf/wkt";

import { fromDate, type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import { durationToSeconds } from "@foxglove/studio-base/util/time";

export function eventListDetails(
  event: TimelinePositionedEvent,
  formatTime: (time: Time) => string,
): { triggerTime: string; duration: string; search: string[] } {
  const triggerTime = formatTime(
    event.event.triggerTime == undefined
      ? { sec: 0, nsec: 0 }
      : fromDate(timestampDate(event.event.triggerTime)),
  );
  const duration = `${durationToSeconds(event.event.duration).toFixed(3)} s`;
  return {
    triggerTime,
    duration,
    search: [
      event.event.displayName,
      triggerTime,
      duration,
      event.event.description,
      ...Object.entries(event.event.customizedFields).flat(),
    ].map((field) => field.toLowerCase()),
  };
}

/** Preserve insertion order and group names while appending in linear time. */
export function groupEvents(
  events: readonly TimelinePositionedEvent[],
): Map<string, TimelinePositionedEvent[]> {
  const groups = new Map<string, TimelinePositionedEvent[]>();
  for (const event of events) {
    const key = `${event.projectDisplayName}/${event.recordDisplayName}`;
    let group = groups.get(key);
    if (group == undefined) {
      group = [];
      groups.set(key, group);
    }
    group.push(event);
  }
  return groups;
}
