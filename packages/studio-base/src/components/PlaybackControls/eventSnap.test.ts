// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";

import { add, fromSec } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

import { EVENT_SNAP_THRESHOLD, getSnappedEventMark } from "./eventSnap";

function makeEvent(name: string, startSec: number, durationSec: number): TimelinePositionedEvent {
  const startTime = fromSec(startSec);
  const duration = fromSec(durationSec);
  const endTime = add(startTime, duration);

  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, { seconds: BigInt(startTime.sec), nanos: 0 }),
      duration: create(DurationSchema, { seconds: BigInt(duration.sec), nanos: 0 }),
    }),
    startTime,
    endTime,
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + durationSec) / 10,
    secondsSinceStart: startSec,
  };
}

function makeEvents(count: number): TimelinePositionedEvent[] {
  return Array.from({ length: count }, (_value, index) =>
    makeEvent(`events/${index + 1}`, index * 2, 1),
  );
}

describe("getSnappedEventMark", () => {
  it("snaps to the nearest event boundary within the default threshold", () => {
    const firstEvent = makeEvents(2)[0]!;
    const mark = {
      key: "mark-1",
      position: firstEvent.endPosition + EVENT_SNAP_THRESHOLD / 2,
      time: { sec: 999, nsec: 0 },
    };

    expect(
      getSnappedEventMark({
        mark,
        events: [firstEvent],
      }),
    ).toEqual({
      ...mark,
      position: firstEvent.endPosition,
      time: firstEvent.endTime,
    });
  });

  it("keeps the dragged mark unchanged when no boundary is close enough", () => {
    const firstEvent = makeEvents(2)[0]!;
    const mark = {
      key: "mark-1",
      position: firstEvent.endPosition + EVENT_SNAP_THRESHOLD * 2,
      time: { sec: 999, nsec: 0 },
    };

    expect(
      getSnappedEventMark({
        mark,
        events: [firstEvent],
      }),
    ).toEqual(mark);
  });

  it("prefers the closest boundary when multiple candidates are in range", () => {
    const events = makeEvents(4);
    const targetEvent = events[2]!;
    const mark = {
      key: "mark-1",
      position: 0.505,
      time: { sec: 999, nsec: 0 },
    };

    expect(
      getSnappedEventMark({
        mark,
        events,
        threshold: 0.1,
      }),
    ).toEqual({
      ...mark,
      position: targetEvent.endPosition,
      time: targetEvent.endTime,
    });
  });

  it("excludes the edited event from snap candidates", () => {
    const events = makeEvents(4);
    const targetEvent = events[2]!;
    const mark = {
      key: "mark-1",
      position: targetEvent.startPosition + EVENT_SNAP_THRESHOLD / 2,
      time: { sec: 999, nsec: 0 },
    };

    expect(
      getSnappedEventMark({
        excludedEventName: targetEvent.event.name,
        mark,
        events,
      }),
    ).toEqual(mark);
  });

  it("only snaps to event boundaries in the eligible lane when candidates are restricted", () => {
    const events = makeEvents(3);
    const crossLaneEvent = events[1]!;
    const sameLaneEvent = events[2]!;
    const mark = {
      key: "mark-1",
      position: crossLaneEvent.startPosition + EVENT_SNAP_THRESHOLD / 2,
      time: { sec: 999, nsec: 0 },
    };

    expect(
      getSnappedEventMark({
        eligibleEventNames: new Set([sameLaneEvent.event.name]),
        mark,
        events,
      }),
    ).toEqual(mark);
  });
});
