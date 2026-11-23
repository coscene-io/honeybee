// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationFrame } from "./types";

/**
 * Wire frame identity in the AnnotationService: `topic + frame_time`, where frame_time is the source
 * message's MCAP log_time truncated (never rounded) to whole microseconds. Locally a frame keeps
 * its full nanosecond log time; these helpers are the only place the two meet.
 */

const NS_PER_US = 1000n;

/** Floor division to microseconds. Log times are non-negative, so this is truncation. */
export function truncateToMicros(logTimeNs: bigint | string): bigint {
  const ns = typeof logTimeNs === "bigint" ? logTimeNs : BigInt(logTimeNs);
  if (ns < 0n) {
    throw new Error("Log time must not be negative");
  }
  return ns / NS_PER_US;
}

/** `{ seconds, nanos }` with `nanos % 1000 === 0`, as required for every request time. */
export function microsToTimestamp(micros: bigint): { seconds: bigint; nanos: number } {
  return {
    seconds: micros / 1_000_000n,
    nanos: Number((micros % 1_000_000n) * NS_PER_US),
  };
}

/** Rejects a timestamp that is not microsecond aligned instead of silently truncating it. */
export function timestampToMicros(timestamp: { seconds: bigint; nanos: number }): bigint {
  if (!Number.isInteger(timestamp.nanos) || timestamp.nanos < 0 || timestamp.nanos >= 1e9) {
    throw new Error(`Invalid timestamp nanos ${timestamp.nanos}`);
  }
  if (timestamp.nanos % 1000 !== 0) {
    throw new Error("frame_time is not aligned to microseconds");
  }
  return timestamp.seconds * 1_000_000n + BigInt(timestamp.nanos) / NS_PER_US;
}

/** Microseconds since the epoch, as the protobuf JSON form used in logs and reports. */
export function microsToIso(micros: bigint): string {
  const seconds = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${new Date(Number(seconds * 1000n)).toISOString().slice(0, 19)}.${fraction}Z`;
}

/** Window boundary: a relative second offset from the recording start, floored to microseconds. */
export function windowBoundaryMicros(startNs: bigint, offsetSec: number): bigint {
  // Whole nanoseconds; the sub-nanosecond part of a float offset cannot name a frame.
  const offsetNs = BigInt(Math.floor(offsetSec * 1e9));
  return truncateToMicros(startNs + offsetNs);
}

/**
 * Per-topic map between local frames and wire frame_times. Two local frames that truncate to the
 * same microsecond are a collision: the contract says the backend rejects such media, so neither
 * direction picks one of them.
 */
export class FrameTimeIndex {
  readonly #byMicros = new Map<bigint, string>();
  readonly #collisions = new Set<bigint>();
  readonly #microsByFrame = new Map<string, bigint>();

  public add(frame: Pick<SegmentationFrame, "id" | "logTimeNs">): void {
    if (this.#microsByFrame.has(frame.id)) {
      return;
    }
    const micros = truncateToMicros(frame.logTimeNs);
    this.#microsByFrame.set(frame.id, micros);
    const existing = this.#byMicros.get(micros);
    if (existing != undefined && existing !== frame.id) {
      this.#collisions.add(micros);
      return;
    }
    this.#byMicros.set(micros, frame.id);
  }

  /** The local frame for a wire frame_time, or why there is none. */
  public resolve(
    micros: bigint,
  ): { frameId: string } | { missing: "unregistered" | "collision"; micros: bigint } {
    if (this.#collisions.has(micros)) {
      return { missing: "collision", micros };
    }
    const frameId = this.#byMicros.get(micros);
    return frameId == undefined ? { missing: "unregistered", micros } : { frameId };
  }

  /** The wire frame_time of a local frame; throws for a collision, which cannot be saved. */
  public frameTimeOf(frameId: string): bigint {
    const micros = this.#microsByFrame.get(frameId);
    if (micros == undefined) {
      throw new Error(`Frame ${frameId} is not in the media index`);
    }
    if (this.#collisions.has(micros)) {
      throw new Error(
        `同一 topic 有多帧的 log_time 截断到同一微秒 ${microsToIso(micros)}，按契约后端会拒绝该媒体，不能保存或传播这一帧`,
      );
    }
    return micros;
  }

  public collisionCount(): number {
    return this.#collisions.size;
  }
}
