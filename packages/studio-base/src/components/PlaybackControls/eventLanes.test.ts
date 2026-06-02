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

import { getEventLaneByName, getEventLaneRenderStyle, layoutEventLanes } from "./eventLanes";
import { makeTimelineViewport } from "./timelineViewport";

function makeEvent(
  name: string,
  startSec: number,
  durationSec: number,
  timelineStartSec: number = 0,
): TimelinePositionedEvent {
  const startTime = fromSec(startSec);
  const duration = fromSec(durationSec);
  const endTime = add(startTime, duration);

  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, {
        seconds: BigInt(startTime.sec),
        nanos: startTime.nsec,
      }),
      duration: create(DurationSchema, { seconds: BigInt(duration.sec), nanos: duration.nsec }),
    }),
    startTime,
    endTime,
    color: "#00ADEF",
    startPosition: (startSec - timelineStartSec) / 10,
    endPosition: (startSec + durationSec - timelineStartSec) / 10,
    secondsSinceStart: startSec - timelineStartSec,
  };
}

describe("layoutEventLanes", () => {
  it("splits overlapping events into separate lanes", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/first", 1, 4), makeEvent("events/second", 2, 2)],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(2);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(1);
  });

  it("keeps exactly touching events on the same lane", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/first", 1, 2), makeEvent("events/second", 3, 2)],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(1);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(0);
  });

  it("keeps exactly touching events on the same lane when timeline starts after zero", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/first", 101, 2, 100), makeEvent("events/second", 103, 2, 100)],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(1);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(0);
  });

  it("uses displayed timeline seconds to keep touching events on the same lane", () => {
    const first = makeEvent("events/first", 101, 2, 100);
    const second = {
      ...makeEvent("events/second", 200, 2, 197),
      secondsSinceStart: 3,
      startPosition: 0.3,
      endPosition: 0.5,
    };
    const layout = layoutEventLanes({
      events: [first, second],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(1);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(0);
  });

  it("keeps snapped events on the same lane after nanosecond round-trip drift", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/first", 0, 2), makeEvent("events/second", 2.000000001, 2)],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(1);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(0);
  });

  it("keeps adjacent events on the same lane after millisecond timestamp drift", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/first", 0, 2), makeEvent("events/second", 1.999, 2)],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(1);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(0);
  });

  it("keeps non-exact near-touching events on separate lanes within overlap tolerance", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/first", 1, 2), makeEvent("events/second", 3.01, 2)],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(2);
  });

  it("allows zero-duration events and renders them with a minimum width", () => {
    const layout = layoutEventLanes({
      events: [makeEvent("events/point", 2, 0)],
      viewport: makeTimelineViewport(0, 10),
    });
    const item = layout.items[0]!;

    expect(layout.laneCount).toBe(1);
    expect(item.isZeroDuration).toBe(true);
    expect(getEventLaneRenderStyle(item)).toMatchObject({
      minWidth: 4,
      width: "max(0%, 4px)",
    });
  });

  it("re-packs an edited event when preview events include updated times", () => {
    const first = makeEvent("events/first", 0, 1);
    const second = makeEvent("events/second", 3, 1);
    const layout = layoutEventLanes({
      events: [
        {
          ...first,
          secondsSinceStart: 3,
          startPosition: 0.3,
          endPosition: 0.4,
        },
        second,
      ],
      viewport: makeTimelineViewport(0, 10),
    });

    expect(layout.laneCount).toBe(2);
    expect(getEventLaneByName(layout, "events/first")).toBe(0);
    expect(getEventLaneByName(layout, "events/second")).toBe(1);
  });
});
