// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import type React from "react";

import { toSec } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

import { MinimumIndex, partitionPoint } from "./MinimumIndex";
import { EVENT_LANE_HEIGHT_PX } from "./constants";
import { timeToFraction, type TimelineViewport } from "./timelineViewport";

export { EVENT_LANE_HEIGHT_PX } from "./constants";

export const EVENT_LANE_OVERLAP_TOLERANCE_FRACTION: number = 0.002;
export const EVENT_BAR_HEIGHT_PX: number = 24;
export const EVENT_BAR_TOP_OFFSET_PX: number = 2;
export const EVENT_MIN_WIDTH_PX: number = 4;

const EVENT_LANE_ADJACENCY_EPSILON_SEC = 2e-3;

export type EventLaneLayoutItem = {
  endPosition: number;
  endSec: number;
  isZeroDuration: boolean;
  lane: number;
  event: TimelinePositionedEvent;
  startPosition: number;
  startSec: number;
  widthPosition: number;
};

export type EventLaneLayout = {
  items: EventLaneLayoutItem[];
  laneCount: number;
};

type EventLaneCandidate = Omit<EventLaneLayoutItem, "lane">;

function getEventEndSec(event: TimelinePositionedEvent): number {
  return event.secondsSinceStart + (toSec(event.endTime) - toSec(event.startTime));
}

function areTimelineSecondsAdjacent(leftSec: number, rightSec: number): boolean {
  return Math.abs(leftSec - rightSec) <= EVENT_LANE_ADJACENCY_EPSILON_SEC;
}

function makeEventLaneCandidate(
  event: TimelinePositionedEvent,
  viewport: TimelineViewport,
): EventLaneCandidate | undefined {
  const startSec = event.secondsSinceStart;
  const endSec = getEventEndSec(event);
  const rawStartPosition = timeToFraction(startSec, viewport);
  const rawEndPosition = timeToFraction(endSec, viewport);

  if (!Number.isFinite(rawStartPosition) || !Number.isFinite(rawEndPosition)) {
    return undefined;
  }

  if (rawEndPosition < 0 || rawStartPosition > 1) {
    return undefined;
  }

  const startPosition = _.clamp(rawStartPosition, 0, 1);
  const endPosition = _.clamp(rawEndPosition, 0, 1);

  return {
    endPosition,
    endSec,
    isZeroDuration: startSec === endSec,
    event,
    startPosition,
    startSec,
    widthPosition: Math.max(endPosition - startPosition, 0),
  };
}

export function layoutEventLanes({
  events,
  viewport,
}: {
  events: TimelinePositionedEvent[];
  viewport: TimelineViewport;
}): EventLaneLayout {
  const candidates = events
    .map((event) => makeEventLaneCandidate(event, viewport))
    .filter((candidate): candidate is EventLaneCandidate => candidate != undefined)
    .sort((left, right) => {
      if (left.startPosition !== right.startPosition) {
        return left.startPosition - right.startPosition;
      }
      if (left.endPosition !== right.endPosition) {
        return left.endPosition - right.endPosition;
      }
      return left.event.event.name.localeCompare(right.event.event.name);
    });

  // One slot per candidate (including equal ends). Only each lane's current tail has
  // a finite value. This avoids heaps and preserves first-fit lane selection exactly.
  const ends = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => a.candidate.endSec - b.candidate.endSec);
  const coordinateByCandidate = new Map(ends.map((entry, coordinate) => [entry.index, coordinate]));
  const minimums = new MinimumIndex(ends.length);
  const laneTails: number[] = [];
  const items: EventLaneLayoutItem[] = [];

  candidates.forEach((candidate, candidateIndex) => {
    const ordinaryEnd = partitionPoint(
      ends.length,
      (i) =>
        ends[i]!.candidate.endPosition + EVENT_LANE_OVERLAP_TOLERANCE_FRACTION <=
        candidate.startPosition - EVENT_LANE_OVERLAP_TOLERANCE_FRACTION,
    );
    // Use the original subtraction/comparison, rather than rounded start +/- epsilon.
    const adjacentStart = partitionPoint(
      ends.length,
      (i) =>
        ends[i]!.candidate.endSec < candidate.startSec &&
        !areTimelineSecondsAdjacent(ends[i]!.candidate.endSec, candidate.startSec),
    );
    const adjacentEnd = partitionPoint(
      ends.length,
      (i) =>
        ends[i]!.candidate.endSec <= candidate.startSec ||
        areTimelineSecondsAdjacent(ends[i]!.candidate.endSec, candidate.startSec),
    );
    const available = Math.min(
      minimums.minimum(0, ordinaryEnd),
      minimums.minimum(adjacentStart, adjacentEnd),
    );
    const lane = Number.isFinite(available) ? available : laneTails.length;
    const oldTail = laneTails[lane];
    if (oldTail != undefined) {
      minimums.set(oldTail, Infinity);
    }
    const coordinate = coordinateByCandidate.get(candidateIndex)!;
    laneTails[lane] = coordinate;
    minimums.set(coordinate, lane);
    items.push({ ...candidate, lane });
  });
  return { items, laneCount: laneTails.length };
}

const layouts = new WeakMap<
  TimelinePositionedEvent[],
  { key: string; layout: EventLaneLayout }[]
>();

/** Share only the two most recent viewports for each immutable snapshot. */
export function getCachedEventLaneLayout(args: {
  events: TimelinePositionedEvent[];
  viewport: TimelineViewport;
}): EventLaneLayout {
  const { events, viewport } = args;
  const key = `${viewport.totalStartSec}:${viewport.totalEndSec}:${viewport.visibleStartSec}:${viewport.visibleEndSec}`;
  const cached = layouts.get(events) ?? [];
  const match = cached.find((entry) => entry.key === key);
  if (match != undefined) {
    return match.layout;
  }
  const layout = layoutEventLanes(args);
  layouts.set(events, [{ key, layout }, ...cached.slice(0, 1)]);
  return layout;
}

const layoutIndexes = new WeakMap<
  EventLaneLayout,
  {
    byName: Map<string, EventLaneLayoutItem>;
    byLane: EventLaneLayoutItem[][];
  }
>();

export function indexEventLanes(layout: EventLaneLayout): {
  byName: Map<string, EventLaneLayoutItem>;
  byLane: EventLaneLayoutItem[][];
} {
  let index = layoutIndexes.get(layout);
  if (index == undefined) {
    const byName = new Map<string, EventLaneLayoutItem>();
    const byLane: EventLaneLayoutItem[][] = Array.from({ length: layout.laneCount }, () => []);
    for (const item of layout.items) {
      byName.set(item.event.event.name, item);
      byLane[item.lane]!.push(item);
    }
    index = { byName, byLane };
    layoutIndexes.set(layout, index);
  }
  return index;
}

export function getEventLaneByName(layout: EventLaneLayout, eventName: string): number | undefined {
  return indexEventLanes(layout).byName.get(eventName)?.lane;
}

/** Preserve memoized ticks when a drag only changes a subset of the complete layout. */
export function reuseEventLaneItems(
  layout: EventLaneLayout,
  previous: EventLaneLayout,
): EventLaneLayout {
  if (layout === previous) {
    return layout;
  }
  const oldItems = indexEventLanes(previous).byName;
  return {
    ...layout,
    items: layout.items.map((item) => {
      const old = oldItems.get(item.event.event.name);
      return old?.event === item.event &&
        old.lane === item.lane &&
        old.startPosition === item.startPosition &&
        old.endPosition === item.endPosition &&
        old.startSec === item.startSec &&
        old.endSec === item.endSec
        ? old
        : item;
    }),
  };
}

export function getEventLaneRenderStyle(
  item: EventLaneLayoutItem,
): React.CSSProperties & { minWidth: number } {
  return {
    height: EVENT_BAR_HEIGHT_PX,
    left: `${item.startPosition * 100}%`,
    minWidth: EVENT_MIN_WIDTH_PX,
    top: `${item.lane * EVENT_LANE_HEIGHT_PX + EVENT_BAR_TOP_OFFSET_PX}px`,
    width: `max(${item.widthPosition * 100}%, ${EVENT_MIN_WIDTH_PX}px)`,
  };
}
