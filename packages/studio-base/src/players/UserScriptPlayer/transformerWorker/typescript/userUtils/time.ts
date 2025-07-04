// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "./types";

/*
 * Checks ROS-time equality.
 */
export const areSame = (t1: Time, t2: Time): boolean => t1.sec === t2.sec && t1.nsec === t2.nsec;

/*
 * Compare two times, returning a negative value if the right is greater or a
 * positive value if the left is greater or 0 if the times are equal useful to
 * supply to Array.prototype.sort
 */
export const compare = (left: Time, right: Time): number => {
  const secDiff = left.sec - right.sec;
  return secDiff !== 0 ? secDiff : left.nsec - right.nsec;
};

const fixTime = (t: Time): Time => {
  // Equivalent to fromNanoSec(toNanoSec(t)), but no chance of precision loss.
  // nsec should be non-negative, and less than 1e9.
  let { sec, nsec } = t;
  while (nsec > 1e9) {
    nsec -= 1e9;
    sec += 1;
  }
  while (nsec < 0) {
    nsec += 1e9;
    sec -= 1;
  }
  return { sec, nsec };
};

export const subtractTimes = (
  { sec: sec1, nsec: nsec1 }: Time,
  { sec: sec2, nsec: nsec2 }: Time,
): Time => {
  return fixTime({ sec: sec1 - sec2, nsec: nsec1 - nsec2 });
};
