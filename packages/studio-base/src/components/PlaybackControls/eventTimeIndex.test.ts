// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { add, fromSec, toSec } from "@foxglove/rostime";
import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";

import { getCachedEventLaneLayout } from "./eventLanes";
import { isAbsoluteSecondsInEvent, isPlaybackSecondsInEvent } from "./eventTimeContainment";
import { getEventTimeIndex } from "./eventTimeIndex";
import { makeTimelineViewport } from "./timelineViewport";

const origin = { sec: 1_800_000_000, nsec: 123_456_789 };
const end = add(origin, fromSec(3600));

it.each(["short", "continuous", "overlapping", "long"] as const)(
  "indexes %s moments without changing containment or order",
  (distribution) => {
    const events = makeMomentFixture(1000, distribution, origin).reverse();
    events.push({
      ...events[0]!,
      event: { ...events[0]!.event, name: "point" },
      startTime: origin,
      endTime: origin,
    });
    const index = getEventTimeIndex(events, origin);
    for (const playbackSeconds of [0, 0.1, 3.6, 1777, 1800, 3599.9, 3600]) {
      expect(index.atRelativeTime(playbackSeconds, 3600)).toEqual(
        events.filter((event) =>
          isPlaybackSecondsInEvent({
            playbackSeconds,
            event,
            recordingStartTime: origin,
            durationSeconds: 3600,
          }),
        ),
      );
      const absoluteSeconds = toSec(add(origin, fromSec(playbackSeconds)));
      expect(index.atAbsoluteTime(absoluteSeconds, end)).toEqual(
        events.filter((event) =>
          isAbsoluteSecondsInEvent({ absoluteSeconds, event, recordingEndTime: end }),
        ),
      );
    }
    expect(
      index.inRelativeRange(1700, 1800).every((event) => event.endTime.sec >= origin.sec + 1700),
    ).toBe(true);
  },
);

it("reuses immutable snapshots, distinguishes origins and invalidates replaced events", () => {
  const events = makeMomentFixture(10);
  expect(getEventTimeIndex(events, origin)).toBe(getEventTimeIndex(events, { ...origin }));
  expect(getEventTimeIndex(events, add(origin, fromSec(1)))).not.toBe(
    getEventTimeIndex(events, origin),
  );
  expect(getEventTimeIndex([...events], origin)).not.toBe(getEventTimeIndex(events, origin));
  const viewport = makeTimelineViewport(0, 3600);
  expect(getCachedEventLaneLayout({ events, viewport })).toBe(
    getCachedEventLaneLayout({ events, viewport: { ...viewport } }),
  );
});
