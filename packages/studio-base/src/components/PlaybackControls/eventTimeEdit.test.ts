// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { DeviceSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/device_pb";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";

import {
  buildEventTimeUpdate,
  calculateBodyDragRange,
  calculateResizeRange,
  createBodyDragAnchor,
} from "./eventTimeEdit";
import { makeTimelineViewport } from "./timelineViewport";

describe("eventTimeEdit", () => {
  it("keeps duration while body dragging from the pointer-to-center anchor", () => {
    const viewport = makeTimelineViewport(0, 10);
    const anchor = createBodyDragAnchor({
      pointerFraction: 0.3,
      startSec: 2,
      endSec: 4,
      viewport,
    });

    expect(
      calculateBodyDragRange({
        anchor,
        pointerFraction: 0.5,
        viewport,
      }),
    ).toEqual({ startSec: 4, endSec: 6 });
  });

  it("resizes a start edge to zero duration without forcing a minimum", () => {
    expect(
      calculateResizeRange({
        currentEndSec: 4,
        currentStartSec: 2,
        edge: "start",
        pointerFraction: 0.4,
        viewport: makeTimelineViewport(0, 10),
      }),
    ).toEqual({ startSec: 4, endSec: 4 });
  });

  it("builds a time update payload that allows zero duration", () => {
    const sourceEvent = create(EventSchema, {
      name: "events/point",
      displayName: "Point",
      triggerTime: create(TimestampSchema, { seconds: 2n, nanos: 0 }),
      duration: create(DurationSchema, { seconds: 1n, nanos: 0 }),
      customizedFields: { retained: "true" },
    });

    const update = buildEventTimeUpdate({
      sourceEvent,
      startTime: { sec: 5, nsec: 0 },
      durationSec: 0,
    });

    expect(update.event.triggerTime?.seconds).toBe(5n);
    expect(update.event.duration?.seconds).toBe(0n);
    expect(update.event.customizedFields).toEqual({});
    expect(update.updateMask.paths).toEqual(["trigger_time", "duration_nanos", "duration"]);
  });

  it("does not copy an empty device into the time update payload", () => {
    const sourceEvent = create(EventSchema, {
      name: "events/point",
      device: create(DeviceSchema, { name: "" }),
      triggerTime: create(TimestampSchema, { seconds: 2n, nanos: 0 }),
      duration: create(DurationSchema, { seconds: 1n, nanos: 0 }),
    });

    const update = buildEventTimeUpdate({
      sourceEvent,
      startTime: { sec: 5, nsec: 0 },
      durationSec: 0,
    });

    expect(update.event.device).toBeUndefined();
    expect(update.updateMask.paths).toEqual(["trigger_time", "duration_nanos", "duration"]);
  });
});
