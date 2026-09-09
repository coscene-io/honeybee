// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import {
  Time,
  clampTime,
  compare,
  fromNanoSec,
  fromSec,
  subtract,
  toNanoSec,
} from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { playbackPerformanceMetrics } from "@foxglove/studio-base/services/playbackPerformanceTelemetry";

import type {
  CompressedVideoFrameEvent,
  ImageSetImageResult,
  SetCompressedVideoFramesOptions,
} from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";
import { normalizeCompressedVideo } from "./imageNormalizers";
import {
  VideoGopCache,
  detectBFrames,
  parseVideoFrameInfo,
  type VideoFrameInfo,
} from "./videoGopCache";
import { filterCompressedVideoQueue } from "./videoMessageQueue";
import { IRenderer } from "../../IRenderer";
import { PartialMessageEvent } from "../../SceneExtension";

const log = Logger.getLogger(__filename);
const LOOKBACK_WINDOWS_SEC = [1, 2, 5, 10, 20, 40, 60] as const;
const LOOKBACK_RANGE_RETRY_DELAYS_MS = [50, 250, 1000] as const;
const LOOKBACK_RANGE_READ_TIMEOUT_MS = 5_000;
export const MAX_PLAYBACK_TICK_VIDEO_FRAMES = 12;
type RangeReadResolution = "success" | "cancelled" | "exception" | "timeout" | "unavailable";
export type VideoDisplayMode = "playback" | "seek";
export type CompressedVideoDisplayFrames = (
  frames: readonly CompressedVideoFrameEvent[],
  mode: VideoDisplayMode,
  options?: SetCompressedVideoFramesOptions,
) => ImageSetImageResult | Promise<ImageSetImageResult>;
export type SeekKeyframeSearchState = { active: boolean };
export type SeekKeyframeSearchChange = (state: SeekKeyframeSearchState) => void;
type VideoInputEvent = MessageEvent<VideoFrameInfo["frame"]>;
type PendingTick = {
  frames: readonly VideoInputEvent[];
  target: VideoInputEvent;
  options: SetCompressedVideoFramesOptions;
  keyframe: boolean;
  gap: boolean;
};
type ControllerRenderer = Pick<
  IRenderer,
  "currentTime" | "startTime" | "subscribeMessageRange" | "isPlaybackStopped"
>;

export class CompressedVideoController {
  readonly #topic: string;
  readonly #renderer: ControllerRenderer;
  readonly #cache = new VideoGopCache();
  #displayFrames: CompressedVideoDisplayFrames;
  #resetDecoder?: () => void;
  #cancelLateTarget?: () => void;
  #needsCancelLateTarget = false;
  #onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  #onBFramesDetected?: () => void;
  #generation = 0;
  #active = false;
  #scheduled = false;
  #pending: PendingTick | undefined;
  #desiredTarget: VideoInputEvent | undefined;
  #decoderFrontier: VideoInputEvent | undefined;
  #continuous = false;
  #gap = false;
  #seekTargetNs: bigint | undefined;
  #lastInputPublishTimeNs: bigint | undefined;
  #reportedBFrames = false;
  #needsReset = false;
  readonly #state: { lookbackCancel?: () => void; lookbackGeneration?: number } = {};

  public constructor(args: {
    topic: string;
    renderer: ControllerRenderer;
    displayFrames: CompressedVideoDisplayFrames;
    resetDecoder?: () => void;
    cancelLateTarget?: () => void;
    onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
    onBFramesDetected?: () => void;
  }) {
    this.#topic = args.topic;
    this.#renderer = args.renderer;
    this.#displayFrames = args.displayFrames;
    this.#resetDecoder = args.resetDecoder;
    this.#cancelLateTarget = args.cancelLateTarget;
    this.#onSeekKeyframeSearchChange = args.onSeekKeyframeSearchChange;
    this.#onBFramesDetected = args.onBFramesDetected;
  }
  public updateOptions(args: {
    displayFrames?: CompressedVideoDisplayFrames;
    resetDecoder?: () => void;
    cancelLateTarget?: () => void;
    onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
    onBFramesDetected?: () => void;
  }): void {
    this.#displayFrames = args.displayFrames ?? this.#displayFrames;
    this.#resetDecoder = args.resetDecoder ?? this.#resetDecoder;
    this.#cancelLateTarget = args.cancelLateTarget ?? this.#cancelLateTarget;
    this.#onSeekKeyframeSearchChange =
      args.onSeekKeyframeSearchChange ?? this.#onSeekKeyframeSearchChange;
    this.#onBFramesDetected = args.onBFramesDetected ?? this.#onBFramesDetected;
  }

  /** Only this tick's inputs may become a playback batch. No cache read occurs here or in drain. */
  public enqueueVideoFrames(
    input: readonly PartialMessageEvent<CompressedVideo>[],
    options: SetCompressedVideoFramesOptions = {},
  ): void {
    if (input.length === 0) {
      return;
    }
    let frames = input
      .filter((event) => event.topic === this.#topic)
      .map(
        (event): VideoInputEvent => ({
          ...event,
          message: {
            timestamp: {
              sec: event.message.timestamp?.sec ?? 0,
              nsec: event.message.timestamp?.nsec ?? 0,
            },
            frame_id: event.message.frame_id ?? "",
            format: event.message.format ?? "",
            data:
              event.message.data instanceof Uint8Array || Array.isArray(event.message.data)
                ? event.message.data
                : [],
          },
        }),
      );
    if (frames.length === 0) {
      return;
    }
    let epochStart = 0;
    let regressed = false;
    for (let i = 0; i < frames.length; i++) {
      const timestamp = toNanoSec(frames[i]!.message.timestamp);
      if (this.#lastInputPublishTimeNs != undefined && timestamp < this.#lastInputPublishTimeNs) {
        epochStart = i;
        regressed = true;
      }
      this.#lastInputPublishTimeNs = timestamp;
    }
    if (regressed) {
      const timestamp = this.#lastInputPublishTimeNs;
      this.handleTimestampRegression();
      this.#lastInputPublishTimeNs = timestamp;
      frames = frames.slice(epochStart);
    }
    this.#needsCancelLateTarget = true;
    this.#schedule();
    this.#cache.addFrames(frames);
    if (!this.#reportedBFrames) {
      for (const frame of frames) {
        if (parseVideoFrameInfo(frame)?.isKeyframe === true && detectBFrames(frame) === true) {
          this.#reportedBFrames = true;
          this.#onBFramesDetected?.();
          break;
        }
      }
    }
    const target = frames[frames.length - 1]!;
    this.#desiredTarget = target;
    // Seeking consumes cached inputs through its independent recovery request.
    if (this.#seekTargetNs != undefined) {
      return;
    }
    // Annotation matching gates presentation, never the encoded dependency chain.
    const selected = filterCompressedVideoQueue(frames) as VideoInputEvent[];
    const keyframe = parseVideoFrameInfo(selected[0]!)?.isKeyframe === true;
    const gap = !keyframe && (this.#gap || this.#pending != undefined);
    this.#gap = false;
    if (selected.length > MAX_PLAYBACK_TICK_VIDEO_FRAMES || this.#renderer.isPlaybackStopped()) {
      this.#pending = undefined;
      this.#gap = true;
      return;
    }
    this.#pending = {
      frames: selected,
      target,
      options,
      keyframe,
      gap,
    };
    this.#schedule();
  }

  /** State-only ticks must still cancel obsolete seek work and discard stopped playback inputs. */
  public updatePlaybackState(): void {
    if (this.#seekTargetNs != undefined && this.#renderer.currentTime > this.#seekTargetNs) {
      this.resetPlaybackState();
    }
    if (this.#renderer.isPlaybackStopped() && this.#pending != undefined) {
      this.#pending = undefined;
      this.#gap = true;
    }
  }

  public handleSeek(): void {
    this.resetPlaybackState();
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cache.handleSeek(fromNanoSec(this.#renderer.currentTime));
    this.#schedule();
  }

  public resetPlaybackState(): void {
    this.#generation++;
    this.#state.lookbackCancel?.();
    this.#state.lookbackCancel = undefined;
    this.#state.lookbackGeneration = undefined;
    this.#onSeekKeyframeSearchChange?.({ active: false });
    this.#seekTargetNs = undefined;
    this.#pending = undefined;
    this.#desiredTarget = undefined;
    this.#decoderFrontier = undefined;
    this.#continuous = false;
    this.#gap = false;
    this.#lastInputPublishTimeNs = undefined;
    this.#needsReset = true;
    // Reset RPC is started by drain, after the panel has called done().
    this.#schedule();
  }
  public handleTimestampRegression(): void {
    this.resetPlaybackState();
    this.#cache.clearTopic(this.#topic);
  }
  public clear(): void {
    this.resetPlaybackState();
    this.#cache.clearTopic(this.#topic);
  }
  public dispose(): void {
    this.clear();
    this.#scheduled = false;
    this.#needsReset = false;
    this.#needsCancelLateTarget = false;
    this.#generation++;
  }

  #schedule(): void {
    if (this.#scheduled) {
      return;
    }
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.#needsCancelLateTarget) {
        this.#needsCancelLateTarget = false;
        this.#cancelLateTarget?.();
      }
      if (this.#needsReset) {
        this.#needsReset = false;
        this.#resetDecoder?.();
      }
      if (!this.#active) {
        void this.#drain().catch((error: unknown) => {
          log.error(error);
        });
      }
    });
  }

  async #drain(): Promise<void> {
    const generation = this.#generation;
    if (this.#seekTargetNs != undefined) {
      this.#active = true;
      try {
        await this.#recoverSeek(generation, this.#seekTargetNs);
      } finally {
        this.#active = false;
        // Updated by enqueue/seek while recovery was awaited.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.#seekTargetNs != undefined || this.#pending != undefined) {
          this.#schedule();
        }
      }
      return;
    }
    const tick = this.#pending;
    this.#pending = undefined;
    if (tick == undefined) {
      return;
    }
    if (this.#renderer.isPlaybackStopped()) {
      this.#gap = true;
      return;
    }
    if (!tick.keyframe && (!this.#continuous || tick.gap || this.#decoderFrontier == undefined)) {
      this.#continuous = false;
      return;
    }
    this.#active = true;
    try {
      const result = await this.#displayFrames(
        tick.frames.map(normalizeVideoMessageEvent),
        "playback",
        {
          ...tick.options,
          retainLateTarget: false,
          targetFrameTimeoutMs: 30,
          anyFrameTimeoutMs: tick.keyframe ? 100 : undefined,
          isVideoFrameRequestCurrent: () =>
            generation === this.#generation &&
            (!this.#renderer.isPlaybackStopped() || this.#desiredTarget === tick.target) &&
            tick.options.isVideoFrameRequestCurrent?.() !== false,
        },
      );
      if (generation === this.#generation) {
        const drained = result.ok || result.reason === "timeout";
        this.#continuous = drained;
        this.#decoderFrontier = drained ? tick.target : undefined;
        // A stopped/superseded display request is not a decoder error.
        if (!result.ok && result.reason !== "timeout" && result.reason !== "stale") {
          this.#generation++;
          this.#needsReset = true;
        }
      }
    } catch (error) {
      if (generation === this.#generation) {
        this.#generation++;
        this.#continuous = false;
        this.#needsReset = true;
      }
      throw error;
    } finally {
      this.#active = false;
      // Updated by enqueue/seek while the decoder was awaited.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.#pending != undefined || this.#seekTargetNs != undefined || this.#needsReset) {
        this.#schedule();
      }
    }
  }

  async #recoverSeek(generation: number, targetNs: bigint): Promise<void> {
    const targetTime = fromNanoSec(targetNs);
    try {
      let frames = this.#cache.framesForReceiveTime(this.#topic, targetTime);
      if (frames == undefined && this.#renderer.subscribeMessageRange != undefined) {
        frames = await this.#lookbackFrames(generation, targetTime);
      }
      if (
        generation !== this.#generation ||
        this.#renderer.currentTime !== targetNs ||
        frames == undefined
      ) {
        return;
      }
      const normalized = frames.map((frame) =>
        normalizeVideoMessageEvent(frame as MessageEvent<CompressedVideo>),
      );
      const result = await this.#displayFrames(normalized, "seek", {
        retainLateTarget: true,
        targetFrameTimeoutMs: 200,
        anyFrameTimeoutMs: 2000,
        isVideoFrameRequestCurrent: () =>
          generation === this.#generation && this.#renderer.currentTime === targetNs,
      });
      if (generation === this.#generation) {
        this.#continuous = result.ok || result.reason === "timeout";
        this.#decoderFrontier = this.#continuous ? normalized.at(-1) : undefined;
      }
    } finally {
      if (generation === this.#generation) {
        this.#seekTargetNs = undefined;
        this.#state.lookbackGeneration = undefined;
        this.#onSeekKeyframeSearchChange?.({ active: false });
      }
    }
  }

  async #lookbackFrames(generation: number, targetTime: Time): Promise<MessageEvent[] | undefined> {
    this.#state.lookbackGeneration = generation;
    const metricsSeekId = playbackPerformanceMetrics.captureActiveSeek();
    // This only keeps telemetry open; it never blocks the Player or panel tick.
    const finishMetricsTask = playbackPerformanceMetrics.beginVisualTask();
    let found = false;
    try {
      this.#onSeekKeyframeSearchChange?.({ active: true });
      const startTime = fromNanoSec(this.#renderer.startTime ?? 0n);
      const knownKeyframe = this.#cache.nearestKeyframeReceiveTimeAtOrBefore(
        this.#topic,
        targetTime,
      );
      const starts = [
        ...(knownKeyframe != undefined ? [knownKeyframe] : []),
        ...LOOKBACK_WINDOWS_SEC.map((seconds) => subtract(targetTime, fromSec(seconds))),
      ];
      let collected: MessageEvent[] = [];
      let coveredStart: Time | undefined;
      for (const requestedStart of starts) {
        if (!this.#isCurrentLookback(generation)) {
          return undefined;
        }
        const start = clampTime(requestedStart, startTime, targetTime);
        if (coveredStart != undefined && compare(start, coveredStart) >= 0) {
          continue;
        }
        const slice = await this.#readRangeWithRetries(
          generation,
          start,
          coveredStart ?? targetTime,
          metricsSeekId,
        );
        if (!this.#isCurrentLookback(generation)) {
          return undefined;
        }
        if (slice == undefined) {
          // The index may be sparse. A failed wide read must not prevent the short-window search.
          if (requestedStart === knownKeyframe) {
            continue;
          }
          return undefined;
        }
        collected = mergeFramesByReceiveTime(slice, collected);
        coveredStart = start;
        const gop = gopEndingAt(collected, this.#topic, targetTime);
        if (gop.length > 0) {
          this.#cache.addFrameRange(collected);
          found = true;
          return gop;
        }
        if (compare(start, startTime) === 0) {
          break;
        }
      }
      return undefined;
    } finally {
      playbackPerformanceMetrics.recordVideoLookback(
        metricsSeekId,
        !this.#isCurrentLookback(generation) ? "cancelled" : found ? "success" : "failure",
      );
      finishMetricsTask?.();
    }
  }

  #isCurrentLookback(generation: number): boolean {
    return (
      generation === this.#generation &&
      this.#state.lookbackGeneration === generation &&
      this.#renderer.currentTime === this.#seekTargetNs
    );
  }

  async #readRangeWithRetries(
    generation: number,
    startTime: Time,
    endTime: Time,
    metricsSeekId: number | undefined,
  ): Promise<MessageEvent[] | undefined> {
    let frames =
      metricsSeekId == undefined
        ? await this.#readRange(generation, startTime, endTime)
        : await this.#readRangeMeasured(generation, startTime, endTime, metricsSeekId);
    for (const retryDelayMs of LOOKBACK_RANGE_RETRY_DELAYS_MS) {
      if (frames != undefined || !this.#isCurrentLookback(generation)) {
        return frames;
      }
      await delay(retryDelayMs);
      if (!this.#isCurrentLookback(generation)) {
        return undefined;
      }
      playbackPerformanceMetrics.recordVideoRangeReadRetry(metricsSeekId);
      frames =
        metricsSeekId == undefined
          ? await this.#readRange(generation, startTime, endTime)
          : await this.#readRangeMeasured(generation, startTime, endTime, metricsSeekId);
    }
    return frames;
  }

  async #readRangeMeasured(
    generation: number,
    startTime: Time,
    endTime: Time,
    metricsSeekId: number,
  ): Promise<MessageEvent[] | undefined> {
    // The outcome distinguishes successful empty ranges from failures that should be retried.
    const outcomeRef: { outcome: RangeReadResolution } = { outcome: "timeout" };
    const frames = await this.#readRange(generation, startTime, endTime, outcomeRef);
    playbackPerformanceMetrics.recordVideoRangeRead(
      metricsSeekId,
      outcomeRef.outcome === "success"
        ? "success"
        : outcomeRef.outcome === "cancelled"
          ? "cancelled"
          : "failure",
    );
    return frames;
  }

  async #readRange(
    generation: number,
    startTime: Time,
    endTime: Time,
    outcomeRef?: { outcome: RangeReadResolution },
  ): Promise<MessageEvent[] | undefined> {
    const subscribeMessageRange = this.#renderer.subscribeMessageRange;
    if (subscribeMessageRange == undefined) {
      if (outcomeRef) {
        outcomeRef.outcome = "unavailable";
      }
      return [];
    }

    return await new Promise<MessageEvent[] | undefined>((resolve) => {
      let finished = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: (() => void) | undefined;
      const currentCancel = () => {
        finish([], "cancelled");
      };
      const finish = (frames: MessageEvent[] | undefined, resolution: RangeReadResolution) => {
        if (finished) {
          return;
        }
        finished = true;
        if (outcomeRef) {
          outcomeRef.outcome = resolution;
        }
        if (timeout != undefined) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        unsubscribe?.();
        unsubscribe = undefined;
        if (this.#state.lookbackCancel === currentCancel) {
          this.#state.lookbackCancel = undefined;
        }
        resolve(frames);
      };

      this.#state.lookbackCancel = currentCancel;
      unsubscribe = subscribeMessageRange({
        topic: this.#topic,
        timeRange: { start: startTime, end: endTime },
        onNewRangeIterator: async (iterator) => {
          try {
            const frames = await collectFramesInRange(iterator, this.#topic, startTime, endTime);
            if (this.#isCurrentLookback(generation)) {
              // A genuinely empty range is still a successful read.
              finish(frames, "success");
            }
          } catch {
            if (this.#isCurrentLookback(generation)) {
              finish(undefined, "exception");
            }
          }
        },
      });
      if (unsubscribe == undefined) {
        finish(undefined, "unavailable");
        return;
      }
      timeout = setTimeout(() => {
        finish(undefined, "timeout");
      }, LOOKBACK_RANGE_READ_TIMEOUT_MS);
    });
  }
}

/** Collect every video frame on `topic` with a receive time within `[startTime, endTime]`. */
async function collectFramesInRange(
  iterator: AsyncIterable<readonly MessageEvent[]>,
  topic: string,
  startTime: Time,
  endTime: Time,
): Promise<MessageEvent[]> {
  const frames: MessageEvent[] = [];
  for await (const batch of iterator) {
    for (const messageEvent of batch) {
      if (messageEvent.topic !== topic) {
        continue;
      }
      if (
        compare(messageEvent.receiveTime, startTime) < 0 ||
        compare(messageEvent.receiveTime, endTime) > 0
      ) {
        continue;
      }
      const frameInfo = parseVideoFrameInfo(messageEvent);
      if (frameInfo == undefined) {
        continue;
      }
      frames.push(normalizeVideoMessageEvent(messageEvent as MessageEvent<CompressedVideo>));
    }
  }
  return frames;
}

/**
 * Extract the GOP ending at `seekTime` from receive-time-ordered `frames`: the run from the last
 * keyframe at or before `seekTime` through the final frame at or before it. Returns [] if no
 * keyframe precedes the target.
 */
function gopEndingAt(
  frames: readonly MessageEvent[],
  topic: string,
  seekTime: Time,
): MessageEvent[] {
  let currentGop: MessageEvent[] = [];
  for (const messageEvent of frames) {
    if (messageEvent.topic !== topic) {
      continue;
    }
    if (compare(messageEvent.receiveTime, seekTime) > 0) {
      break;
    }
    const frameInfo = parseVideoFrameInfo(messageEvent);
    if (frameInfo == undefined) {
      continue;
    }
    if (frameInfo.isKeyframe) {
      currentGop = [];
    } else if (currentGop.length === 0) {
      continue;
    }
    currentGop.push(messageEvent);
  }
  return currentGop;
}

/** Merge receive-time-ascending ranges, removing only an identical overlapping boundary suffix. */
function mergeFramesByReceiveTime(
  a: readonly MessageEvent[],
  b: readonly MessageEvent[],
): MessageEvent[] {
  let overlap = 0;
  const boundaryTime = a.at(-1)?.receiveTime;
  const nextBoundaryTime = b[0]?.receiveTime;
  if (
    boundaryTime != undefined &&
    nextBoundaryTime != undefined &&
    compare(boundaryTime, nextBoundaryTime) === 0
  ) {
    let aBoundaryStart = a.length - 1;
    while (aBoundaryStart > 0 && compare(a[aBoundaryStart - 1]!.receiveTime, boundaryTime) === 0) {
      aBoundaryStart--;
    }
    let bBoundaryEnd = 0;
    while (bBoundaryEnd < b.length && compare(b[bBoundaryEnd]!.receiveTime, boundaryTime) === 0) {
      bBoundaryEnd++;
    }
    const maxOverlap = Math.min(a.length - aBoundaryStart, bBoundaryEnd);
    for (let candidate = maxOverlap; candidate > 0; candidate--) {
      const aStart = a.length - candidate;
      let matches = true;
      for (let index = 0; index < candidate; index++) {
        if (!sameLookbackFrame(a[aStart + index]!, b[index]!)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        overlap = candidate;
        break;
      }
    }
  }

  const merged = [...a, ...b.slice(overlap)];
  merged.sort((left, right) => {
    const leftNs = toNanoSec(left.receiveTime);
    const rightNs = toNanoSec(right.receiveTime);
    return leftNs < rightNs ? -1 : leftNs > rightNs ? 1 : 0;
  });
  return merged;
}

function sameLookbackFrame(left: MessageEvent, right: MessageEvent): boolean {
  if (
    left.topic !== right.topic ||
    left.schemaName !== right.schemaName ||
    compare(left.receiveTime, right.receiveTime) !== 0
  ) {
    return false;
  }
  const leftMessage = left.message as CompressedVideo;
  const rightMessage = right.message as CompressedVideo;
  if (
    compare(leftMessage.timestamp, rightMessage.timestamp) !== 0 ||
    leftMessage.frame_id !== rightMessage.frame_id ||
    leftMessage.format !== rightMessage.format ||
    leftMessage.data.length !== rightMessage.data.length
  ) {
    return false;
  }
  for (let index = 0; index < leftMessage.data.length; index++) {
    if (leftMessage.data[index] !== rightMessage.data[index]) {
      return false;
    }
  }
  return true;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeVideoMessageEvent(
  messageEvent: PartialMessageEvent<CompressedVideo> | VideoInputEvent,
): MessageEvent<CompressedVideo> {
  return {
    ...messageEvent,
    message: normalizeCompressedVideo(
      messageEvent.message as PartialMessageEvent<CompressedVideo>["message"],
    ),
  };
}
