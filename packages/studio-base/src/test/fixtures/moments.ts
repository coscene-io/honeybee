// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";

import { add, fromSec, type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

export type MomentDistribution = "short" | "continuous" | "overlapping" | "long";

/** Deterministic, one-hour fixtures shared by differential tests and browser measurements. */
export function makeMomentFixture(
  count: number,
  distribution: MomentDistribution = "short",
  origin: Time = { sec: 1_800_000_000, nsec: 123_456_789 },
): TimelinePositionedEvent[] {
  const interval = 3600 / count;
  return Array.from({ length: count }, (_, index) => {
    const start = index * interval;
    const end =
      distribution === "continuous"
        ? (index + 1) * interval
        : distribution === "long"
          ? 3600
          : Math.min(3600, start + (distribution === "overlapping" ? 5 : 0.1));
    const startTime = add(origin, fromSec(start));
    const endTime = add(origin, fromSec(end));
    const duration = fromSec(end - start);
    return {
      event: create(EventSchema, {
        name: `events/${String(index).padStart(6, "0")}`,
        displayName: `Moment ${index}`,
        record: "records/performance",
        triggerTime: create(TimestampSchema, {
          seconds: BigInt(startTime.sec),
          nanos: startTime.nsec,
        }),
        duration: create(DurationSchema, { seconds: BigInt(duration.sec), nanos: duration.nsec }),
      }),
      startTime,
      endTime,
      secondsSinceStart: start,
      startPosition: start / 3600,
      endPosition: end / 3600,
      color: "#BAE0FF",
      projectDisplayName: "Performance",
      recordDisplayName: "One hour",
    };
  });
}
