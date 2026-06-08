// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264, H265 } from "@foxglove/den/video";
import { Time, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

const VIDEO_FORMATS = new Set(["h264", "h265"]);
export const DEFAULT_VIDEO_GOP_CACHE_MAX_BYTES = 64 * 1024 * 1024;

type CompressedVideoLike = {
  timestamp: Time;
  frame_id: string;
  format: string;
  data: Uint8Array;
};

type CachedVideoFrame = {
  messageEvent: MessageEvent;
  receiveTimeNs: bigint;
  publishTimeNs: bigint;
  isKeyframe: boolean;
  byteLength: number;
};

export type VideoFrameInfo = {
  frame: CompressedVideoLike;
  isKeyframe: boolean;
  byteLength: number;
};

function isTime(value: unknown): value is Time {
  return (
    typeof value === "object" &&
    value != undefined &&
    typeof (value as Partial<Time>).sec === "number" &&
    typeof (value as Partial<Time>).nsec === "number"
  );
}

export function parseVideoFrameInfo(msg: MessageEvent): VideoFrameInfo | undefined {
  const message = msg.message as Partial<CompressedVideoLike> | undefined;
  if (
    message == undefined ||
    !isTime(message.timestamp) ||
    typeof message.frame_id !== "string" ||
    typeof message.format !== "string" ||
    !VIDEO_FORMATS.has(message.format) ||
    !(message.data instanceof Uint8Array) ||
    message.data.byteLength === 0
  ) {
    return undefined;
  }

  try {
    switch (message.format) {
      case "h264":
        if (!H264.IsAnnexB(message.data)) {
          return undefined;
        }
        return {
          frame: message as CompressedVideoLike,
          isKeyframe: H264.IsKeyframe(message.data),
          byteLength: message.data.byteLength,
        };
      case "h265":
        if (!H265.IsAnnexB(message.data)) {
          return undefined;
        }
        return {
          frame: message as CompressedVideoLike,
          isKeyframe: H265.IsKeyframe(message.data),
          byteLength: message.data.byteLength,
        };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export class VideoGopCache {
  readonly #rangesByTopic = new Map<string, CachedVideoRange[]>();
  readonly #activeRangeByTopic = new Map<string, CachedVideoRange>();
  readonly #maxBytes: number;
  #byteSize = 0;
  #targetReceiveTimeNs = 0n;

  public constructor(options: { maxBytes?: number } = {}) {
    this.#maxBytes = options.maxBytes ?? DEFAULT_VIDEO_GOP_CACHE_MAX_BYTES;
  }

  public addFrame(msg: MessageEvent): boolean {
    const frameInfo = parseVideoFrameInfo(msg);
    if (frameInfo == undefined) {
      return false;
    }

    const receiveTimeNs = toNanoSec(msg.receiveTime);
    const publishTimeNs = toNanoSec(frameInfo.frame.timestamp);
    const cachedFrame: CachedVideoFrame = {
      messageEvent: msg,
      receiveTimeNs,
      publishTimeNs,
      isKeyframe: frameInfo.isKeyframe,
      byteLength: frameInfo.byteLength,
    };

    this.#targetReceiveTimeNs = receiveTimeNs;

    const ranges = this.#rangesByTopic.get(msg.topic) ?? [];
    let range = ranges.find((entry) => entry.overlapsPublishTime(publishTimeNs));
    if (range == undefined) {
      range = this.#activeRangeByTopic.get(msg.topic);
    }
    if (range == undefined || !ranges.includes(range)) {
      range = new CachedVideoRange();
      ranges.push(range);
      this.#rangesByTopic.set(msg.topic, ranges);
    }

    this.#byteSize += range.addFrame(cachedFrame);
    this.#activeRangeByTopic.set(msg.topic, range);
    this.#mergeOverlappingRanges(msg.topic);
    this.#pruneToBudget();
    return true;
  }

  public handleSeek(targetTime: Time): void {
    this.#targetReceiveTimeNs = toNanoSec(targetTime);
    this.#activeRangeByTopic.clear();
  }

  public addFrameRange(messages: readonly MessageEvent[]): void {
    if (messages.length === 0) {
      return;
    }

    const firstVideoFrame = messages.find((msg) => parseVideoFrameInfo(msg) != undefined);
    if (firstVideoFrame != undefined) {
      this.#activeRangeByTopic.delete(firstVideoFrame.topic);
    }
    this.addFrames(messages);
  }

  public addFrames(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      this.addFrame(msg);
    }
  }

  public framesForReceiveTime(topic: string, targetTime: Time): MessageEvent[] | undefined {
    const targetNs = toNanoSec(targetTime);
    const ranges = this.#rangesByTopic.get(topic);
    if (ranges == undefined || ranges.length === 0) {
      return undefined;
    }

    const range = ranges.find((entry) => entry.overlapsReceiveTime(targetNs));
    if (range == undefined) {
      return undefined;
    }

    const replayableFrames = range.framesForReceiveTime(targetNs);
    return replayableFrames.length > 0 ? replayableFrames : undefined;
  }

  public framesForPublishTime(topic: string, targetTime: Time): MessageEvent[] | undefined {
    const targetNs = toNanoSec(targetTime);
    const ranges = this.#rangesByTopic.get(topic);
    if (ranges == undefined || ranges.length === 0) {
      return undefined;
    }

    const range = ranges.find((entry) => entry.overlapsPublishTime(targetNs));
    if (range == undefined) {
      return undefined;
    }

    const replayableFrames = range.framesForPublishTime(targetNs);
    return replayableFrames.length > 0 ? replayableFrames : undefined;
  }

  public clear(): void {
    this.#rangesByTopic.clear();
    this.#activeRangeByTopic.clear();
    this.#byteSize = 0;
  }

  public clearTopic(topic: string): void {
    const ranges = this.#rangesByTopic.get(topic);
    if (ranges == undefined) {
      return;
    }
    for (const range of ranges) {
      this.#byteSize -= range.size;
    }
    this.#rangesByTopic.delete(topic);
    this.#activeRangeByTopic.delete(topic);
  }

  public byteSize(): number {
    return this.#byteSize;
  }

  #mergeOverlappingRanges(topic: string): void {
    const ranges = this.#rangesByTopic.get(topic);
    if (ranges == undefined || ranges.length <= 1) {
      return;
    }

    let merged = false;
    ranges.sort(compareRangesByPublishTime);
    for (let i = 0; i < ranges.length - 1; ) {
      const current = ranges[i]!;
      const next = ranges[i + 1]!;
      if (current.overlapsRange(next)) {
        current.merge(next);
        ranges.splice(i + 1, 1);
        if (this.#activeRangeByTopic.get(topic) === next) {
          this.#activeRangeByTopic.set(topic, current);
        }
        merged = true;
      } else {
        i++;
      }
    }
    if (merged) {
      this.#recomputeByteSize();
    }
  }

  #recomputeByteSize(): void {
    let byteSize = 0;
    for (const ranges of this.#rangesByTopic.values()) {
      for (const range of ranges) {
        byteSize += range.size;
      }
    }
    this.#byteSize = byteSize;
  }

  #pruneToBudget(): void {
    while (this.#byteSize > this.#maxBytes) {
      const candidate = this.#rangeFurthestFromTarget();
      if (candidate == undefined) {
        return;
      }

      const removedBytes = candidate.range.trimFurthestFromReceiveTime(this.#targetReceiveTimeNs);
      if (removedBytes > 0) {
        this.#byteSize -= removedBytes;
        if (candidate.range.isEmpty()) {
          this.#removeRange(candidate.topic, candidate.range);
        }
        continue;
      }

      this.#byteSize -= candidate.range.size;
      this.#removeRange(candidate.topic, candidate.range);
    }
  }

  #rangeFurthestFromTarget(): { topic: string; range: CachedVideoRange } | undefined {
    let result: { topic: string; range: CachedVideoRange } | undefined;
    let resultDistance = -1n;

    for (const [topic, ranges] of this.#rangesByTopic) {
      for (const range of ranges) {
        const distance = range.distanceFromReceiveTime(this.#targetReceiveTimeNs);
        if (result == undefined || distance > resultDistance) {
          result = { topic, range };
          resultDistance = distance;
        }
      }
    }

    return result;
  }

  #removeRange(topic: string, range: CachedVideoRange): void {
    const ranges = this.#rangesByTopic.get(topic);
    if (ranges == undefined) {
      return;
    }
    const index = ranges.indexOf(range);
    if (index >= 0) {
      ranges.splice(index, 1);
    }
    if (this.#activeRangeByTopic.get(topic) === range) {
      this.#activeRangeByTopic.delete(topic);
    }
    if (ranges.length === 0) {
      this.#rangesByTopic.delete(topic);
    }
  }
}

class CachedVideoRange {
  public readonly frames: CachedVideoFrame[] = [];
  public size = 0;

  public addFrame(frame: CachedVideoFrame): number {
    const existingIndex = this.frames.findIndex(
      (entry) => entry.publishTimeNs === frame.publishTimeNs,
    );
    let byteDelta = frame.byteLength;
    if (existingIndex >= 0) {
      byteDelta -= this.frames[existingIndex]!.byteLength;
      this.frames.splice(existingIndex, 1, frame);
    } else {
      this.frames.push(frame);
    }
    this.frames.sort(compareCachedFramesByPublishTime);
    this.size += byteDelta;
    return byteDelta;
  }

  public merge(other: CachedVideoRange): void {
    for (const frame of other.frames) {
      this.addFrame(frame);
    }
  }

  public framesForReceiveTime(targetNs: bigint): MessageEvent[] {
    const targetIndex = findLastIndex(this.frames, (frame) => frame.receiveTimeNs <= targetNs);
    return targetIndex >= 0 ? this.#framesForTargetIndex(targetIndex, targetNs) : [];
  }

  public framesForPublishTime(targetNs: bigint): MessageEvent[] {
    let targetIndex = -1;
    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i]!;
      if (frame.publishTimeNs <= targetNs) {
        targetIndex = i;
      } else {
        break;
      }
    }
    return targetIndex >= 0 ? this.#framesForTargetIndex(targetIndex) : [];
  }

  #framesForTargetIndex(targetIndex: number, maxReceiveTimeNs?: bigint): MessageEvent[] {
    let keyframeIndex = -1;
    for (let i = targetIndex; i >= 0; i--) {
      const frame = this.frames[i]!;
      if (maxReceiveTimeNs != undefined && frame.receiveTimeNs > maxReceiveTimeNs) {
        continue;
      }
      if (frame.isKeyframe) {
        keyframeIndex = i;
        break;
      }
    }
    if (keyframeIndex < 0) {
      return [];
    }

    return this.frames
      .slice(keyframeIndex, targetIndex + 1)
      .filter((frame) => maxReceiveTimeNs == undefined || frame.receiveTimeNs <= maxReceiveTimeNs)
      .map((frame) => frame.messageEvent);
  }

  public trimFurthestFromReceiveTime(targetNs: bigint): number {
    if (this.frames.length === 0) {
      return 0;
    }

    const distanceFromStart = absBigInt(targetNs - this.firstReceiveTime());
    const distanceFromEnd = absBigInt(targetNs - this.lastReceiveTime());
    let removed: CachedVideoFrame[];

    if (distanceFromStart > distanceFromEnd) {
      const secondKeyframeIndex = this.frames.findIndex(
        (frame, index) => index > 0 && frame.isKeyframe,
      );
      if (secondKeyframeIndex <= 0) {
        return 0;
      }
      removed = this.frames.splice(0, secondKeyframeIndex);
    } else {
      const lastKeyframeIndex = findLastIndex(this.frames, (frame) => frame.isKeyframe);
      if (lastKeyframeIndex < 0) {
        return 0;
      }
      removed = this.frames.splice(lastKeyframeIndex);
    }

    const removedBytes = sumByteLength(removed);
    this.size -= removedBytes;
    return removedBytes;
  }

  public overlapsReceiveTime(timeNs: bigint): boolean {
    return (
      this.frames.length > 0 &&
      this.firstReceiveTime() <= timeNs &&
      this.lastReceiveTime() >= timeNs
    );
  }

  public overlapsPublishTime(timeNs: bigint): boolean {
    return (
      this.frames.length > 0 &&
      this.firstPublishTime() <= timeNs &&
      this.lastPublishTime() >= timeNs
    );
  }

  public overlapsRange(other: CachedVideoRange): boolean {
    if (this.frames.length === 0 || other.frames.length === 0) {
      return false;
    }
    return (
      this.firstPublishTime() <= other.lastPublishTime() &&
      other.firstPublishTime() <= this.lastPublishTime()
    );
  }

  public distanceFromReceiveTime(timeNs: bigint): bigint {
    if (this.frames.length === 0) {
      return 0n;
    }
    const fromStart = absBigInt(timeNs - this.firstReceiveTime());
    const fromEnd = absBigInt(timeNs - this.lastReceiveTime());
    return fromStart < fromEnd ? fromStart : fromEnd;
  }

  public isEmpty(): boolean {
    return this.frames.length === 0;
  }

  public firstPublishTime(): bigint {
    return this.frames[0]?.publishTimeNs ?? 0n;
  }

  public lastPublishTime(): bigint {
    return this.frames[this.frames.length - 1]?.publishTimeNs ?? 0n;
  }

  public firstReceiveTime(): bigint {
    return minBigInt(this.frames.map((frame) => frame.receiveTimeNs));
  }

  public lastReceiveTime(): bigint {
    return maxBigInt(this.frames.map((frame) => frame.receiveTimeNs));
  }
}

function compareCachedFramesByPublishTime(a: CachedVideoFrame, b: CachedVideoFrame): number {
  if (a.publishTimeNs < b.publishTimeNs) {
    return -1;
  }
  if (a.publishTimeNs > b.publishTimeNs) {
    return 1;
  }
  if (a.receiveTimeNs < b.receiveTimeNs) {
    return -1;
  }
  if (a.receiveTimeNs > b.receiveTimeNs) {
    return 1;
  }
  return 0;
}

function compareRangesByPublishTime(a: CachedVideoRange, b: CachedVideoRange): number {
  if (a.firstPublishTime() < b.firstPublishTime()) {
    return -1;
  }
  if (a.firstPublishTime() > b.firstPublishTime()) {
    return 1;
  }
  return 0;
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) {
      return i;
    }
  }
  return -1;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function sumByteLength(frames: readonly CachedVideoFrame[]): number {
  return frames.reduce((sum, frame) => sum + frame.byteLength, 0);
}

function minBigInt(values: readonly bigint[]): bigint {
  let result = values[0] ?? 0n;
  for (const value of values) {
    if (value < result) {
      result = value;
    }
  }
  return result;
}

function maxBigInt(values: readonly bigint[]): bigint {
  let result = values[0] ?? 0n;
  for (const value of values) {
    if (value > result) {
      result = value;
    }
  }
  return result;
}
