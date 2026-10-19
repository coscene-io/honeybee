// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";

import { formatPlaybackDuration, formatRelativeTime, parseRelativeTime } from "./relativeTime";

const origin = { sec: 1_700_000_000, nsec: 987_654_321 };

describe("playback-relative time", () => {
  it.each([
    [0n, "00:00:00.000"],
    [999_999_999n, "00:00:00.999"],
    [3_600_001_000_000n, "01:00:00.001"],
    [90_061_123_000_000n, "25:01:01.123"],
    [-1_001_000_000n, "-00:00:01.001"],
  ])("formats %s nanoseconds as a duration without dates or day wrapping", (nanos, expected) => {
    expect(formatPlaybackDuration(fromNanoSec(nanos))).toBe(expected);
  });

  it("subtracts the shared origin before reducing precision, including before-origin times", () => {
    const stamp = fromNanoSec(toNanoSec(origin) + 14_605_000_000n);
    expect(formatRelativeTime(stamp, origin)).toBe("00:00:14.605");
    expect(formatRelativeTime(fromNanoSec(toNanoSec(origin) - 1_000_000n), origin)).toBe(
      "-00:00:00.001",
    );
    expect(formatRelativeTime(stamp, undefined)).toBe("—");
  });

  it.each(["00:01:23.500", "83.5", "+00:01:23.500000000"])(
    "restores an absolute timestamp from %s",
    (text) => {
      expect(toNanoSec(parseRelativeTime(text, origin)!)).toBe(toNanoSec(origin) + 83_500_000_000n);
    },
  );

  it("preserves nanoseconds at both sides of the origin", () => {
    expect(toNanoSec(parseRelativeTime("0.000000001", origin)!)).toBe(toNanoSec(origin) + 1n);
    expect(toNanoSec(parseRelativeTime("-0.000000001", origin)!)).toBe(toNanoSec(origin) - 1n);
    expect(parseRelativeTime("00:00:00.000", { sec: 0, nsec: 0 })).toEqual({ sec: 0, nsec: 0 });
  });

  it.each([
    "",
    " ",
    "NaN",
    "Infinity",
    "1e3",
    "00:60:00",
    "00:00:60",
    "00:00:00.0000000001",
    "1:2:3",
    "-1700000001",
    "9999999999999999:00:00",
    "1".repeat(1000),
  ])("rejects invalid/unsafe offset %s", (text) => {
    expect(parseRelativeTime(text, origin)).toBeUndefined();
  });

  it("requires a real origin and does not mutate source times", () => {
    expect(parseRelativeTime("0", undefined)).toBeUndefined();
    const frozen = Object.freeze({ ...origin });
    expect(parseRelativeTime("0", frozen)).toEqual(origin);
    expect(formatRelativeTime(frozen, frozen)).toBe("00:00:00.000");
    expect(frozen).toEqual(origin);
  });
});
