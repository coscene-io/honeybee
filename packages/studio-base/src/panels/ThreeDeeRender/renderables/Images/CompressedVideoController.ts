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
import { VideoRun } from "@foxglove/studio-base/services/videoDiagnostics";
import { hasIntegerTime } from "@foxglove/studio-base/util/time";

import type {
  CompressedVideoFrameEvent,
  ImageSetImageResult,
  SetCompressedVideoFramesOptions,
} from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";
import { normalizeCompressedVideo } from "./imageNormalizers";
import {
  VideoGopCache,
  parseVideoFrameInfo,
  sameVideoFrameMessage,
  type VideoFrameInfo,
} from "./videoGopCache";
import { filterCompressedVideoQueue } from "./videoMessageQueue";
import { IRenderer } from "../../IRenderer";
import { PartialMessageEvent } from "../../SceneExtension";

const log = Logger.getLogger(__filename);
const LOOKBACK_WINDOWS_SEC = [1, 2, 5, 10, 20, 40, 60] as const;
const LOOKBACK_RANGE_RETRY_DELAYS_MS = [50, 250, 1000] as const;
const LOOKBACK_RANGE_READ_TIMEOUT_MS = 5_000;
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
type ControllerRenderer = Pick<
  IRenderer,
  | "diagnostics"
  | "currentTime"
  | "startTime"
  | "subscribeMessageRange"
  | "isPlaybackStopped"
  | "acquireKeyframeSearchLock"
>;

export class CompressedVideoController {
  readonly #topic: string;
  readonly #renderer: ControllerRenderer;
  readonly #cache = new VideoGopCache();
  #displayFrames: CompressedVideoDisplayFrames;
  #resetDecoder?: () => void;
  #cancelLateTarget?: () => void;
  #onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  #generation = 0;
  #work: Promise<void> = Promise.resolve();
  #disposed = false;
  #desiredTarget: VideoInputEvent | undefined;
  #decoderFrontier: VideoInputEvent | undefined;
  #continuous = false;
  #seekTargetNs: bigint | undefined;
  #releaseSeekPlaybackLock: (() => void) | undefined;
  #seekReplayFrames: MessageEvent[] | undefined;
  #cacheNeedsKeyframe = false;
  #lastInputPublishTimeNs: bigint | undefined;
  #diagnosticRun = new VideoRun();
  #lastDeliveryTime?: bigint;
  // The decode cache fills in absent timestamps. Keep the original evidence for those frames.
  readonly #incompleteSources = new WeakMap<MessageEvent, PartialMessageEvent<CompressedVideo>>();
  readonly #state: { lookbackCancel?: () => void; lookbackGeneration?: number } = {};

  public constructor(args: {
    topic: string;
    renderer: ControllerRenderer;
    displayFrames: CompressedVideoDisplayFrames;
    resetDecoder?: () => void;
    cancelLateTarget?: () => void;
    onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  }) {
    this.#topic = args.topic;
    this.#renderer = args.renderer;
    this.#displayFrames = args.displayFrames;
    this.#resetDecoder = args.resetDecoder;
    this.#cancelLateTarget = args.cancelLateTarget;
    this.#onSeekKeyframeSearchChange = args.onSeekKeyframeSearchChange;
  }
  public updateOptions(args: {
    displayFrames?: CompressedVideoDisplayFrames;
    resetDecoder?: () => void;
    cancelLateTarget?: () => void;
    onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  }): void {
    this.#displayFrames = args.displayFrames ?? this.#displayFrames;
    this.#resetDecoder = args.resetDecoder ?? this.#resetDecoder;
    this.#cancelLateTarget = args.cancelLateTarget ?? this.#cancelLateTarget;
    this.#onSeekKeyframeSearchChange =
      args.onSeekKeyframeSearchChange ?? this.#onSeekKeyframeSearchChange;
  }

  /** Every frame the cache still holds for this topic, in receive order. */
  public cachedFrames(): MessageEvent[] {
    return this.#cache.framesForTopic(this.#topic);
  }

  /** Process one complete tick, serialized after the preceding decode. Playback never reads the cache. */
  public async enqueueVideoFrames(
    input: readonly PartialMessageEvent<CompressedVideo>[],
    options: SetCompressedVideoFramesOptions = {},
    playbackBoundary: "normal" | "end" = "normal",
  ): Promise<void> {
    if (input.length === 0) {
      await this.#work;
      return;
    }
    let frames: VideoInputEvent[] = [];
    for (const event of input) {
      if (event.topic !== this.#topic) {
        continue;
      }
      const timestamp = event.message.timestamp;
      const frame: VideoInputEvent = {
        ...event,
        message: {
          timestamp: hasIntegerTime(timestamp)
            ? timestamp
            : {
                sec: Number.isSafeInteger(timestamp?.sec) ? timestamp!.sec! : 0,
                nsec: Number.isSafeInteger(timestamp?.nsec) ? timestamp!.nsec! : 0,
              },
          frame_id: event.message.frame_id ?? "",
          format: event.message.format ?? "",
          data:
            event.message.data instanceof Uint8Array || Array.isArray(event.message.data)
              ? event.message.data
              : [],
        },
      };
      if (!hasIntegerTime(timestamp)) {
        this.#incompleteSources.set(frame, event);
      }
      frames.push(frame);
    }
    if (frames.length === 0 || this.#disposed) {
      await this.#work;
      return;
    }
    const diagnostics = this.#renderer.diagnostics?.session;
    const run = diagnostics?.claimRun(
      this.#topic,
      this,
      this.#diagnosticRun,
      this.#lastDeliveryTime,
    );
    this.#lastDeliveryTime = toNanoSec(frames[frames.length - 1]!.receiveTime);
    if (diagnostics && run) {
      this.#diagnosticRun = run;
      for (const event of input) {
        if (event.topic === this.#topic) {
          diagnostics.inspect(this.#topic, event, this.#diagnosticRun);
        }
      }
    }
    let epochStart = 0;
    let regressed = false;
    for (let i = 0; i < frames.length; i++) {
      const timestamp = toNanoSec(frames[i]!.message.timestamp);
      if (this.#lastInputPublishTimeNs != undefined && timestamp < this.#lastInputPublishTimeNs) {
        const start = toNanoSec(frames[i]!.receiveTime);
        const previous = this.#lastInputPublishTimeNs;
        diagnostics?.decoderReset(this.#topic, start, previous, timestamp);
        epochStart = i;
        regressed = true;
      }
      this.#lastInputPublishTimeNs = timestamp;
    }
    if (regressed) {
      const timestamp = this.#lastInputPublishTimeNs;
      const observedRun = this.#diagnosticRun;
      const lastDeliveryTime = this.#lastDeliveryTime;
      this.handleTimestampRegression();
      this.#lastDeliveryTime = lastDeliveryTime;
      this.#diagnosticRun = observedRun;
      this.#lastInputPublishTimeNs = timestamp;
      frames = frames.slice(epochStart);
    }
    const target = frames[frames.length - 1]!;
    this.#seekReplayFrames = undefined;
    if (
      this.#seekTargetNs != undefined &&
      toNanoSec(target.receiveTime) <= this.#seekTargetNs &&
      parseVideoFrameInfo(target) != undefined
    ) {
      // Check continuity before inserting the backfill: appending an uncached delta can
      // make an incomplete GOP appear to reach the target when publish timestamps repeat.
      const cached = this.#cache.seekAndReturnFramesForReceiveTime(this.#topic, target.receiveTime);
      const cachedTarget = cached?.at(-1);
      if (cachedTarget != undefined && sameVideoFrameMessage(cachedTarget, target)) {
        this.#seekReplayFrames = cached;
        this.#cache.addFrames(frames);
      } else {
        let keyframeIndex = frames.length - 1;
        while (
          keyframeIndex >= 0 &&
          parseVideoFrameInfo(frames[keyframeIndex]!)?.isKeyframe !== true
        ) {
          keyframeIndex--;
        }
        if (keyframeIndex >= 0) {
          this.#seekReplayFrames = frames.slice(keyframeIndex);
          // The first post-seek frame must truncate the stale cached suffix before replay.
          this.#cache.addFrames(this.#seekReplayFrames);
        }
        // Do not cache an isolated delta, even if lookback fails: a later seek must
        // not mistake that same incomplete sequence for a warm GOP.
      }
    } else if (this.#cacheNeedsKeyframe) {
      // An unrecovered seek leaves a gap. Resume caching only at a self-contained GOP,
      // rather than joining later deltas to an older range with overlapping timestamps.
      const suffix = filterCompressedVideoQueue(frames);
      if (parseVideoFrameInfo(suffix[0]!)?.isKeyframe === true) {
        this.#cache.addFrameRange(suffix);
        this.#cacheNeedsKeyframe = false;
      }
    } else {
      this.#cache.addFrames(frames);
    }
    this.#desiredTarget = target;
    if (this.#seekTargetNs != undefined) {
      await this.#work;
      return;
    }
    const selected = filterCompressedVideoQueue(frames) as VideoInputEvent[];
    const keyframe = parseVideoFrameInfo(selected[0]!)?.isKeyframe === true;
    await this.#serialize(async (generation) => {
      if (this.#renderer.isPlaybackStopped() && playbackBoundary !== "end") {
        this.#continuous = false;
        this.#decoderFrontier = undefined;
        return;
      }
      if (!keyframe && (!this.#continuous || this.#decoderFrontier == undefined)) {
        const diag = this.#renderer.diagnostics;
        if (diag) {
          diag.session.panel(diag.panelId, this.#topic).status = "waiting";
        }
        return;
      }
      this.#cancelLateTarget?.();
      try {
        const result = await this.#displayFrames(
          selected.map(normalizeVideoMessageEvent),
          "playback",
          {
            ...options,
            retainLateTarget: true,
            targetFrameTimeoutMs: 30,
            anyFrameTimeoutMs: keyframe ? 100 : undefined,
            isVideoFrameRequestCurrent: () =>
              generation === this.#generation &&
              (!this.#renderer.isPlaybackStopped() || this.#desiredTarget === target) &&
              options.isVideoFrameRequestCurrent?.() !== false,
          },
        );
        if (generation === this.#generation) {
          this.#continuous = result.ok || result.reason === "timeout";
          this.#decoderFrontier = this.#continuous ? target : undefined;
          if (!result.ok && result.reason !== "timeout" && result.reason !== "stale") {
            this.resetPlaybackState();
          }
        }
      } catch (error) {
        if (generation === this.#generation) {
          this.resetPlaybackState();
        }
        throw error;
      }
    });
  }

  public updatePlaybackState(): void {
    if (this.#seekTargetNs != undefined && this.#renderer.currentTime > this.#seekTargetNs) {
      this.resetPlaybackState();
    }
  }

  public handleSeek(): void {
    if (this.#disposed) {
      return;
    }
    // Acquire the replacement before cancelling the old seek so controls never unlock
    // between two seeks. Each controller holds its lock until recovery settles or is cancelled.
    const release = this.#renderer.acquireKeyframeSearchLock?.();
    this.resetPlaybackState();
    this.#releaseSeekPlaybackLock = release;
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cacheNeedsKeyframe = true;
    this.#cache.handleSeek(fromNanoSec(this.#renderer.currentTime));
    const target = this.#seekTargetNs;
    void this.#serialize(async (generation) => {
      await this.#recoverSeek(generation, target);
    });
  }

  public resetPlaybackState(): void {
    this.#lastDeliveryTime = undefined;
    this.#diagnosticRun = new VideoRun();
    this.#generation++;
    this.#state.lookbackCancel?.();
    this.#state.lookbackCancel = undefined;
    this.#state.lookbackGeneration = undefined;
    this.#onSeekKeyframeSearchChange?.({ active: false });
    this.#seekTargetNs = undefined;
    this.#seekReplayFrames = undefined;
    this.#desiredTarget = undefined;
    this.#decoderFrontier = undefined;
    this.#continuous = false;
    this.#lastInputPublishTimeNs = undefined;
    this.#cancelLateTarget?.();
    this.#resetDecoder?.();
    const release = this.#releaseSeekPlaybackLock;
    this.#releaseSeekPlaybackLock = undefined;
    release?.();
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
    this.#renderer.diagnostics?.session.release(this.#topic, this);
    this.clear();
    this.#disposed = true;
  }

  async #serialize(operation: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.#generation;
    const work = this.#work.then(async () => {
      if (!this.#disposed && generation === this.#generation) {
        await operation(generation);
      }
    });
    // Observe errors even when a lifecycle hook initiates recovery without a caller.
    this.#work = work.catch((error: unknown) => {
      log.error(error);
    });
    await this.#work;
  }

  async #recoverSeek(generation: number, targetNs: bigint): Promise<void> {
    const targetTime = fromNanoSec(targetNs);
    try {
      if (
        generation !== this.#generation ||
        this.#seekTargetNs !== targetNs ||
        this.#renderer.currentTime !== targetNs
      ) {
        return;
      }
      // Renderer ingests the current seek's backfill before this serialized recovery runs.
      // Its last video frame can precede the seek time, especially after truncating cached futures.
      const desiredTarget = this.#desiredTarget;
      const backfillTarget =
        desiredTarget?.topic === this.#topic &&
        compare(desiredTarget.receiveTime, targetTime) <= 0 &&
        parseVideoFrameInfo(desiredTarget) != undefined
          ? desiredTarget
          : undefined;
      let frames =
        backfillTarget != undefined
          ? this.#seekReplayFrames
          : this.#cache.seekAndReturnFramesForReceiveTime(this.#topic, targetTime);
      const needsLookback = frames == undefined;
      if (needsLookback && this.#renderer.subscribeMessageRange != undefined) {
        frames = await this.#lookbackFrames(generation, targetTime);
      }
      if (
        generation !== this.#generation ||
        this.#renderer.currentTime !== targetNs ||
        frames == undefined
      ) {
        return;
      }
      this.#cacheNeedsKeyframe = false;
      const session = this.#renderer.diagnostics?.session;
      const cachedRun = needsLookback
        ? undefined
        : session?.claimRun(this.#topic, this, new VideoRun());
      if (session && cachedRun) {
        // Restore the diagnostic context before continuing playback from a cached GOP.
        this.#diagnosticRun = cachedRun;
        for (const frame of frames) {
          session.inspect(
            this.#topic,
            this.#incompleteSources.get(frame) ?? (frame as VideoInputEvent),
            this.#diagnosticRun,
          );
        }
      }
      this.#lastDeliveryTime = toNanoSec(frames[frames.length - 1]!.receiveTime);
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
        this.#seekReplayFrames = undefined;
        this.#state.lookbackGeneration = undefined;
        this.#onSeekKeyframeSearchChange?.({ active: false });
        const release = this.#releaseSeekPlaybackLock;
        this.#releaseSeekPlaybackLock = undefined;
        release?.();
      }
    }
  }

  async #lookbackFrames(generation: number, targetTime: Time): Promise<MessageEvent[] | undefined> {
    this.#state.lookbackGeneration = generation;
    const diag = this.#renderer.diagnostics;
    const stats = diag?.session.panel(diag.panelId, this.#topic);
    if (stats) {
      stats.status = "lookback";
    }
    const metricsSeekId = playbackPerformanceMetrics.captureActiveSeek();
    // Track the recovery that this panel tick is awaiting.
    const finishMetricsTask = playbackPerformanceMetrics.beginVisualTask();
    let found = false;
    const windows: { start: Time; events: MessageEvent[] }[] = [];
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
        if (diag) {
          windows.push({ start, events: slice });
        }
        const decodable = slice.filter((event) => parseVideoFrameInfo(event) != undefined);
        collected = mergeFramesByReceiveTime(decodable, collected);
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
      const earliest = windows.at(-1);
      if (diag && earliest) {
        const count = windows.reduce((sum, slice) => sum + slice.events.length, 0);
        const run = diag.session.inspectLookback(
          this.#topic,
          toNanoSec(earliest.start),
          toNanoSec(targetTime),
          count,
          (context) => {
            // Range reads work backwards and include both endpoints. Inspect each packet once
            // in recording order, with PPS and keyframe context from the preceding window.
            for (let i = windows.length - 1; i >= 0; i--) {
              const nextStart = windows[i - 1]?.start;
              for (const event of windows[i]!.events) {
                if (nextStart && compare(event.receiveTime, nextStart) === 0) {
                  continue;
                }
                if (event.message != undefined && typeof event.message === "object") {
                  diag.session.inspect(
                    this.#topic,
                    event as MessageEvent<CompressedVideo>,
                    context,
                  );
                }
              }
            }
          },
        );
        if (this.#isCurrentLookback(generation)) {
          this.#diagnosticRun = run;
          diag.session.claimRun(this.#topic, this, run);
        }
      }
      if (stats?.status === "lookback" && this.#isCurrentLookback(generation)) {
        stats.status = found ? "decoding" : "waiting";
      }
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
      frames.push(messageEvent);
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
        if (!sameVideoFrameMessage(a[aStart + index]!, b[index]!)) {
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
