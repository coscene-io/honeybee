// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";

import { add } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

import { layoutEventLanes } from "./eventLanes";
import {
  buildRollingEditUpdates,
  clampRollingEditBoundary,
  findRollingEditPairs,
} from "./eventRollingEdit";
import { makeTimelineViewport } from "./timelineViewport";

function makeEvent(name: string, startSec: number, durationSec: number): TimelinePositionedEvent {
  const startTime = { sec: startSec, nsec: 0 };
  const endTime = add(startTime, { sec: durationSec, nsec: 0 });

  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, { seconds: BigInt(startSec), nanos: 0 }),
      duration: create(DurationSchema, { seconds: BigInt(durationSec), nanos: 0 }),
      customizedFields: { retained: "true" },
    }),
    startTime,
    endTime,
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + durationSec) / 10,
    secondsSinceStart: startSec,
  };
}

describe("eventRollingEdit", () => {
  it("finds visually adjacent event pairs", () => {
    const first = makeEvent("events/first", 0, 5);
    const second = makeEvent("events/second", 5, 5);

    expect(
      findRollingEditPairs({
        events: [first, second],
        viewport: makeTimelineViewport(0, 10),
        width: 1000,
      }),
    ).toHaveLength(1);
  });

  it("finds exactly touching event pairs after timeline lane layout", () => {
    const first = makeEvent("events/first", 0, 5);
    const second = makeEvent("events/second", 5, 5);
    const viewport = makeTimelineViewport(0, 10);
    const layout = layoutEventLanes({ events: [first, second], viewport });
    const laneByEventName = new Map(layout.items.map((item) => [item.event.event.name, item.lane]));

    expect(
      findRollingEditPairs({
        laneByEventName,
        events: [first, second],
        viewport,
        width: 1000,
      }),
    ).toHaveLength(1);
  });

  it("finds adjacent pairs on the same lane when another lane is between them in time order", () => {
    const first = makeEvent("events/first", 0, 2);
    const overlapping = makeEvent("events/overlapping", 1, 2);
    const second = makeEvent("events/second", 2, 2);
    const viewport = makeTimelineViewport(0, 10);
    const layout = layoutEventLanes({ events: [first, overlapping, second], viewport });
    const laneByEventName = new Map(layout.items.map((item) => [item.event.event.name, item.lane]));

    const pairs = findRollingEditPairs({
      laneByEventName,
      events: [first, overlapping, second],
      viewport,
      width: 1000,
    });

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.key).toBe("events/first:events/second");
  });

  it("ignores visible gaps", () => {
    const first = makeEvent("events/first", 0, 4);
    const second = makeEvent("events/second", 5, 5);

    expect(
      findRollingEditPairs({
        events: [first, second],
        viewport: makeTimelineViewport(0, 10),
        width: 1000,
      }),
    ).toHaveLength(0);
  });

  it("clamps rolling boundaries while allowing zero-duration events", () => {
    const [pair] = findRollingEditPairs({
      events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
      viewport: makeTimelineViewport(0, 10),
      width: 1000,
    });

    expect(pair).toBeDefined();
    expect(clampRollingEditBoundary(pair!, -1)).toBe(0);
    expect(clampRollingEditBoundary(pair!, 11)).toBe(10);
  });

  it("ignores adjacent events on different lanes", () => {
    const first = makeEvent("events/first", 0, 5);
    const second = makeEvent("events/second", 5, 5);

    expect(
      findRollingEditPairs({
        laneByEventName: new Map([
          [first.event.name, 0],
          [second.event.name, 1],
        ]),
        events: [first, second],
        viewport: makeTimelineViewport(0, 10),
        width: 1000,
      }),
    ).toHaveLength(0);
  });

  it("builds update payloads for both adjacent events", () => {
    const [pair] = findRollingEditPairs({
      events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
      viewport: makeTimelineViewport(0, 10),
      width: 1000,
    });
    const [previousUpdate, nextUpdate] = buildRollingEditUpdates(pair!, 6);

    expect(previousUpdate.event.name).toBe("events/first");
    expect(previousUpdate.event.duration?.seconds).toBe(6n);
    expect(nextUpdate.event.name).toBe("events/second");
    expect(nextUpdate.event.triggerTime?.seconds).toBe(6n);
    expect(nextUpdate.event.duration?.seconds).toBe(4n);
    expect(nextUpdate.event.customizedFields).toEqual({ retained: "true" });
    expect(nextUpdate.updateMask.paths).toEqual(["triggerTime", "duration"]);
  });
});
