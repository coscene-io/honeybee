// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { FieldMask } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import type { Event } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import * as _ from "lodash-es";

import { add, fromSec, type Time } from "@foxglove/rostime";
import { secondsToDuration } from "@foxglove/studio-base/util/time";

import { fractionToTime, timeToFraction, type TimelineViewport } from "./timelineViewport";

export type EventResizeEdge = "start" | "end";

export type EventTimeUpdate = {
  event: Event;
  updateMask: FieldMask;
};

export type EventTimeRange = {
  endSec: number;
  startSec: number;
};

export type BodyDragAnchor = {
  pointerToCenterOffset: number;
  sourceEndSec: number;
  sourceStartSec: number;
};

export function createBodyDragAnchor({
  endSec,
  pointerFraction,
  startSec,
  viewport,
}: {
  endSec: number;
  pointerFraction: number;
  startSec: number;
  viewport: TimelineViewport;
}): BodyDragAnchor {
  const centerFraction = timeToFraction((startSec + endSec) / 2, viewport);

  return {
    pointerToCenterOffset: pointerFraction - centerFraction,
    sourceEndSec: endSec,
    sourceStartSec: startSec,
  };
}

export function calculateBodyDragRange({
  anchor,
  pointerFraction,
  viewport,
}: {
  anchor: BodyDragAnchor;
  pointerFraction: number;
  viewport: TimelineViewport;
}): EventTimeRange {
  const durationSec = anchor.sourceEndSec - anchor.sourceStartSec;
  const durationFraction =
    timeToFraction(anchor.sourceEndSec, viewport) - timeToFraction(anchor.sourceStartSec, viewport);
  const centerFraction = _.clamp(pointerFraction, 0, 1) - anchor.pointerToCenterOffset;
  const isFullyInsideVisibleRange =
    anchor.sourceStartSec >= viewport.visibleStartSec &&
    anchor.sourceEndSec <= viewport.visibleEndSec;
  const startFraction = isFullyInsideVisibleRange
    ? _.clamp(centerFraction - durationFraction / 2, 0, 1 - durationFraction)
    : centerFraction - durationFraction / 2;
  const startSec = fractionToTime(startFraction, viewport);

  return {
    endSec: startSec + durationSec,
    startSec,
  };
}

export function calculateResizeRange({
  currentEndSec,
  currentStartSec,
  edge,
  pointerFraction,
  viewport,
}: {
  currentEndSec: number;
  currentStartSec: number;
  edge: EventResizeEdge;
  pointerFraction: number;
  viewport: TimelineViewport;
}): EventTimeRange {
  const currentStartFraction = timeToFraction(currentStartSec, viewport);
  const currentEndFraction = timeToFraction(currentEndSec, viewport);
  let nextStartFraction = currentStartFraction;
  let nextEndFraction = currentEndFraction;

  if (edge === "start") {
    nextStartFraction = Math.min(_.clamp(pointerFraction, 0, 1), currentEndFraction);
  } else {
    nextEndFraction = Math.max(_.clamp(pointerFraction, 0, 1), currentStartFraction);
  }

  return {
    endSec: fractionToTime(nextEndFraction, viewport),
    startSec: fractionToTime(nextStartFraction, viewport),
  };
}

export function buildEventTimeUpdate({
  durationSec,
  sourceEvent,
  startTime,
  startTimeOffsetSec = 0,
}: {
  durationSec: number;
  sourceEvent: Event;
  startTime: Time;
  startTimeOffsetSec?: number;
}): EventTimeUpdate {
  const nextStartTime = add(startTime, fromSec(startTimeOffsetSec));

  return {
    event: create(EventSchema, {
      ...sourceEvent,
      name: sourceEvent.name,
      displayName: sourceEvent.displayName,
      description: sourceEvent.description,
      triggerTime: create(TimestampSchema, {
        seconds: BigInt(nextStartTime.sec),
        nanos: nextStartTime.nsec,
      }),
      duration: secondsToDuration(durationSec),
      customizedFields: { ...sourceEvent.customizedFields },
    }),
    updateMask: create(FieldMaskSchema, {
      paths: ["triggerTime", "duration"],
    }),
  };
}
