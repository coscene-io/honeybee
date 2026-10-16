// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Time } from "@foxglove/rostime";

/** Conservatively round a numeric API query bound so it includes the exact Time boundary. */
export function getEventQueryBound(time: Time, bound: "lower" | "upper"): number {
  if (time.nsec === 0) {
    return time.sec;
  }

  // Avoid first combining epoch seconds and nanoseconds into an unsafe integer.
  const seconds = time.sec + time.nsec / 1e9;
  // An epoch timestamp's fractional nanoseconds cannot all fit in a double. Move
  // outward by its floating-point precision rather than excluding boundary Moments.
  const roundingMargin = Math.max(1, Math.abs(seconds)) * Number.EPSILON;
  return bound === "lower" ? seconds - roundingMargin : seconds + roundingMargin;
}
