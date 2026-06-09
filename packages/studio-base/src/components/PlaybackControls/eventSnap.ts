// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Time } from "@foxglove/rostime";
import type {
  TimelinePositionedEvent,
  TimelinePositionedEventMark,
} from "@foxglove/studio-base/context/EventsContext";

export const EVENT_SNAP_THRESHOLD: number = 0.01;

export type EventBoundaryCandidate = {
  eventName: string;
  position: number;
  time: Time;
};

export type GetSnappedEventMarkArgs = {
  eligibleEventNames?: ReadonlySet<string>;
  excludedEventName?: string;
  mark: TimelinePositionedEventMark;
  events: TimelinePositionedEvent[];
  threshold?: number;
};

function getEventBoundaryCandidates(
  events: TimelinePositionedEvent[],
  excludedEventName?: string,
  eligibleEventNames?: ReadonlySet<string>,
): EventBoundaryCandidate[] {
  return events
    .filter(
      (event) =>
        event.event.name !== excludedEventName &&
        (eligibleEventNames == undefined || eligibleEventNames.has(event.event.name)),
    )
    .flatMap((event) => [
      {
        eventName: event.event.name,
        position: event.startPosition,
        time: event.startTime,
      },
      {
        eventName: event.event.name,
        position: event.endPosition,
        time: event.endTime,
      },
    ])
    .filter(
      (candidate) =>
        Number.isFinite(candidate.position) && candidate.position >= 0 && candidate.position <= 1,
    );
}

export function getSnappedEventMark(args: GetSnappedEventMarkArgs): TimelinePositionedEventMark {
  const {
    eligibleEventNames,
    excludedEventName,
    mark,
    events,
    threshold = EVENT_SNAP_THRESHOLD,
  } = args;
  const candidates = getEventBoundaryCandidates(events, excludedEventName, eligibleEventNames);

  let closestCandidate: EventBoundaryCandidate | undefined;
  let smallestGap = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const gap = Math.abs(candidate.position - mark.position);
    if (gap <= threshold && gap < smallestGap) {
      closestCandidate = candidate;
      smallestGap = gap;
    }
  }

  if (closestCandidate == undefined) {
    return mark;
  }

  return {
    ...mark,
    position: closestCandidate.position,
    time: closestCandidate.time,
  };
}
