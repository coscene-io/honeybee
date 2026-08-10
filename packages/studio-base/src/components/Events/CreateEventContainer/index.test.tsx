// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getEventDurationSeconds, getEventUpdateMaskPaths, timestampFromTime } from ".";

describe("getEventDurationSeconds", () => {
  it("clamps negative second durations to zero", () => {
    expect(getEventDurationSeconds(-1.25, "sec")).toBe(0);
  });

  it("clamps negative nanosecond durations to zero", () => {
    expect(getEventDurationSeconds(-1_250_000_000, "nsec")).toBe(0);
  });

  it("converts positive nanosecond durations to seconds", () => {
    expect(getEventDurationSeconds(1_250_000_000, "nsec")).toBe(1.25);
  });
});

describe("event trigger time precision", () => {
  it("preserves sub-millisecond precision when creating an event timestamp", () => {
    const timestamp = timestampFromTime({ sec: 1_723_456_789, nsec: 123_456_789 });

    expect(timestamp.seconds).toBe(1_723_456_789n);
    expect(timestamp.nanos).toBe(123_456_789);
  });

  it("does not update trigger time when only non-time fields change", () => {
    const startTime = { sec: 1_723_456_789, nsec: 123_456_789 };

    expect(getEventUpdateMaskPaths(startTime, { ...startTime })).not.toContain("triggerTime");
  });

  it("updates trigger time with exact precision when the time changes", () => {
    const originalStartTime = { sec: 1_723_456_789, nsec: 123_456_789 };
    const changedStartTime = { sec: 1_723_456_789, nsec: 987_654_321 };

    expect(getEventUpdateMaskPaths(changedStartTime, originalStartTime)).toContain("triggerTime");
    expect(timestampFromTime(changedStartTime)).toMatchObject({
      seconds: 1_723_456_789n,
      nanos: 987_654_321,
    });
  });
});
