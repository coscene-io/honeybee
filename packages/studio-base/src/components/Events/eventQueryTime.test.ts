// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getEventQueryBound } from "./eventQueryTime";

describe("getEventQueryBound", () => {
  it.each([
    { sec: 1_785_401_051, nsec: 363_000_000 },
    { sec: 1_785_401_229, nsec: 899_000_000 },
    { sec: 1_785_401_051, nsec: 2_000_000 },
    { sec: 1_785_401_051, nsec: 123_456_789 },
    { sec: 1_785_401_051, nsec: 1 },
    { sec: 1_785_401_051, nsec: 999_999_999 },
    { sec: 0, nsec: 1 },
    { sec: 0, nsec: 999_999_999 },
  ])("includes an exact nanosecond boundary at %j", (time) => {
    // Exercise the JSON round trip used by the numeric query API, then compare
    // at nanosecond precision without converting the source Time to a double.
    const bounds = JSON.parse(
      JSON.stringify({
        lower: getEventQueryBound(time, "lower"),
        upper: getEventQueryBound(time, "upper"),
      })!,
    ) as { lower: number; upper: number };
    const exactNanos = BigInt(time.sec) * 1_000_000_000n + BigInt(time.nsec);
    const lowerNanos = BigInt(bounds.lower.toFixed(9).replace(".", ""));
    const upperNanos = BigInt(bounds.upper.toFixed(9).replace(".", ""));

    expect(lowerNanos).toBeLessThanOrEqual(exactNanos);
    expect(upperNanos).toBeGreaterThanOrEqual(exactNanos);
    expect(exactNanos - lowerNanos).toBeLessThan(1_000n);
    expect(upperNanos - exactNanos).toBeLessThan(1_000n);
  });

  it.each([0, 1, 1_785_401_051])("preserves exact integer-second bounds at %i", (sec) => {
    expect(getEventQueryBound({ sec, nsec: 0 }, "lower")).toBe(sec);
    expect(getEventQueryBound({ sec, nsec: 0 }, "upper")).toBe(sec);
  });
});
