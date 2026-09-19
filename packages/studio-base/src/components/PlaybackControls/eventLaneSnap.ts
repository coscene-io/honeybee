// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { EventLaneLayoutItem } from "./eventLanes";
import { EVENT_SNAP_THRESHOLD, nearbyBoundaries } from "./eventSnap";
import type { EventResizeEdge, EventTimeRange } from "./eventTimeEdit";
import { timeToFraction, type TimelineViewport } from "./timelineViewport";

type Boundary = { position: number; sec: number; order: number };

/** A gesture owns one lane cache. Unchanged neighbours reuse the sorted boundaries even when
 * the dragged event causes a new complete layout snapshot on every animation frame. */
export class LaneSnapCache {
  #items: EventLaneLayoutItem[] = [];
  #viewportKey = "";
  #candidates: Boundary[] = [];

  public clear(): void {
    this.#items = [];
    this.#candidates = [];
    this.#viewportKey = "";
  }

  public candidates(
    items: EventLaneLayoutItem[],
    lane: number,
    activeEventName: string,
    viewport: TimelineViewport,
  ): Boundary[] {
    const neighbours = items.filter(
      (item) => item.lane === lane && item.event.event.name !== activeEventName,
    );
    const viewportKey = `${viewport.visibleStartSec}:${viewport.visibleEndSec}`;
    if (
      viewportKey === this.#viewportKey &&
      neighbours.length === this.#items.length &&
      neighbours.every((item, index) => item === this.#items[index])
    ) {
      return this.#candidates;
    }
    this.#items = neighbours;
    this.#viewportKey = viewportKey;
    this.#candidates = neighbours
      .flatMap((item, order) => [
        { position: timeToFraction(item.startSec, viewport), sec: item.startSec, order: order * 2 },
        { position: timeToFraction(item.endSec, viewport), sec: item.endSec, order: order * 2 + 1 },
      ])
      .sort((a, b) => (a.position === b.position ? a.order - b.order : a.position - b.position));
    return this.#candidates;
  }
}

export function snapRangeToLaneBoundaries({
  activeEventName,
  cache = new LaneSnapCache(),
  edge,
  lane,
  layoutItems,
  range,
  viewport,
}: {
  activeEventName: string;
  cache?: LaneSnapCache;
  edge?: EventResizeEdge;
  lane: number;
  layoutItems: EventLaneLayoutItem[];
  range: EventTimeRange;
  viewport: TimelineViewport;
}): EventTimeRange {
  const laneCandidates = cache.candidates(layoutItems, lane, activeEventName, viewport);
  const near = [
    ...(edge === "end"
      ? []
      : nearbyBoundaries(
          laneCandidates,
          timeToFraction(range.startSec, viewport),
          EVENT_SNAP_THRESHOLD,
        )),
    ...(edge === "start"
      ? []
      : nearbyBoundaries(
          laneCandidates,
          timeToFraction(range.endSec, viewport),
          EVENT_SNAP_THRESHOLD,
        )),
  ];
  const candidates = Array.from(new Set(near)).sort((a, b) => a.order - b.order);
  let snappedRange = range;
  let smallestGap = EVENT_SNAP_THRESHOLD;

  for (const candidate of candidates) {
    const candidateSec = candidate.sec;
    const candidatePosition = candidate.position;
    const edgesToCheck =
      edge == undefined
        ? (["start", "end"] as const)
        : edge === "start"
          ? (["start"] as const)
          : (["end"] as const);

    for (const edgeToCheck of edgesToCheck) {
      const edgeSec = edgeToCheck === "start" ? range.startSec : range.endSec;
      const gap = Math.abs(timeToFraction(edgeSec, viewport) - candidatePosition);
      if (gap > smallestGap) {
        continue;
      }

      smallestGap = gap;
      const deltaSec = candidateSec - edgeSec;
      if (edge == undefined) {
        snappedRange = {
          endSec: range.endSec + deltaSec,
          startSec: range.startSec + deltaSec,
        };
      } else if (edge === "start") {
        snappedRange = {
          ...range,
          startSec: Math.min(candidateSec, range.endSec),
        };
      } else {
        snappedRange = {
          ...range,
          endSec: Math.max(candidateSec, range.startSec),
        };
      }
    }
  }

  return snappedRange;
}
