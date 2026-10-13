// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { EventLaneLayoutItem } from "./eventLanes";
import { EVENT_SNAP_THRESHOLD } from "./eventSnap";
import type { EventResizeEdge, EventTimeRange } from "./eventTimeEdit";
import { timeToFraction, type TimelineViewport } from "./timelineViewport";

export function referenceSnapRangeToLaneBoundaries({
  activeEventName,
  edge,
  lane,
  layoutItems,
  range,
  viewport,
}: {
  activeEventName: string;
  edge?: EventResizeEdge;
  lane: number;
  layoutItems: EventLaneLayoutItem[];
  range: EventTimeRange;
  viewport: TimelineViewport;
}): EventTimeRange {
  const candidates = layoutItems
    .filter((item) => item.lane === lane && item.event.event.name !== activeEventName)
    .flatMap((item) => [item.startSec, item.endSec]);
  let snappedRange = range;
  let smallestGap = EVENT_SNAP_THRESHOLD;

  for (const candidateSec of candidates) {
    const candidatePosition = timeToFraction(candidateSec, viewport);
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
