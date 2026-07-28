// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import type React from "react";

import { toSec } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

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

  const laneEndPositions: number[] = [];
  const laneEndSecs: number[] = [];
  const items: EventLaneLayoutItem[] = [];

  for (const candidate of candidates) {
    let lane = 0;
    while (lane < laneEndPositions.length) {
      const laneEndSec = laneEndSecs[lane];
      const isExactlyTouchingPrevious =
        laneEndSec != undefined && areTimelineSecondsAdjacent(laneEndSec, candidate.startSec);
      if (
        isExactlyTouchingPrevious ||
        laneEndPositions[lane]! <= candidate.startPosition - EVENT_LANE_OVERLAP_TOLERANCE_FRACTION
      ) {
        break;
      }

      lane++;
    }

    laneEndPositions[lane] = candidate.endPosition + EVENT_LANE_OVERLAP_TOLERANCE_FRACTION;
    laneEndSecs[lane] = candidate.endSec;
    items.push({ ...candidate, lane });
  }

  return {
    items,
    laneCount: laneEndPositions.length,
  };
}

export function getEventLaneByName(layout: EventLaneLayout, eventName: string): number | undefined {
  return layout.items.find((item) => item.event.event.name === eventName)?.lane;
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
