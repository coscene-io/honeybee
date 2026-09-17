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

import { isPlaybackSecondsInEvent } from "./eventTimeContainment";

const FIFTY_MINUTES_SEC = 50 * 60;

function makeEvent(name: string, startSec: number, durationSec: number): TimelinePositionedEvent {
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
    startPosition: startSec / FIFTY_MINUTES_SEC,
    endPosition: (startSec + durationSec) / FIFTY_MINUTES_SEC,
    secondsSinceStart: startSec,
  };
}

function namesAt(playbackSeconds: number, events: TimelinePositionedEvent[]): string[] {
  return events
    .filter((event) =>
      isPlaybackSecondsInEvent({
        playbackSeconds,
        event,
        timelineDurationSeconds: FIFTY_MINUTES_SEC,
      }),
    )
    .map((event) => event.event.name);
}

describe("isPlaybackSecondsInEvent", () => {
  it("returns only the 1s moment that contains the hover time on a 50-minute timeline", () => {
    const events = [
      makeEvent("events/1499", 1499, 1),
      makeEvent("events/1500", 1500, 1),
      makeEvent("events/1501", 1501, 1),
    ];

    expect(namesAt(1500.2, events)).toEqual(["events/1500"]);
  });

  it("does not include nearby 1s moments that the old 1% position window would have matched", () => {
    const events = [
      makeEvent("events/1499", 1499, 1),
      makeEvent("events/1500", 1500, 1),
      makeEvent("events/1501", 1501, 1),
    ];

    // 1510s is 10s after events/1500. On a 3000s file the old filter was:
    // hoverPosition=1510/3000, startPosition*0.99 .. endPosition*1.01, which
    // includes 1510 for the moment at 1500s. Exact time must not.
    expect(namesAt(1510, events)).toEqual([]);
  });

  it("assigns a shared boundary second to the later adjacent moment only", () => {
    const events = [makeEvent("events/first", 1500, 1), makeEvent("events/second", 1501, 1)];

    expect(namesAt(1501, events)).toEqual(["events/second"]);
  });

  it("returns every moment whose real range contains the hover time", () => {
    const events = [makeEvent("events/wide", 1498, 5), makeEvent("events/inner", 1500, 1)];

    expect(namesAt(1500.5, events)).toEqual(["events/wide", "events/inner"]);
  });

  it("matches a zero-duration moment only at its exact time", () => {
    const event = makeEvent("events/zero", 1500, 0);

    expect(
      isPlaybackSecondsInEvent({
        playbackSeconds: 1500,
        event,
        timelineDurationSeconds: FIFTY_MINUTES_SEC,
      }),
    ).toBe(true);
    expect(
      isPlaybackSecondsInEvent({
        playbackSeconds: 1500.001,
        event,
        timelineDurationSeconds: FIFTY_MINUTES_SEC,
      }),
    ).toBe(false);
  });

  it("includes the timeline end when a moment ends at the timeline end", () => {
    const event = makeEvent("events/last", FIFTY_MINUTES_SEC - 1, 1);

    expect(
      isPlaybackSecondsInEvent({
        playbackSeconds: FIFTY_MINUTES_SEC,
        event,
        timelineDurationSeconds: FIFTY_MINUTES_SEC,
      }),
    ).toBe(true);
  });
});
