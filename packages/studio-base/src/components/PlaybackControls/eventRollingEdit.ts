// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subtract, toSec } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

import { buildEventTimeUpdate, type EventTimeUpdate } from "./eventTimeEdit";
import { timeToFraction, type TimelineViewport } from "./timelineViewport";

export const MIN_ROLLING_EDIT_DURATION_SEC: number = 0;
export const ROLLING_EDIT_ADJACENCY_TOLERANCE_SEC: number = 0.01;
export const ROLLING_EDIT_HANDLE_HITBOX_PX: number = 10;

export type RollingEditPair = {
  key: string;
  previous: TimelinePositionedEvent;
  next: TimelinePositionedEvent;
  boundarySec: number;
};

export type RollingEditUpdate = EventTimeUpdate;

function compareEventStartTime(
  left: TimelinePositionedEvent,
  right: TimelinePositionedEvent,
): number {
  return toSec(left.startTime) - toSec(right.startTime);
}

function getRollingEditEventSequences({
  laneByEventName,
  events,
}: {
  laneByEventName?: ReadonlyMap<string, number>;
  events: TimelinePositionedEvent[];
}): TimelinePositionedEvent[][] {
  const sortedEvents = [...events].sort(compareEventStartTime);
  if (laneByEventName == undefined) {
    return [sortedEvents];
  }

  const eventsByLane = new Map<number, TimelinePositionedEvent[]>();
  for (const event of sortedEvents) {
    const lane = laneByEventName.get(event.event.name);
    if (lane == undefined) {
      continue;
    }

    const laneEvents = eventsByLane.get(lane);
    if (laneEvents == undefined) {
      eventsByLane.set(lane, [event]);
    } else {
      laneEvents.push(event);
    }
  }

  return Array.from(eventsByLane.values());
}

export function findRollingEditPairs({
  laneByEventName,
  events,
  viewport,
  width,
}: {
  laneByEventName?: ReadonlyMap<string, number>;
  events: TimelinePositionedEvent[];
  viewport: TimelineViewport;
  width: number;
}): RollingEditPair[] {
  if (width <= 0 || events.length < 2) {
    return [];
  }

  const eventSequences = getRollingEditEventSequences({ laneByEventName, events });
  const pairs: RollingEditPair[] = [];

  for (const sequence of eventSequences) {
    for (let i = 0; i < sequence.length - 1; i++) {
      const previous = sequence[i]!;
      const next = sequence[i + 1]!;
      const previousEndSec =
        previous.secondsSinceStart + toSec(subtract(previous.endTime, previous.startTime));
      const nextStartSec = next.secondsSinceStart;
      const timeGapSec = Math.abs(previousEndSec - nextStartSec);
      const pixelGap =
        Math.abs(
          timeToFraction(previousEndSec, viewport) - timeToFraction(nextStartSec, viewport),
        ) * width;

      if (
        timeGapSec <= ROLLING_EDIT_ADJACENCY_TOLERANCE_SEC &&
        pixelGap <= ROLLING_EDIT_HANDLE_HITBOX_PX
      ) {
        const boundarySec = (previousEndSec + nextStartSec) / 2;
        pairs.push({
          key: `${previous.event.name}:${next.event.name}`,
          previous,
          next,
          boundarySec,
        });
      }
    }
  }

  return pairs;
}

export function clampRollingEditBoundary(pair: RollingEditPair, boundarySec: number): number {
  const previousStartSec = pair.previous.secondsSinceStart;
  const nextEndSec =
    pair.next.secondsSinceStart + toSec(subtract(pair.next.endTime, pair.next.startTime));

  return Math.min(
    Math.max(boundarySec, previousStartSec + MIN_ROLLING_EDIT_DURATION_SEC),
    nextEndSec - MIN_ROLLING_EDIT_DURATION_SEC,
  );
}

export function buildRollingEditUpdates(
  pair: RollingEditPair,
  boundarySec: number,
): [RollingEditUpdate, RollingEditUpdate] {
  const clampedBoundarySec = clampRollingEditBoundary(pair, boundarySec);
  const nextEndSec =
    pair.next.secondsSinceStart + toSec(subtract(pair.next.endTime, pair.next.startTime));

  return [
    buildEventTimeUpdate({
      sourceEvent: pair.previous.event,
      startTime: pair.previous.startTime,
      durationSec: clampedBoundarySec - pair.previous.secondsSinceStart,
    }),
    buildEventTimeUpdate({
      sourceEvent: pair.next.event,
      startTime: pair.next.startTime,
      startTimeOffsetSec: clampedBoundarySec - pair.next.secondsSinceStart,
      durationSec: nextEndSec - clampedBoundarySec,
    }),
  ];
}
