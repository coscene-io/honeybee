// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264, H265 } from "@foxglove/den/video";
import { Time, fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

const VIDEO_FORMATS = new Set(["h264", "h265"]);
export const DEFAULT_VIDEO_GOP_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_KEYFRAME_INDEX_MAX_ENTRIES_PER_TOPIC = 20_000;

/**
 * Budget shared by every auto-registered {@link VideoGopCache} (REI-125).
 *
 * The per-cache default is 64 MB, but one cache exists per video panel, so a 5-camera layout could
 * hold 320 MB of compressed frames in the JS heap on top of the 1 GB block cache. Multi-camera
 * layouts now divide this shared ceiling instead of multiplying the per-cache one; a single-camera
 * layout still gets the full 64 MB.
 */
export const DEFAULT_VIDEO_GOP_CACHE_TOTAL_MAX_BYTES = 128 * 1024 * 1024;

/**
 * Divides {@link DEFAULT_VIDEO_GOP_CACHE_TOTAL_MAX_BYTES} across the live caches and re-prunes
 * them whenever the population changes.
 */
class VideoGopCacheBudget {
  readonly #caches = new Set<VideoGopCache>();
  #totalBytes: number;

  public constructor(totalBytes: number) {
    this.#totalBytes = totalBytes;
  }

  public shareBytes(cacheCount: number = this.#caches.size): number {
    return Math.min(
      DEFAULT_VIDEO_GOP_CACHE_MAX_BYTES,
      Math.floor(this.#totalBytes / Math.max(1, cacheCount)),
    );
  }

  public register(cache: VideoGopCache): void {
    this.#caches.add(cache);
    this.#rebalance();
  }

  public unregister(cache: VideoGopCache): void {
    if (this.#caches.delete(cache)) {
      this.#rebalance();
    }
  }

  public getCacheCount(): number {
    return this.#caches.size;
  }

  /** Test helper: drop all registrations so suites do not leak shares into each other. */
  public resetForTests(totalBytes: number = DEFAULT_VIDEO_GOP_CACHE_TOTAL_MAX_BYTES): void {
    this.#caches.clear();
    this.#totalBytes = totalBytes;
  }

  #rebalance(): void {
    const share = this.shareBytes();
    for (const cache of this.#caches) {
      cache.setMaxBytes(share);
    }
  }
}

/** Process-wide budget shared by all auto-registered video GOP caches. */
export const globalVideoGopCacheBudget = new VideoGopCacheBudget(
  DEFAULT_VIDEO_GOP_CACHE_TOTAL_MAX_BYTES,
);

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
  mayNeedRewrite: boolean;
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
      case "h264": {
        if (!H264.IsAnnexB(message.data)) {
          return undefined;
        }
        const h264Info = H264.GetFrameInfo(message.data);
        return {
          frame: message as CompressedVideoLike,
          isKeyframe: h264Info.isKeyFrame,
          mayNeedRewrite: h264Info.mayNeedRewrite,
          byteLength: message.data.byteLength,
        };
      }
      case "h265":
        if (!H265.IsAnnexB(message.data)) {
          return undefined;
        }
        return {
          frame: message as CompressedVideoLike,
          isKeyframe: H265.IsKeyframe(message.data),
          mayNeedRewrite: false,
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
  // Sorted keyframe receive times per topic. Kept independent of the frame LRU so it survives
  // #pruneToBudget eviction: even after a region's frame data is evicted we still know where the
  // keyframes are, so a later seek can read exactly [keyframe, target] instead of guessing windows.
  readonly #keyframeReceiveTimesByTopic = new Map<string, bigint[]>();
  readonly #maxKeyframeIndexEntriesPerTopic: number;
  /** When true this cache participates in the shared budget and must be `dispose()`d. */
  readonly #sharesBudget: boolean;
  #maxBytes: number;
  #byteSize = 0;
  #targetReceiveTimeNs = 0n;

  public constructor(
    options: {
      maxBytes?: number;
      maxKeyframeIndexEntriesPerTopic?: number;
      /**
       * Join the process-wide budget shared by all video panels (REI-125). Opt-in so standalone
       * caches keep the fixed per-cache default. Callers must `dispose()` to release their share.
       */
      sharedBudget?: boolean;
    } = {},
  ) {
    this.#sharesBudget = options.sharedBudget === true && options.maxBytes == undefined;
    this.#maxBytes = options.maxBytes ?? DEFAULT_VIDEO_GOP_CACHE_MAX_BYTES;
    this.#maxKeyframeIndexEntriesPerTopic =
      options.maxKeyframeIndexEntriesPerTopic ?? DEFAULT_KEYFRAME_INDEX_MAX_ENTRIES_PER_TOPIC;
    if (this.#sharesBudget) {
      globalVideoGopCacheBudget.register(this);
    }
  }

  public getMaxBytes(): number {
    return this.#maxBytes;
  }

  public getByteSize(): number {
    return this.#byteSize;
  }

  /** Set this cache's byte ceiling and immediately evict down to it. */
  public setMaxBytes(maxBytes: number): void {
    this.#maxBytes = maxBytes;
    this.#pruneToBudget();
  }

  /** Release this cache's share of the global budget. Safe to call more than once. */
  public dispose(): void {
    this.clear();
    if (this.#sharesBudget) {
      globalVideoGopCacheBudget.unregister(this);
    }
  }

  public addFrame(msg: MessageEvent): boolean {
    const cachedFrame = cachedVideoFrame(msg);
    if (cachedFrame == undefined) {
      return false;
    }

    this.#targetReceiveTimeNs = cachedFrame.receiveTimeNs;
    this.#recordKeyframe(cachedFrame);

    const ranges = this.#rangesByTopic.get(msg.topic) ?? [];
    let range = ranges.find((entry) => entry.overlapsPublishTime(cachedFrame.publishTimeNs));
    range ??= this.#activeRangeByTopic.get(msg.topic);
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

  public addKnownKeyframeReceiveTime(topic: string, receiveTime: Time): void {
    this.#recordKeyframeReceiveTime(topic, toNanoSec(receiveTime));
  }

  public handleSeek(targetTime: Time): void {
    this.#targetReceiveTimeNs = toNanoSec(targetTime);
    this.#activeRangeByTopic.clear();
  }

  public addFrameRange(messages: readonly MessageEvent[]): void {
    if (messages.length === 0) {
      return;
    }

    const framesByTopic = new Map<string, CachedVideoFrame[]>();
    for (const msg of messages) {
      const frame = cachedVideoFrame(msg);
      if (frame == undefined) {
        continue;
      }
      this.#recordKeyframe(frame);
      const frames = framesByTopic.get(msg.topic) ?? [];
      frames.push(frame);
      framesByTopic.set(msg.topic, frames);
    }

    for (const [topic, frames] of framesByTopic) {
      if (frames.length === 0) {
        continue;
      }
      let ranges = this.#rangesByTopic.get(topic);
      if (ranges == undefined) {
        ranges = [];
        this.#rangesByTopic.set(topic, ranges);
      }

      const range = new CachedVideoRange();
      for (const frame of frames) {
        this.#byteSize += range.addFrame(frame);
      }
      ranges.push(range);
      this.#activeRangeByTopic.set(topic, range);
      this.#targetReceiveTimeNs = range.lastReceiveTime();
      this.#mergeOverlappingRanges(topic);
      this.#pruneToBudget();
    }
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

  public seekAndReturnFramesForReceiveTime(
    topic: string,
    targetTime: Time,
  ): MessageEvent[] | undefined {
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
    if (replayableFrames.length === 0) {
      return undefined;
    }
    this.#activeRangeByTopic.set(topic, range);
    return replayableFrames;
  }

  public framesForPublishTime(
    topic: string,
    targetTime: Time,
    afterTime?: Time,
  ): MessageEvent[] | undefined {
    const targetNs = toNanoSec(targetTime);
    const afterNs = afterTime != undefined ? toNanoSec(afterTime) : undefined;
    const ranges = this.#rangesByTopic.get(topic);
    if (ranges == undefined || ranges.length === 0) {
      return undefined;
    }

    const range = ranges.find((entry) => entry.overlapsPublishTime(targetNs));
    if (range == undefined) {
      return undefined;
    }

    const replayableFrames = range.framesForPublishTime(targetNs, afterNs);
    return replayableFrames.length > 0 ? replayableFrames : undefined;
  }

  public seekAndReturnFramesForPublishTime(
    topic: string,
    targetTime: Time,
  ): MessageEvent[] | undefined {
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
    if (replayableFrames.length === 0) {
      return undefined;
    }
    this.#activeRangeByTopic.set(topic, range);
    return replayableFrames;
  }

  /**
   * Largest known keyframe receive time at or before `target`, or undefined if none is known.
   * Backed by {@link #keyframeReceiveTimesByTopic}, which outlives frame eviction, so this can
   * point a cold seek at the exact GOP start even when the frame data is no longer cached.
   */
  public nearestKeyframeReceiveTimeAtOrBefore(topic: string, target: Time): Time | undefined {
    const times = this.#keyframeReceiveTimesByTopic.get(topic);
    if (times == undefined || times.length === 0) {
      return undefined;
    }
    const found = largestAtOrBefore(times, toNanoSec(target));
    return found != undefined ? fromNanoSec(found) : undefined;
  }

  public clear(): void {
    this.#rangesByTopic.clear();
    this.#activeRangeByTopic.clear();
    this.#keyframeReceiveTimesByTopic.clear();
    this.#byteSize = 0;
  }

  public clearTopic(topic: string): void {
    this.#keyframeReceiveTimesByTopic.delete(topic);
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

  #recordKeyframe(frame: CachedVideoFrame): void {
    if (!frame.isKeyframe) {
      return;
    }
    this.#recordKeyframeReceiveTime(frame.messageEvent.topic, frame.receiveTimeNs);
  }

  #recordKeyframeReceiveTime(topic: string, receiveTimeNs: bigint): void {
    let times = this.#keyframeReceiveTimesByTopic.get(topic);
    if (times == undefined) {
      times = [];
      this.#keyframeReceiveTimesByTopic.set(topic, times);
    }
    sortedInsertUnique(times, receiveTimeNs);
    if (times.length > this.#maxKeyframeIndexEntriesPerTopic) {
      times.splice(0, times.length - this.#maxKeyframeIndexEntriesPerTopic);
    }
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
    const lastFrame = this.frames[this.frames.length - 1];
    let byteDelta = frame.byteLength;
    if (lastFrame == undefined || lastFrame.publishTimeNs < frame.publishTimeNs) {
      this.frames.push(frame);
      this.size += byteDelta;
      return byteDelta;
    }

    if (lastFrame.publishTimeNs === frame.publishTimeNs) {
      byteDelta -= lastFrame.byteLength;
      this.frames.splice(this.frames.length - 1, 1, frame);
      this.size += byteDelta;
      return byteDelta;
    }

    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.frames[mid]!.publishTimeNs < frame.publishTimeNs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const existingFrame = this.frames[lo];
    if (existingFrame?.publishTimeNs === frame.publishTimeNs) {
      byteDelta -= existingFrame.byteLength;
      this.frames.splice(lo, 1, frame);
    } else {
      this.frames.splice(lo, 0, frame);
    }

    this.size += byteDelta;
    return byteDelta;
  }

  public merge(other: CachedVideoRange): void {
    for (const frame of other.frames) {
      this.addFrame(frame);
    }
  }

  public framesForReceiveTime(targetNs: bigint): MessageEvent[] {
    const keyframeIndex = findLastIndex(
      this.frames,
      (frame) => frame.isKeyframe && frame.receiveTimeNs <= targetNs,
    );
    if (keyframeIndex < 0) {
      return [];
    }

    const replayableFrames: MessageEvent[] = [];
    for (let i = keyframeIndex; i < this.frames.length; i++) {
      const frame = this.frames[i]!;
      if (frame.receiveTimeNs > targetNs) {
        break;
      }
      replayableFrames.push(frame.messageEvent);
    }
    return replayableFrames;
  }

  public framesForPublishTime(targetNs: bigint, afterNs?: bigint): MessageEvent[] {
    return framesForPublishTime(this.frames, targetNs, afterNs);
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

function compareRangesByPublishTime(a: CachedVideoRange, b: CachedVideoRange): number {
  if (a.firstPublishTime() < b.firstPublishTime()) {
    return -1;
  }
  if (a.firstPublishTime() > b.firstPublishTime()) {
    return 1;
  }
  return 0;
}

/** Insert `value` into the ascending array `arr`, skipping it if already present. */
function sortedInsertUnique(arr: bigint[], value: bigint): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const current = arr[mid]!;
    if (current === value) {
      return;
    }
    if (current < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  arr.splice(lo, 0, value);
}

/** Largest entry of the ascending array `arr` that is `<= value`, or undefined if none. */
function largestAtOrBefore(arr: readonly bigint[], value: bigint): bigint | undefined {
  let lo = 0;
  let hi = arr.length;
  let result: bigint | undefined;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const current = arr[mid]!;
    if (current <= value) {
      result = current;
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return result;
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

function cachedVideoFrame(msg: MessageEvent): CachedVideoFrame | undefined {
  const frameInfo = parseVideoFrameInfo(msg);
  if (frameInfo == undefined) {
    return undefined;
  }
  return {
    messageEvent: msg,
    receiveTimeNs: toNanoSec(msg.receiveTime),
    publishTimeNs: toNanoSec(frameInfo.frame.timestamp),
    isKeyframe: frameInfo.isKeyframe,
    byteLength: frameInfo.byteLength,
  };
}

function framesForPublishTime(
  frames: readonly CachedVideoFrame[],
  targetNs: bigint,
  afterNs?: bigint,
): MessageEvent[] {
  let targetIndex = -1;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    if (frame.publishTimeNs <= targetNs) {
      targetIndex = i;
    } else {
      break;
    }
  }
  if (targetIndex < 0) {
    return [];
  }

  const framesThroughTarget = frames.slice(0, targetIndex + 1);
  const keyframeIndex = findLastIndex(framesThroughTarget, (frame) => frame.isKeyframe);

  if (afterNs != undefined) {
    const afterIndex = findLastIndex(
      framesThroughTarget,
      (frame) => frame.publishTimeNs <= afterNs,
    );
    if (afterIndex >= 0) {
      const startIndex =
        keyframeIndex >= 0 ? Math.max(afterIndex + 1, keyframeIndex) : afterIndex + 1;
      return frames.slice(startIndex, targetIndex + 1).map((frame) => frame.messageEvent);
    }

    if (keyframeIndex >= 0) {
      return frames.slice(keyframeIndex, targetIndex + 1).map((frame) => frame.messageEvent);
    }
    return [];
  }

  if (keyframeIndex < 0) {
    return [];
  }

  return frames.slice(keyframeIndex, targetIndex + 1).map((frame) => frame.messageEvent);
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
