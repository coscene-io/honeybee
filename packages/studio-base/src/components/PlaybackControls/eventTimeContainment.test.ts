// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";

import { add, fromSec, subtract, toSec, type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

import {
  isAbsoluteSecondsInEvent,
  isPlaybackSecondsInEvent,
  timelineDurationSeconds,
} from "./eventTimeContainment";

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

function makeAbsoluteEvent(
  name: string,
  startTime: Time,
  endTime: Time,
  recordingStart: Time,
): TimelinePositionedEvent {
  const startSec = toSec(subtract(startTime, recordingStart));

  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, {
        seconds: BigInt(startTime.sec),
        nanos: startTime.nsec,
      }),
    }),
    startTime,
    endTime,
    color: "#00ADEF",
    startPosition: 0,
    endPosition: 1,
    secondsSinceStart: startSec,
  };
}

const ZERO_START: Time = { sec: 0, nsec: 0 };

function namesAt(
  playbackSeconds: number,
  events: TimelinePositionedEvent[],
  recordingStartTime: Time = ZERO_START,
  durationSeconds: number = FIFTY_MINUTES_SEC,
): string[] {
  return events
    .filter((event) =>
      isPlaybackSecondsInEvent({
        playbackSeconds,
        event,
        recordingStartTime,
        durationSeconds,
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
        recordingStartTime: ZERO_START,
        durationSeconds: FIFTY_MINUTES_SEC,
      }),
    ).toBe(true);
    expect(
      isPlaybackSecondsInEvent({
        playbackSeconds: 1500.001,
        event,
        recordingStartTime: ZERO_START,
        durationSeconds: FIFTY_MINUTES_SEC,
      }),
    ).toBe(false);
  });

  it("includes the timeline end when a moment ends at the timeline end", () => {
    const event = makeEvent("events/last", FIFTY_MINUTES_SEC - 1, 1);

    expect(
      isPlaybackSecondsInEvent({
        playbackSeconds: FIFTY_MINUTES_SEC,
        event,
        recordingStartTime: ZERO_START,
        durationSeconds: FIFTY_MINUTES_SEC,
      }),
    ).toBe(true);
  });

  it("includes the timeline end for epoch-scale times without duration-conversion drift", () => {
    const recordingStart: Time = { sec: 1_700_000_000, nsec: 123_456_789 };
    const recordingEnd: Time = { sec: 1_700_003_000, nsec: 124_456_789 };
    const eventStart: Time = { sec: 1_700_001_500, nsec: 987_654_321 };
    const event = makeAbsoluteEvent("events/last", eventStart, recordingEnd, recordingStart);
    const originDuration = toSec(subtract(recordingEnd, recordingStart));

    expect(
      isPlaybackSecondsInEvent({
        playbackSeconds: originDuration,
        event,
        recordingStartTime: recordingStart,
        durationSeconds: originDuration,
      }),
    ).toBe(true);

    expect(timelineDurationSeconds(recordingStart, recordingEnd)).toBe(originDuration);
  });

  it("matches the precise relative-time endpoint emitted by synchronized charts", () => {
    const recordingStart: Time = { sec: 1_700_000_000, nsec: 0 };
    const recordingEnd: Time = { sec: 1_700_003_000, nsec: 123_456_789 };
    const eventStart: Time = { sec: 1_700_002_999, nsec: 0 };
    const event = makeAbsoluteEvent("events/last", eventStart, recordingEnd, recordingStart);
    // Plot and State Transitions subtract Time values before converting to seconds.
    const chartPlaybackSeconds = toSec(subtract(recordingEnd, recordingStart));
    const durationSeconds = timelineDurationSeconds(recordingStart, recordingEnd);

    expect(durationSeconds).toBe(chartPlaybackSeconds);
    expect(namesAt(chartPlaybackSeconds, [event], recordingStart, durationSeconds)).toEqual([
      "events/last",
    ]);
  });

  it("does not round epoch-scale nanosecond moments into a shared zero-duration point", () => {
    const recordingStart: Time = { sec: 1_700_000_000, nsec: 0 };
    const firstStart = { sec: 1_700_000_001, nsec: 1 };
    const boundary = { sec: 1_700_000_001, nsec: 2 };
    const secondEnd = { sec: 1_700_000_001, nsec: 3 };
    const first = makeAbsoluteEvent("events/first", firstStart, boundary, recordingStart);
    const second = makeAbsoluteEvent("events/second", boundary, secondEnd, recordingStart);
    const boundaryPlayback = toSec(subtract(boundary, recordingStart));

    expect(namesAt(boundaryPlayback, [first, second], recordingStart)).toEqual(["events/second"]);
    expect(namesAt(toSec(subtract(firstStart, recordingStart)), [first], recordingStart)).toEqual([
      "events/first",
    ]);
  });

  it("assigns a shared fractional boundary to the later moment when recording start has leftover nanos", () => {
    const recordingStart: Time = { sec: 0, nsec: 723_255_838 };
    const firstStart: Time = { sec: 1500, nsec: 566_271_339 };
    const boundary: Time = { sec: 1501, nsec: 284_571_692 };
    const secondEnd: Time = { sec: 1502, nsec: 0 };
    const first = makeAbsoluteEvent("events/first", firstStart, boundary, recordingStart);
    const second = makeAbsoluteEvent("events/second", boundary, secondEnd, recordingStart);
    const boundaryPlayback = toSec(subtract(boundary, recordingStart));
    const duration = timelineDurationSeconds(recordingStart, secondEnd);

    expect(namesAt(boundaryPlayback, [first, second], recordingStart, duration)).toEqual([
      "events/second",
    ]);
  });
});

describe("isAbsoluteSecondsInEvent", () => {
  const recordingStart: Time = { sec: 1_700_000_000, nsec: 123_456_789 };
  const boundary: Time = { sec: 1_700_000_001, nsec: 987_654_321 };
  const recordingEnd: Time = { sec: 1_700_000_003, nsec: 123_456_789 };
  const first = makeAbsoluteEvent("events/first", recordingStart, boundary, recordingStart);
  const second = makeAbsoluteEvent("events/second", boundary, recordingEnd, recordingStart);
  const point = makeAbsoluteEvent("events/point", boundary, boundary, recordingStart);
  // Spacing between adjacent representable numbers at these epoch-scale timestamps.
  const numberStep = 2 ** -22;

  it.each([
    [toSec(boundary) - numberStep, ["events/first"]],
    [toSec(boundary), ["events/second", "events/point"]],
    [toSec(boundary) + numberStep, ["events/second"]],
    [toSec(recordingEnd), ["events/second"]],
    [toSec(recordingEnd) + numberStep, []],
  ])("matches numeric preview %s without expanding the interval", (absoluteSeconds, expected) => {
    const names = [first, second, point]
      .filter((event) =>
        isAbsoluteSecondsInEvent({ absoluteSeconds, event, recordingEndTime: recordingEnd }),
      )
      .map((event) => event.event.name);
    expect(names).toEqual(expected);
  });

  it("preserves genuine overlapping events", () => {
    const wide = makeAbsoluteEvent("events/wide", recordingStart, recordingEnd, recordingStart);
    const names = [wide, second]
      .filter((event) =>
        isAbsoluteSecondsInEvent({
          absoluteSeconds: toSec(boundary),
          event,
          recordingEndTime: recordingEnd,
        }),
      )
      .map((event) => event.event.name);
    expect(names).toEqual(["events/wide", "events/second"]);
  });
});
