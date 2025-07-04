// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

// No time functions that require `moment` should live in this file.
import { Duration } from "@bufbuild/protobuf";

import log from "@foxglove/log";
import { Time } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio-base/players/types";
import { MarkerArray, StampedMessage } from "@foxglove/studio-base/types/Messages";

export type TimestampMethod = "receiveTime" | "headerStamp";

export function formatTimeRaw(stamp: Time): string {
  if (stamp.sec < 0 || stamp.nsec < 0) {
    log.error("Times are not allowed to be negative");
    return "(invalid negative time)";
  }
  return `${stamp.sec}.${stamp.nsec.toFixed().padStart(9, "0")}`;
}

const DURATION_20_YEARS_SEC = 20 * 365 * 24 * 60 * 60;

// Values "too small" to be absolute epoch-based times are probably relative durations.
export function isAbsoluteTime(time: Time): boolean {
  return time.sec > DURATION_20_YEARS_SEC;
}

export function formatFrame({ sec, nsec }: Time): string {
  return `${sec}.${String.prototype.padStart.call(nsec, 9, "0")}`;
}

export function getTimestampForMessageEvent(
  messageEvent: MessageEvent,
  timestampMethod?: TimestampMethod,
): Time | undefined {
  return timestampMethod === "headerStamp"
    ? getTimestampForMessage(messageEvent.message)
    : messageEvent.receiveTime;
}

export function getTimestampForMessage(message: unknown): Time | undefined {
  if ((message as Partial<StampedMessage>).header != undefined) {
    // This message has a "header" field
    const stamp = (message as Partial<StampedMessage>).header?.stamp;
    if (stamp != undefined && typeof stamp === "object" && "sec" in stamp && "nsec" in stamp) {
      return stamp;
    }
  } else if ((message as Partial<MarkerArray>).markers?.[0]?.header != undefined) {
    // This is a marker array message with a "markers" array and at least one entry
    const stamp = (message as MarkerArray).markers[0]?.header.stamp;
    if (stamp != undefined && typeof stamp === "object" && "sec" in stamp && "nsec" in stamp) {
      return stamp;
    }
  }

  return undefined;
}

export const timestampToTime = (timestamp: number): Time => {
  const sec = Math.floor(timestamp / 1000);
  const nsec = (timestamp % 1000) * 1000000;
  return { sec, nsec };
};

export const formateTimeToReadableFormat = (time: Time): string => {
  const h = Math.floor(time.sec / 3600);
  const m = Math.floor((time.sec % 3600) / 60);
  const s = Math.floor(time.sec % 60);

  return `${h < 10 ? 0 : ""}${h}:${m < 10 ? 0 : ""}${m}:${s < 10 ? 0 : ""}${s}.${
    Math.floor(time.nsec / 1e7) < 10 ? 0 : ""
  }${Math.floor(time.nsec / 1e7)}`;
};

export const durationToSeconds = (duration?: Duration): number => {
  if (!duration) {
    return 0;
  }

  return Number(duration.seconds) + duration.nanos / 1e9;
};

export const durationToNanoSeconds = (duration?: Readonly<Duration>): bigint => {
  if (!duration) {
    return BigInt(0);
  }

  return BigInt(duration.seconds) * BigInt(1e9) + BigInt(duration.nanos);
};

export const secondsToDuration = (seconds: number): Duration => {
  const sec = Math.floor(seconds);
  const nsec = Math.round((seconds - sec) * 1e9);

  const duration = new Duration({
    seconds: BigInt(sec),
    nanos: nsec,
  });

  return duration;
};
