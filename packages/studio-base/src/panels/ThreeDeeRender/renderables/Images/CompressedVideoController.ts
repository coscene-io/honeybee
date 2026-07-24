// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

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
import {
  playbackPerformanceMetrics,
  VideoLookbackOutcome,
} from "@foxglove/studio-base/services/playbackPerformanceTelemetry";

import type {
  CompressedVideoFrameEvent,
  ImageSetImageResult,
  SetCompressedVideoFramesOptions,
} from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";
import { normalizeCompressedVideo } from "./imageNormalizers";
import { VideoGopCache, parseVideoFrameInfo } from "./videoGopCache";
import { IRenderer } from "../../IRenderer";
import { PartialMessageEvent } from "../../SceneExtension";

// Window ladder (seconds) tried when seeking back to find a keyframe, expanding from the target.
// The first rung is the cold-seek floor: typical H.264/H.265 GOPs are ~1-2s, so we probe a small
// range first and only walk outward for sparser-keyframe streams (one extra range read each step).
const LOOKBACK_WINDOWS_SEC = [1, 2, 5, 10, 20, 40, 60] as const;
const LOOKBACK_RANGE_RETRY_DELAYS_MS = [50, 250, 1000] as const;
const LOOKBACK_RANGE_READ_TIMEOUT_MS = 5_000;

export type VideoDisplayMode = "playback" | "seek" | "direct";

export type CompressedVideoDisplayFrames = (
  frames: readonly CompressedVideoFrameEvent[],
  mode: VideoDisplayMode,
  options?: SetCompressedVideoFramesOptions,
) => ImageSetImageResult | Promise<ImageSetImageResult>;

export type VideoSeekReplayTarget = {
  type: "receive" | "publish";
  time: Time;
};

export type GetSeekReplayTarget = (
  messageEvent: MessageEvent<CompressedVideo> | undefined,
) => VideoSeekReplayTarget | "defer" | undefined;

export type SeekKeyframeSearchState = { active: boolean };

export type SeekKeyframeSearchChange = (state: SeekKeyframeSearchState) => void;

type ControllerState = {
  lookbackCancel?: () => void;
  lookbackGeneration?: number;
  replayGeneration?: number;
  pendingPlaybackAfterReplay?: {
    generation: number;
    entries: PendingPlaybackAfterReplayEntry[];
  };
  successfulWindowSeconds?: number;
  completedSeekGeneration?: number;
  decoderResetGeneration?: number;
  playbackDecoderResetGeneration?: number;
  lastDisplayedPublishTimeNs?: bigint;
};

type PendingPlaybackAfterReplayEntry = {
  messageEvent: MessageEvent<CompressedVideo>;
  options: SetCompressedVideoFramesOptions | undefined;
};

type ControllerRenderer = Pick<
  IRenderer,
  | "currentTime"
  | "startTime"
  | "subscribeMessageRange"
  | "acquireSeekKeyframeSearchPlaybackPause"
  | "queueAnimationFrame"
>;

export class CompressedVideoController {
  readonly #topic: string;
  readonly #renderer: ControllerRenderer;
  readonly #cache = new VideoGopCache();
  readonly #state: ControllerState = {};

  #displayFrames: CompressedVideoDisplayFrames;
  #resetDecoder?: () => void;
  #getSeekReplayTarget?: GetSeekReplayTarget;
  #onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  #generation = 0;
  #seekTargetNs: bigint | undefined;
  #seekKeyframeSearchActive = false;
  #seekKeyframeSearchGeneration: number | undefined;
  #releaseSeekKeyframeSearchPlaybackPause: (() => void) | undefined;
  #seekReplayPlaybackPauseGeneration: number | undefined;
  #releaseSeekReplayPlaybackPause: (() => void) | undefined;

  public constructor(args: {
    topic: string;
    renderer: ControllerRenderer;
    displayFrames: CompressedVideoDisplayFrames;
    resetDecoder?: () => void;
    getSeekReplayTarget?: GetSeekReplayTarget;
    onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  }) {
    this.#topic = args.topic;
    this.#renderer = args.renderer;
    this.#displayFrames = args.displayFrames;
    this.#resetDecoder = args.resetDecoder;
    this.#getSeekReplayTarget = args.getSeekReplayTarget;
    this.#onSeekKeyframeSearchChange = args.onSeekKeyframeSearchChange;
  }

  public updateOptions(args: {
    displayFrames?: CompressedVideoDisplayFrames;
    resetDecoder?: () => void;
    getSeekReplayTarget?: GetSeekReplayTarget;
    onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  }): void {
    if (args.displayFrames != undefined) {
      this.#displayFrames = args.displayFrames;
    }
    if (args.resetDecoder != undefined) {
      this.#resetDecoder = args.resetDecoder;
    }
    if ("onSeekKeyframeSearchChange" in args) {
      this.#onSeekKeyframeSearchChange = args.onSeekKeyframeSearchChange;
    }
    this.#getSeekReplayTarget = args.getSeekReplayTarget;
  }

  public processMessage(
    messageEvent: PartialMessageEvent<CompressedVideo>,
    options?: SetCompressedVideoFramesOptions,
  ): void {
    const normalizedEvent = normalizeVideoMessageEvent(messageEvent);
    if (normalizedEvent.topic !== this.#topic) {
      return;
    }

    const frameInfo = parseVideoFrameInfo(normalizedEvent);
    if (frameInfo == undefined) {
      this.#displayPlaybackFrame(normalizedEvent, options);
      return;
    }

    const receiveTimeNs = toNanoSec(normalizedEvent.receiveTime);
    if (
      this.#shouldStartImplicitSeekBackfill({
        messageEvent: normalizedEvent,
        receiveTimeNs,
        isKeyframe: frameInfo.isKeyframe,
      })
    ) {
      this.#startImplicitSeekBackfill();
    }

    const isSeekFrame =
      this.#seekTargetNs != undefined &&
      receiveTimeNs <= this.#seekTargetNs &&
      this.#state.completedSeekGeneration !== this.#generation;

    if (isSeekFrame) {
      this.#resetDecoderForSeek(this.#generation);

      if (
        this.#state.replayGeneration === this.#generation ||
        this.#state.lookbackGeneration === this.#generation
      ) {
        return;
      }

      const replayTarget = this.#seekReplayTarget(normalizedEvent);
      if (this.#replayCachedSeek(normalizedEvent, options)) {
        return;
      }

      if (frameInfo.isKeyframe) {
        this.#cache.addFrameRange([normalizedEvent]);
        if (replayTarget != undefined) {
          this.#startSeekReplay(this.#generation, replayTarget, [normalizedEvent], options);
        }
        return;
      }

      this.#startLookback(this.#generation, replayTarget, options);
      return;
    }

    this.#cache.addFrame(normalizedEvent);
    if (this.#suppressPlaybackDuringPendingSeekReplay(normalizedEvent, options)) {
      return;
    }
    if (this.#replayCachedPlaybackAfterDecoderReset(normalizedEvent, frameInfo, options)) {
      return;
    }
    if (this.#getSeekReplayTarget?.(normalizedEvent) != undefined) {
      void this.#displayReplayFrames([normalizedEvent], this.#generation, "playback", {
        ...options,
        decodeMode: "exact",
        allowIntermediateVideoFrame: false,
      });
      return;
    }
    this.#displayPlaybackFrame(normalizedEvent, options);
  }

  public recordKnownKeyframeReceiveTime(topic: string, receiveTime: Time): void {
    if (topic !== this.#topic) {
      return;
    }
    this.#cache.addKnownKeyframeReceiveTime(topic, receiveTime);
  }

  public async displayPublishTimeTarget(
    messageEvent: PartialMessageEvent<CompressedVideo>,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<ImageSetImageResult> {
    const normalizedEvent = normalizeVideoMessageEvent(messageEvent);
    if (normalizedEvent.topic !== this.#topic) {
      return { ok: false, reason: "failed" };
    }

    const generation = this.#beginReplayGeneration();
    const frameInfo = parseVideoFrameInfo(normalizedEvent);
    if (frameInfo == undefined) {
      const ok = await this.#displayReplayFrames([normalizedEvent], generation, "direct", options);
      return ok ? { ok: true } : { ok: false, reason: "failed" };
    }

    this.#cache.addFrame(normalizedEvent);

    const lastDisplayedPublishTime =
      this.#state.lastDisplayedPublishTimeNs != undefined
        ? fromNanoSec(this.#state.lastDisplayedPublishTimeNs)
        : undefined;
    const incrementalFrames =
      lastDisplayedPublishTime != undefined
        ? this.#cache.framesForPublishTime(
            normalizedEvent.topic,
            frameInfo.frame.timestamp,
            lastDisplayedPublishTime,
          )
        : undefined;
    if (incrementalFrames != undefined) {
      const ok = await this.#displayReplayFrames(incrementalFrames, generation, "direct", options);
      if (!this.#isCurrentGeneration(generation)) {
        return { ok: false, reason: "failed" };
      }
      if (ok) {
        this.#state.lastDisplayedPublishTimeNs = toNanoSec(frameInfo.frame.timestamp);
        this.#renderer.queueAnimationFrame();
        return { ok: true };
      }
      this.#resetDecoderForReplay();
    }

    const frames = this.#cache.framesForPublishTime(
      normalizedEvent.topic,
      frameInfo.frame.timestamp,
    );
    if (frames != undefined) {
      const ok = await this.#displayReplayFrames(frames, generation, "direct", options);
      if (!this.#isCurrentGeneration(generation)) {
        return { ok: false, reason: "failed" };
      }
      if (ok) {
        this.#state.lastDisplayedPublishTimeNs = toNanoSec(frameInfo.frame.timestamp);
        this.#renderer.queueAnimationFrame();
        return { ok: true };
      }
      this.#resetDecoderForReplay();
    }

    const ok = await this.#lookBackPublishTimeTarget(
      normalizedEvent,
      generation,
      {
        type: "publish",
        time: frameInfo.frame.timestamp,
      },
      options,
    );
    return ok ? { ok: true } : { ok: false, reason: "failed" };
  }

  public handleSeek(options?: SetCompressedVideoFramesOptions): void {
    this.#generation++;
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cache.handleSeek(fromNanoSec(this.#renderer.currentTime));

    this.#cancelLookback();
    this.#state.lastDisplayedPublishTimeNs = undefined;
    this.#resetDecoderForSeek(this.#generation);
    if (!this.#replayCachedSeek(undefined, options)) {
      this.#startLookback(this.#generation, undefined, options);
    }
  }

  public resetPlaybackState(): void {
    this.#generation++;
    this.#seekTargetNs = undefined;
    this.#cancelLookback();
    this.#endSeekReplayPlaybackPause();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.replayGeneration = undefined;
    this.#state.completedSeekGeneration = undefined;
    this.#state.playbackDecoderResetGeneration = this.#generation;
    this.#state.lastDisplayedPublishTimeNs = undefined;
    this.#resetDecoderForReplay();
  }

  public clear(): void {
    this.#generation++;
    this.#cancelLookback();
    this.#endSeekReplayPlaybackPause();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#cache.clearTopic(this.#topic);
    this.#endSeekKeyframeSearch();
  }

  public dispose(): void {
    this.clear();
  }

  #shouldStartImplicitSeekBackfill(args: {
    messageEvent: MessageEvent<CompressedVideo>;
    receiveTimeNs: bigint;
    isKeyframe: boolean;
  }): boolean {
    const { messageEvent, receiveTimeNs, isKeyframe } = args;
    if (
      isKeyframe ||
      this.#seekTargetNs != undefined ||
      this.#renderer.subscribeMessageRange == undefined ||
      receiveTimeNs > this.#renderer.currentTime
    ) {
      return false;
    }

    const explicitTarget = this.#getSeekReplayTarget?.(messageEvent);
    const replayTarget =
      explicitTarget != undefined && explicitTarget !== "defer"
        ? explicitTarget
        : ({ type: "receive", time: fromNanoSec(this.#renderer.currentTime) } as const);

    return this.#cachedFramesForReplayTarget(replayTarget) == undefined;
  }

  #startImplicitSeekBackfill(): void {
    this.#generation++;
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cache.handleSeek(fromNanoSec(this.#seekTargetNs));
    this.#cancelLookback();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#state.lastDisplayedPublishTimeNs = undefined;
  }

  #beginReplayGeneration(): number {
    const generation = ++this.#generation;
    this.#cancelLookback();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#state.replayGeneration = undefined;
    this.#state.completedSeekGeneration = undefined;
    return generation;
  }

  #resetDecoderForSeek(generation: number): void {
    if (this.#state.decoderResetGeneration === generation) {
      return;
    }
    this.#resetDecoderForReplayableFrames();
    this.#state.decoderResetGeneration = generation;
    this.#state.lastDisplayedPublishTimeNs = undefined;
  }

  #resetDecoderForReplay(): void {
    this.#resetDecoderForReplayableFrames();
    this.#state.decoderResetGeneration = undefined;
    this.#state.lastDisplayedPublishTimeNs = undefined;
  }

  #displayPlaybackFrame(
    messageEvent: MessageEvent<CompressedVideo>,
    options?: SetCompressedVideoFramesOptions,
  ): void {
    const generation = this.#generation;
    const upstreamGuard = options?.isVideoFrameRequestCurrent;
    void Promise.resolve(
      this.#displayFrames([messageEvent], "playback", {
        ...options,
        allowIntermediateVideoFrame: true,
        isVideoFrameRequestCurrent: () =>
          this.#isCurrentGeneration(generation) && (upstreamGuard?.() ?? true),
      }),
    ).catch(() => {});
  }

  #replayCachedPlaybackAfterDecoderReset(
    messageEvent: MessageEvent<CompressedVideo>,
    frameInfo: NonNullable<ReturnType<typeof parseVideoFrameInfo>>,
    options?: SetCompressedVideoFramesOptions,
  ): boolean {
    if (this.#state.playbackDecoderResetGeneration !== this.#generation) {
      return false;
    }
    if (frameInfo.isKeyframe) {
      this.#state.playbackDecoderResetGeneration = undefined;
      return false;
    }

    const frames = this.#cachedFramesForReplayTarget({
      type: "receive",
      time: messageEvent.receiveTime,
    });
    if (frames == undefined || frames.length <= 1) {
      return false;
    }

    this.#startPlaybackReplayAfterDecoderReset(this.#generation, frames, options);
    return true;
  }

  #startPlaybackReplayAfterDecoderReset(
    generation: number,
    frames: readonly MessageEvent[],
    options?: SetCompressedVideoFramesOptions,
  ): void {
    if (this.#state.replayGeneration === generation) {
      return;
    }

    this.#cancelLookback();
    this.#state.replayGeneration = generation;
    void this.#runPlaybackReplayAfterDecoderReset(generation, frames, options);
  }

  async #runPlaybackReplayAfterDecoderReset(
    generation: number,
    frames: readonly MessageEvent[],
    options?: SetCompressedVideoFramesOptions,
  ): Promise<void> {
    let resumePendingAfterFailedReplay = false;
    this.#beginSeekReplayPlaybackPause(generation);
    try {
      const result = await this.#displayReplayFramesResult(frames, generation, "playback", {
        ...options,
        decodeMode: "exact",
        allowIntermediateVideoFrame: false,
      });
      if (!this.#isCurrentGeneration(generation)) {
        return;
      }

      this.#state.replayGeneration = undefined;
      if (result.ok) {
        this.#state.playbackDecoderResetGeneration = undefined;
        this.#recordLastDisplayedPublishTime(frames);
        this.#flushPendingPlaybackAfterReplay(generation);
        return;
      }

      this.#resetDecoderForReplay();
      resumePendingAfterFailedReplay = true;
    } finally {
      this.#endSeekReplayPlaybackPause(generation);
      if (resumePendingAfterFailedReplay) {
        this.#resumePendingPlaybackAfterFailedResetReplay(generation);
      }
    }
  }

  #resumePendingPlaybackAfterFailedResetReplay(generation: number): void {
    const pendingPlayback = this.#state.pendingPlaybackAfterReplay;
    if (pendingPlayback?.generation !== generation || !this.#isCurrentGeneration(generation)) {
      return;
    }

    const entries = pendingPlayback.entries;
    this.#state.pendingPlaybackAfterReplay = undefined;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      this.processMessage(entry.messageEvent, entry.options);
      if (!this.#isCurrentGeneration(generation)) {
        return;
      }
      if (this.#state.replayGeneration === generation) {
        const remainingEntries = entries.slice(i + 1);
        this.#state.pendingPlaybackAfterReplay =
          remainingEntries.length > 0 ? { generation, entries: remainingEntries } : undefined;
        return;
      }
    }
  }

  #resetDecoderForReplayableFrames(): void {
    if (this.#resetDecoder != undefined) {
      this.#resetDecoder();
      return;
    }
    void Promise.resolve(this.#displayFrames([], "seek")).catch(() => {});
  }

  #replayCachedSeek(
    messageEvent?: MessageEvent<CompressedVideo>,
    options?: SetCompressedVideoFramesOptions,
  ): boolean {
    const replayTarget = this.#seekReplayTarget(messageEvent);
    if (replayTarget == undefined) {
      return false;
    }
    const frames = this.#framesForReplayTarget(replayTarget);
    if (frames == undefined) {
      return false;
    }

    this.#startSeekReplay(this.#generation, replayTarget, frames, options);
    return true;
  }

  #startSeekReplay(
    generation: number,
    replayTarget: VideoSeekReplayTarget,
    frames: readonly MessageEvent[],
    options?: SetCompressedVideoFramesOptions,
  ): void {
    if (this.#state.replayGeneration === generation) {
      return;
    }

    this.#cancelLookback();
    this.#state.replayGeneration = generation;
    void this.#runSeekReplay(generation, replayTarget, frames, options);
  }

  async #runSeekReplay(
    generation: number,
    replayTarget: VideoSeekReplayTarget,
    frames: readonly MessageEvent[],
    options?: SetCompressedVideoFramesOptions,
  ): Promise<void> {
    this.#beginSeekReplayPlaybackPause(generation);
    let ok = false;
    try {
      ok = await this.#displayReplayFrames(frames, generation, "seek", options);
      if (!this.#isCurrentGeneration(generation)) {
        return;
      }

      this.#state.replayGeneration = undefined;
      if (ok) {
        this.#markSeekReplayComplete(generation, frames);
        this.#flushPendingPlaybackAfterReplay(generation);
        return;
      }

      this.#resetDecoderForReplay();
      this.#startLookback(generation, replayTarget, options);
    } finally {
      this.#endSeekReplayPlaybackPause(generation);
    }
  }

  async #lookBackPublishTimeTarget(
    messageEvent: MessageEvent<CompressedVideo>,
    generation: number,
    replayTarget: VideoSeekReplayTarget,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<boolean> {
    if (this.#renderer.subscribeMessageRange == undefined) {
      return false;
    }

    const lookbackTargetNs = toNanoSec(messageEvent.receiveTime);
    this.#seekTargetNs = lookbackTargetNs;
    this.#cache.handleSeek(fromNanoSec(lookbackTargetNs));
    this.#cancelLookback();
    this.#state.replayGeneration = undefined;
    this.#state.completedSeekGeneration = undefined;
    this.#resetDecoderForSeek(generation);
    this.#state.lookbackGeneration = generation;

    return await this.#runLookback(generation, replayTarget, lookbackTargetNs, options);
  }

  #startLookback(
    generation: number,
    replayTarget = this.#seekReplayTarget(undefined),
    options?: SetCompressedVideoFramesOptions,
  ): void {
    const subscribeMessageRange = this.#renderer.subscribeMessageRange;
    const seekTargetNs = this.#seekTargetNs;
    if (
      subscribeMessageRange == undefined ||
      seekTargetNs == undefined ||
      replayTarget == undefined ||
      this.#state.lookbackGeneration === generation
    ) {
      return;
    }

    this.#cancelLookback();
    this.#state.lookbackGeneration = generation;
    void this.#runLookback(generation, replayTarget, seekTargetNs, options);
  }

  async #runLookback(
    generation: number,
    replayTarget: VideoSeekReplayTarget,
    lookbackTargetNs: bigint,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<boolean> {
    const metricsSeekId = playbackPerformanceMetrics.captureActiveSeek();
    const startedAt = metricsSeekId != undefined ? performance.now() : undefined;
    let outcome: VideoLookbackOutcome = "failure";
    this.#beginSeekKeyframeSearch(generation);
    try {
      const seekTime = fromNanoSec(lookbackTargetNs);
      const startTime = fromNanoSec(this.#renderer.startTime ?? 0n);

      // Ordered list of window starts to try, expanding backwards from the target. When we already
      // know a keyframe at/before the target we try it first: that reads exactly [keyframe, target]
      // in a single range request instead of walking the window ladder. The cold windows remain as
      // a fallback for regions we have never read.
      const windowStarts: { time: Time; windowSec?: number }[] = [];
      const knownKeyframe = this.#cache.nearestKeyframeReceiveTimeAtOrBefore(this.#topic, seekTime);
      if (knownKeyframe != undefined && compare(knownKeyframe, startTime) >= 0) {
        windowStarts.push({ time: knownKeyframe });
      }
      const requestedStart = this.#state.successfulWindowSeconds ?? LOOKBACK_WINDOWS_SEC[0];
      const startIndex = Math.max(
        0,
        LOOKBACK_WINDOWS_SEC.findIndex((windowSec) => windowSec >= requestedStart),
      );
      for (const windowSec of LOOKBACK_WINDOWS_SEC.slice(startIndex)) {
        const windowStart = clampTime(subtract(seekTime, fromSec(windowSec)), startTime, seekTime);
        windowStarts.push({ time: windowStart, windowSec });
      }

      // We read each byte range at most once: `coveredStartNs` tracks the oldest receive time we
      // have already read back to, and each window only fills the newly-exposed older slice.
      let collected: MessageEvent[] = [];
      let coveredStartNs = lookbackTargetNs;
      let issuedRead = false;

      for (const { time: windowStart, windowSec } of windowStarts) {
        if (!this.#isCurrentLookback(generation)) {
          outcome = "cancelled";
          return false;
        }
        const windowStartNs = toNanoSec(windowStart);
        // Skip windows that expose no older data we haven't already read. We must still issue at
        // least one read, though: seeking to the data start clamps every window to [start, start],
        // and that first frame (typically a keyframe) still needs to be fetched and displayed.
        if (issuedRead && windowStartNs >= coveredStartNs) {
          continue;
        }

        issuedRead = true;
        const slice = await this.#readRangeWithRetries(
          generation,
          windowStart,
          fromNanoSec(coveredStartNs),
          metricsSeekId,
        );
        if (!this.#isCurrentLookback(generation)) {
          outcome = "cancelled";
          return false;
        }
        if (slice == undefined) {
          break;
        }
        coveredStartNs = windowStartNs;
        if (slice.length === 0) {
          continue;
        }

        collected = mergeFramesByReceiveTime(slice, collected);
        const gop = gopEndingAt(collected, this.#topic, seekTime);
        if (gop.length === 0) {
          continue;
        }

        const replayFrames = framesForLookbackReplayTarget(gop, replayTarget);
        this.#cache.addFrameRange(collected);

        const ok = await this.#displayReplayFrames(replayFrames, generation, "seek", options);
        if (!this.#isCurrentLookback(generation)) {
          outcome = "cancelled";
          return false;
        }
        if (!ok) {
          this.#resetDecoderForReplay();
          continue;
        }

        this.#state.successfulWindowSeconds =
          windowSec ?? this.#windowSecondsForSpan(lookbackTargetNs - windowStartNs);
        this.#markSeekReplayComplete(generation, replayFrames);
        this.#state.lookbackCancel = undefined;
        this.#state.lookbackGeneration = undefined;
        this.#flushPendingPlaybackAfterReplay(generation);
        outcome = "success";
        return true;
      }

      this.#state.lookbackCancel = undefined;
      this.#state.lookbackGeneration = undefined;
      this.#state.pendingPlaybackAfterReplay = undefined;
      return false;
    } finally {
      this.#endSeekKeyframeSearch(generation);
      if (startedAt != undefined) {
        playbackPerformanceMetrics.recordVideoLookback(
          metricsSeekId,
          performance.now() - startedAt,
          outcome,
        );
      }
    }
  }

  #markSeekReplayComplete(generation: number, frames: readonly MessageEvent[]): void {
    this.#state.completedSeekGeneration = generation;
    this.#recordLastDisplayedPublishTime(frames);
    this.#renderer.queueAnimationFrame();
  }

  #suppressPlaybackDuringPendingSeekReplay(
    messageEvent: MessageEvent<CompressedVideo>,
    options: SetCompressedVideoFramesOptions | undefined,
  ): boolean {
    if (
      this.#state.replayGeneration !== this.#generation &&
      this.#state.lookbackGeneration !== this.#generation
    ) {
      return false;
    }

    const entry = { messageEvent, options };
    const frameInfo = parseVideoFrameInfo(messageEvent);
    const pendingPlayback = this.#state.pendingPlaybackAfterReplay;
    if (pendingPlayback?.generation === this.#generation) {
      if (frameInfo?.isKeyframe === true) {
        pendingPlayback.entries = [entry];
      } else {
        pendingPlayback.entries.push(entry);
      }
    } else {
      this.#state.pendingPlaybackAfterReplay = {
        generation: this.#generation,
        entries: [entry],
      };
    }
    return true;
  }

  #flushPendingPlaybackAfterReplay(generation: number): void {
    const pendingPlayback = this.#state.pendingPlaybackAfterReplay;
    if (pendingPlayback == undefined) {
      return;
    }
    if (
      pendingPlayback.generation !== generation ||
      !this.#isCurrentGeneration(generation) ||
      this.#state.replayGeneration === generation ||
      this.#state.lookbackGeneration === generation
    ) {
      return;
    }

    this.#state.pendingPlaybackAfterReplay = undefined;
    for (const entry of pendingPlayback.entries) {
      this.#displayPlaybackFrame(entry.messageEvent, entry.options);
    }
  }

  /** Smallest configured lookback window (seconds) that covers `spanNs`. */
  #windowSecondsForSpan(spanNs: bigint): number {
    const spanSec = Number(spanNs / 1_000_000_000n);
    for (const windowSec of LOOKBACK_WINDOWS_SEC) {
      if (windowSec >= spanSec) {
        return windowSec;
      }
    }
    return LOOKBACK_WINDOWS_SEC[LOOKBACK_WINDOWS_SEC.length - 1]!;
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
    const startedAt = performance.now();
    const frames = await this.#readRange(generation, startTime, endTime);
    playbackPerformanceMetrics.recordVideoRangeRead(
      metricsSeekId,
      performance.now() - startedAt,
      frames == undefined ? "failure" : "success",
    );
    return frames;
  }

  async #readRange(
    generation: number,
    startTime: Time,
    endTime: Time,
  ): Promise<MessageEvent[] | undefined> {
    const subscribeMessageRange = this.#renderer.subscribeMessageRange;
    if (subscribeMessageRange == undefined) {
      return [];
    }

    return await new Promise<MessageEvent[] | undefined>((resolve) => {
      let finished = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: (() => void) | undefined;
      const currentCancel = () => {
        finish([]);
      };
      const finish = (frames: MessageEvent[] | undefined) => {
        if (finished) {
          return;
        }
        finished = true;
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
              finish(frames);
            }
          } catch {
            if (this.#isCurrentLookback(generation)) {
              finish([]);
            }
          }
        },
      });
      if (unsubscribe == undefined) {
        finish(undefined);
        return;
      }
      timeout = setTimeout(() => {
        finish(undefined);
      }, LOOKBACK_RANGE_READ_TIMEOUT_MS);
    });
  }

  #cancelLookback(): void {
    const generation = this.#state.lookbackGeneration;
    this.#state.lookbackCancel?.();
    this.#state.lookbackCancel = undefined;
    this.#state.lookbackGeneration = undefined;
    this.#endSeekKeyframeSearch(generation);
  }

  #beginSeekKeyframeSearch(generation: number): void {
    if (!this.#isCurrentGeneration(generation)) {
      return;
    }
    this.#seekKeyframeSearchGeneration = generation;
    if (this.#seekKeyframeSearchActive) {
      return;
    }
    this.#seekKeyframeSearchActive = true;
    this.#releaseSeekKeyframeSearchPlaybackPause =
      this.#renderer.acquireSeekKeyframeSearchPlaybackPause?.();
    this.#onSeekKeyframeSearchChange?.({ active: true });
  }

  #beginSeekReplayPlaybackPause(generation: number): void {
    if (!this.#isCurrentGeneration(generation)) {
      return;
    }
    if (this.#seekReplayPlaybackPauseGeneration === generation) {
      return;
    }
    this.#endSeekReplayPlaybackPause();
    this.#seekReplayPlaybackPauseGeneration = generation;
    this.#releaseSeekReplayPlaybackPause =
      this.#renderer.acquireSeekKeyframeSearchPlaybackPause?.();
  }

  #endSeekReplayPlaybackPause(generation?: number): void {
    if (
      generation != undefined &&
      this.#seekReplayPlaybackPauseGeneration != undefined &&
      generation !== this.#seekReplayPlaybackPauseGeneration
    ) {
      return;
    }
    this.#seekReplayPlaybackPauseGeneration = undefined;
    const releaseSeekReplayPlaybackPause = this.#releaseSeekReplayPlaybackPause;
    this.#releaseSeekReplayPlaybackPause = undefined;
    releaseSeekReplayPlaybackPause?.();
  }

  #endSeekKeyframeSearch(generation?: number): void {
    if (
      generation != undefined &&
      this.#seekKeyframeSearchGeneration != undefined &&
      generation !== this.#seekKeyframeSearchGeneration
    ) {
      return;
    }
    this.#seekKeyframeSearchGeneration = undefined;
    if (!this.#seekKeyframeSearchActive) {
      return;
    }
    this.#seekKeyframeSearchActive = false;
    const releaseSeekKeyframeSearchPlaybackPause = this.#releaseSeekKeyframeSearchPlaybackPause;
    this.#releaseSeekKeyframeSearchPlaybackPause = undefined;
    releaseSeekKeyframeSearchPlaybackPause?.();
    this.#onSeekKeyframeSearchChange?.({ active: false });
  }

  #isCurrentLookback(generation: number): boolean {
    return this.#state.lookbackGeneration === generation && this.#isCurrentGeneration(generation);
  }

  #isCurrentGeneration(generation: number): boolean {
    return generation === this.#generation;
  }

  async #displayReplayFrames(
    frames: readonly MessageEvent[],
    generation: number,
    mode: VideoDisplayMode,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<boolean> {
    const result = await this.#displayReplayFramesResult(frames, generation, mode, options);
    return result.ok;
  }

  async #displayReplayFramesResult(
    frames: readonly MessageEvent[],
    generation: number,
    mode: VideoDisplayMode,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<ImageSetImageResult> {
    if (frames.length === 0) {
      return { ok: false, reason: "failed" };
    }

    try {
      const normalizedFrames = frames.map((frame) =>
        normalizeVideoMessageEvent(frame as MessageEvent<CompressedVideo>),
      );
      const result = await this.#displayFrames(
        normalizedFrames,
        mode,
        displayOptionsForMode(mode, options),
      );
      if (!this.#isCurrentGeneration(generation)) {
        return {
          ok: false,
          reason: mode === "playback" ? "stale" : "failed",
        };
      }
      return result;
    } catch {
      return { ok: false, reason: "failed" };
    }
  }

  #seekReplayTarget(
    messageEvent: MessageEvent<CompressedVideo> | undefined,
  ): VideoSeekReplayTarget | undefined {
    const explicitTarget = this.#getSeekReplayTarget?.(messageEvent);
    if (explicitTarget === "defer") {
      return undefined;
    }
    if (explicitTarget != undefined) {
      return explicitTarget;
    }
    return this.#seekTargetNs != undefined
      ? { type: "receive", time: fromNanoSec(this.#seekTargetNs) }
      : undefined;
  }

  #framesForReplayTarget(replayTarget: VideoSeekReplayTarget): MessageEvent[] | undefined {
    return replayTarget.type === "publish"
      ? this.#cache.seekAndReturnFramesForPublishTime(this.#topic, replayTarget.time)
      : this.#cache.seekAndReturnFramesForReceiveTime(this.#topic, replayTarget.time);
  }

  #cachedFramesForReplayTarget(replayTarget: VideoSeekReplayTarget): MessageEvent[] | undefined {
    return replayTarget.type === "publish"
      ? this.#cache.framesForPublishTime(this.#topic, replayTarget.time)
      : this.#cache.framesForReceiveTime(this.#topic, replayTarget.time);
  }

  #recordLastDisplayedPublishTime(frames: readonly MessageEvent[]): void {
    const lastFrame = frames[frames.length - 1];
    if (lastFrame == undefined) {
      return;
    }
    const frameInfo = parseVideoFrameInfo(lastFrame);
    if (frameInfo != undefined) {
      this.#state.lastDisplayedPublishTimeNs = toNanoSec(frameInfo.frame.timestamp);
    }
  }
}

function displayOptionsForMode(
  mode: VideoDisplayMode,
  options?: SetCompressedVideoFramesOptions,
): SetCompressedVideoFramesOptions | undefined {
  if (mode === "playback") {
    return options;
  }
  return { ...options, decodeMode: "exact", allowIntermediateVideoFrame: false };
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

/**
 * Merge two frame lists into a single receive-time-ascending list, dropping duplicates by receive
 * time (the slice boundary frame is read by both adjacent windows).
 */
function mergeFramesByReceiveTime(
  a: readonly MessageEvent[],
  b: readonly MessageEvent[],
): MessageEvent[] {
  const seen = new Set<bigint>();
  const merged: MessageEvent[] = [];
  for (const frame of [...a, ...b]) {
    const key = toNanoSec(frame.receiveTime);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(frame);
  }
  merged.sort((left, right) => {
    const leftNs = toNanoSec(left.receiveTime);
    const rightNs = toNanoSec(right.receiveTime);
    return leftNs < rightNs ? -1 : leftNs > rightNs ? 1 : 0;
  });
  return merged;
}

function framesForLookbackReplayTarget(
  frames: readonly MessageEvent[],
  replayTarget: VideoSeekReplayTarget,
): readonly MessageEvent[] {
  if (replayTarget.type !== "publish") {
    return frames;
  }

  const targetIndex = frames.findIndex((messageEvent) => {
    const frameInfo = parseVideoFrameInfo(messageEvent);
    return frameInfo != undefined && compare(frameInfo.frame.timestamp, replayTarget.time) > 0;
  });
  return targetIndex >= 0 ? frames.slice(0, targetIndex) : frames;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeVideoMessageEvent(
  messageEvent: PartialMessageEvent<CompressedVideo>,
): MessageEvent<CompressedVideo> {
  return {
    ...messageEvent,
    message: normalizeCompressedVideo(messageEvent.message),
  };
}
