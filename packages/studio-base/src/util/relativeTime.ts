// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, toNanoSec, type Time } from "@foxglove/rostime";

/** A duration, never a wall-clock date. Hours may exceed 24. */
export function formatPlaybackDuration(duration: Time): string {
  const nanos = toNanoSec(duration);
  const magnitude = nanos < 0n ? -nanos : nanos;
  const seconds = magnitude / 1_000_000_000n;
  const hours = (seconds / 3600n).toString().padStart(2, "0");
  const minutes = ((seconds / 60n) % 60n).toString().padStart(2, "0");
  const secs = (seconds % 60n).toString().padStart(2, "0");
  const millis = ((magnitude / 1_000_000n) % 1000n).toString().padStart(3, "0");
  return `${nanos < 0n ? "-" : ""}${hours}:${minutes}:${secs}.${millis}`;
}

export function formatRelativeTime(stamp: Time, origin: Time | undefined): string {
  return origin == undefined
    ? "—"
    : formatPlaybackDuration(fromNanoSec(toNanoSec(stamp) - toNanoSec(origin)));
}

/** Parse an offset and restore the original timestamp without epoch-sized float arithmetic. */
export function parseRelativeTime(text: string, origin: Time | undefined): Time | undefined {
  if (origin == undefined) {
    return undefined;
  }
  const value = text.trim();
  const clock = /^([+-]?)(\d{1,16}):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?$/.exec(value);
  const decimal = /^([+-]?)(\d{1,16})(?:\.(\d{1,9}))?$/.exec(value);
  if (!clock && !decimal) {
    return undefined;
  }
  const sign = (clock ?? decimal)![1] === "-" ? -1n : 1n;
  const seconds = clock
    ? BigInt(clock[2]!) * 3600n + BigInt(clock[3]!) * 60n + BigInt(clock[4]!)
    : BigInt(decimal![2]!);
  const fraction = clock ? clock[5] : decimal![3];
  const offset = sign * (seconds * 1_000_000_000n + BigInt((fraction ?? "").padEnd(9, "0")));
  const timestamp = toNanoSec(origin) + offset;
  if (timestamp < 0n || timestamp / 1_000_000_000n > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return fromNanoSec(timestamp);
}
