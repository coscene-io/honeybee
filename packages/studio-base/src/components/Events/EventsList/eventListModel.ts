// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import type { Slots } from "@foxglove/studio-base/context/WorkspaceSlots";
import { durationToSeconds } from "@foxglove/studio-base/util/time";

export function eventListDetails(
  event: TimelinePositionedEvent,
  formatTime: (time: Time) => string,
  searchLabels: readonly Slots["momentValueSearchLabels"][string][] = [],
): { triggerTime: string; duration: string; search: string[] } {
  const triggerTime = formatTime(event.startTime);
  const duration = `${durationToSeconds(event.event.duration).toFixed(3)} s`;
  const search = [event.event.displayName, triggerTime, duration, event.event.description];
  for (const [key, value] of Object.entries(event.event.customizedFields)) {
    search.push(key, value);
    for (const labelForValue of searchLabels) {
      const label = labelForValue(value);
      if (label != undefined) {
        search.push(label);
      }
    }
  }
  return { triggerTime, duration, search: search.map((field) => field.toLowerCase()) };
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
