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

import { partitionPoint } from "./MinimumIndex";

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

type OrderedBoundary = EventBoundaryCandidate & { order: number };
const boundaryIndexes = new WeakMap<TimelinePositionedEvent[], OrderedBoundary[]>();

function getEventBoundaryCandidates(events: TimelinePositionedEvent[]): OrderedBoundary[] {
  const cached = boundaryIndexes.get(events);
  if (cached != undefined) {
    return cached;
  }
  const candidates = events
    .flatMap((event, order) => [
      {
        eventName: event.event.name,
        position: event.startPosition,
        time: event.startTime,
        order: order * 2,
      },
      {
        eventName: event.event.name,
        position: event.endPosition,
        time: event.endTime,
        order: order * 2 + 1,
      },
    ])
    .filter(
      (candidate) =>
        Number.isFinite(candidate.position) && candidate.position >= 0 && candidate.position <= 1,
    )
    .sort((a, b) => (a.position === b.position ? a.order - b.order : a.position - b.position));
  boundaryIndexes.set(events, candidates);
  return candidates;
}

/** Uses the original gap comparison to include exact-threshold floating-point boundaries. */
export function nearbyBoundaries<T extends { position: number }>(
  candidates: readonly T[],
  position: number,
  threshold: number,
): readonly T[] {
  const first = partitionPoint(
    candidates.length,
    (index) =>
      candidates[index]!.position < position &&
      Math.abs(candidates[index]!.position - position) > threshold,
  );
  const last = partitionPoint(
    candidates.length,
    (index) =>
      candidates[index]!.position <= position ||
      Math.abs(candidates[index]!.position - position) <= threshold,
  );
  return candidates.slice(first, last);
}

export function getSnappedEventMark(args: GetSnappedEventMarkArgs): TimelinePositionedEventMark {
  const {
    eligibleEventNames,
    excludedEventName,
    mark,
    events,
    threshold = EVENT_SNAP_THRESHOLD,
  } = args;
  const candidates = nearbyBoundaries(getEventBoundaryCandidates(events), mark.position, threshold);

  let closestCandidate: OrderedBoundary | undefined;
  let smallestGap = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (
      candidate.eventName === excludedEventName ||
      (eligibleEventNames != undefined && !eligibleEventNames.has(candidate.eventName))
    ) {
      continue;
    }
    const gap = Math.abs(candidate.position - mark.position);
    if (
      gap <= threshold &&
      (gap < smallestGap ||
        (gap === smallestGap && candidate.order < (closestCandidate?.order ?? Infinity)))
    ) {
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
