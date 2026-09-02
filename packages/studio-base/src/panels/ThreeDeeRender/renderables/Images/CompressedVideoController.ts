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
import { filterCompressedVideoQueue } from "./videoMessageQueue";
import { IRenderer } from "../../IRenderer";
import { PartialMessageEvent } from "../../SceneExtension";

const log = Logger.getLogger(__filename);

// Window ladder (seconds) tried when seeking back to find a keyframe, expanding from the target.
// The first rung is the cold-seek floor: typical H.264/H.265 GOPs are ~1-2s, so we probe a small
// range first and only walk outward for sparser-keyframe streams (one extra range read each step).
const LOOKBACK_WINDOWS_SEC = [1, 2, 5, 10, 20, 40, 60] as const;
const LOOKBACK_RANGE_RETRY_DELAYS_MS = [50, 250, 1000] as const;
const LOOKBACK_RANGE_READ_TIMEOUT_MS = 5_000;

// How a single range read actually resolved. The return value alone conflates these: cancellation
// and iterator exceptions resolve `[]`, timeout and missing-unsubscribe resolve `undefined`.
type RangeReadResolution = "success" | "cancelled" | "exception" | "timeout" | "unavailable";

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

export type ProcessCompressedVideoFramesOptions = SetCompressedVideoFramesOptions & {
  /** Cache-only when true and no target frame is available yet. */
  synchronize?: boolean;
  /** Exact message chosen by the timestamp synchronization coordinator. */
  targetFrame?: PartialMessageEvent<CompressedVideo>;
  /** The queue belongs to the seek tick and must use the seek timeout policy. */
  didSeek?: boolean;
};

type ControllerState = {
  lookbackCancel?: () => void;
  lookbackGeneration?: number;
  replayGeneration?: number;
  pendingPlaybackAfterReplay?: {
    generation: number;
    entries: PendingPlaybackAfterReplayEntry[];
  };
  pendingSeekAfterReplay?: {
    generation: number;
    frames: MessageEvent<CompressedVideo>[];
    options: ProcessCompressedVideoFramesOptions;
  };
  successfulWindowSeconds?: number;
  completedSeekGeneration?: number;
  decoderResetGeneration?: number;
  playbackDecoderResetGeneration?: number;
  /** A resetPlaybackState generation may restore playback from the cached GOP. */
  playbackCacheReplayGeneration?: number;
  lastDisplayedPublishTimeNs?: bigint;
  /** A keyframe-rooted batch has drained successfully in the current decoder generation. */
  playbackDecoderHasContinuousGop?: boolean;
  /** The decoder may contain queued input and must be reset before replaying an older GOP. */
  decoderHasQueuedVideoFrames?: boolean;
  synchronizedReplayNeedsReset?: boolean;
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
  #lastInputPublishTimeNs: bigint | undefined;

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

  /**
   * Process one topic's complete frame queue for a player tick. The full queue is cached before
   * show-latest selects the newest GOP, so timestamp replay and later seeks keep the original
   * physical message order.
   */
  public async processVideoFrames(
    frames: readonly PartialMessageEvent<CompressedVideo>[],
    options: ProcessCompressedVideoFramesOptions = {},
  ): Promise<ImageSetImageResult> {
    let normalizedFrames = frames
      .map(normalizeVideoMessageEvent)
      .filter((frame) => frame.topic === this.#topic);
    let previousPublishTimeNs = options.didSeek === true ? undefined : this.#lastInputPublishTimeNs;
    let epochStartIndex = 0;
    let timestampRegressed = false;
    for (let index = 0; index < normalizedFrames.length; index++) {
      const publishTimeNs = toNanoSec(normalizedFrames[index]!.message.timestamp);
      if (previousPublishTimeNs != undefined && publishTimeNs < previousPublishTimeNs) {
        epochStartIndex = index;
        timestampRegressed = true;
      }
      previousPublishTimeNs = publishTimeNs;
    }
    if (timestampRegressed) {
      this.handleTimestampRegression();
      normalizedFrames = normalizedFrames.slice(epochStartIndex);
    }
    this.#lastInputPublishTimeNs = previousPublishTimeNs;
    this.#cache.addFrames(normalizedFrames);

    const { synchronize = false, targetFrame, didSeek = false, ...displayOptions } = options;
    const seekPending =
      this.#seekTargetNs != undefined && this.#state.completedSeekGeneration !== this.#generation;
    if (didSeek || seekPending) {
      // A synchronized seek cannot display an image candidate before its exact annotation/topic
      // set is complete. Keep the seek generation pending; the later target will still take the
      // range-lookback path even though its Player tick no longer carries didSeek.
      if (synchronize && targetFrame == undefined) {
        return { ok: false, reason: "failed" };
      }
      if (
        this.#state.replayGeneration === this.#generation ||
        this.#state.lookbackGeneration === this.#generation
      ) {
        this.#stagePendingSeekFrames(normalizedFrames, options);
        return { ok: false, reason: "stale" };
      }
      return await this.#processSeekFrames(normalizedFrames, targetFrame, displayOptions);
    }
    if (synchronize && targetFrame == undefined) {
      return { ok: false, reason: "failed" };
    }
    if (synchronize) {
      return await this.#displaySynchronizedTargetOnce(targetFrame!, displayOptions);
    }

    if (normalizedFrames.length === 0) {
      return { ok: false, reason: "failed" };
    }
    if (
      this.#state.replayGeneration === this.#generation ||
      this.#state.lookbackGeneration === this.#generation
    ) {
      return { ok: false, reason: "stale" };
    }

    let playbackFrames = filterCompressedVideoQueue(normalizedFrames).map(
      normalizeVideoMessageEvent,
    );
    let target = playbackFrames[playbackFrames.length - 1]!;
    let firstFrameInfo = parseVideoFrameInfo(playbackFrames[0]!);
    let replayingAfterDecoderReset = false;
    if (
      this.#state.playbackCacheReplayGeneration === this.#generation &&
      firstFrameInfo?.isKeyframe !== true
    ) {
      const cachedFrames = this.#cachedFramesForReplayTarget({
        type: "receive",
        time: target.receiveTime,
      });
      if (cachedFrames != undefined) {
        playbackFrames = cachedFrames.map((frame) =>
          normalizeVideoMessageEvent(frame as MessageEvent<CompressedVideo>),
        );
        target = playbackFrames[playbackFrames.length - 1]!;
        firstFrameInfo = parseVideoFrameInfo(playbackFrames[0]!);
        replayingAfterDecoderReset = firstFrameInfo?.isKeyframe === true;
      }
    }
    const targetFrameInfo = parseVideoFrameInfo(target);

    if (targetFrameInfo != undefined && firstFrameInfo?.isKeyframe !== true) {
      const decoderHasContinuousGop =
        this.#state.playbackDecoderHasContinuousGop === true &&
        this.#state.playbackDecoderResetGeneration !== this.#generation;
      if (!decoderHasContinuousGop) {
        return { ok: false, reason: "failed" };
      }
    }

    const generation = this.#generation;
    const result = await this.#displayReplayFramesResult(
      playbackFrames,
      generation,
      "playback",
      replayingAfterDecoderReset
        ? { ...displayOptions, decodeMode: "exact", allowIntermediateVideoFrame: false }
        : displayOptions,
    );
    if (!this.#isCurrentGeneration(generation)) {
      return { ok: false, reason: "stale" };
    }
    if (!result.ok && result.reason === "failed") {
      this.#invalidatePlaybackContinuity();
      return result;
    }
    if (!result.ok && result.reason === "stale") {
      // A current-generation stale result means the renderable could not accept this physical
      // batch (for example, the system watchdog re-entered while an older batch was active).
      // Do not claim delta continuity across frames that never reached the decoder.
      this.#invalidatePlaybackContinuity();
      this.#state.playbackCacheReplayGeneration = this.#generation;
      this.#resetDecoderForReplay();
      return result;
    }
    if (
      this.#state.playbackDecoderHasContinuousGop === true &&
      (result.ok || result.reason === "timeout")
    ) {
      this.#state.playbackDecoderResetGeneration = undefined;
      this.#state.playbackCacheReplayGeneration = undefined;
    }
    if (result.ok) {
      this.#recordDisplayedPublishTime(result, playbackFrames);
    }
    return result;
  }

  async #displaySynchronizedTargetOnce(
    targetFrame: PartialMessageEvent<CompressedVideo>,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<ImageSetImageResult> {
    const normalizedTarget = normalizeVideoMessageEvent(targetFrame);
    if (normalizedTarget.topic !== this.#topic) {
      return { ok: false, reason: "failed" };
    }
    const frameInfo = parseVideoFrameInfo(normalizedTarget);
    if (frameInfo == undefined) {
      const generation = this.#beginReplayGeneration();
      return await this.#displayReplayFramesResult(
        [normalizedTarget],
        generation,
        "direct",
        options,
      );
    }

    const generation = this.#beginReplayGeneration();
    const lastDisplayedPublishTime =
      this.#state.lastDisplayedPublishTimeNs != undefined
        ? fromNanoSec(this.#state.lastDisplayedPublishTimeNs)
        : undefined;
    const incrementalFrames =
      this.#state.synchronizedReplayNeedsReset !== true && lastDisplayedPublishTime != undefined
        ? this.#cache.framesForPublishTime(
            this.#topic,
            frameInfo.frame.timestamp,
            lastDisplayedPublishTime,
          )
        : undefined;
    const frames =
      incrementalFrames ?? this.#cache.framesForPublishTime(this.#topic, frameInfo.frame.timestamp);
    if (frames == undefined) {
      return { ok: false, reason: "failed" };
    }

    // A full GOP starts before the decoder's current input position. This happens after a
    // Timeout/Intermediate result and for replacement messages at the same publish timestamp.
    // Invalidate the one possible late target before replaying the old keyframe.
    if (incrementalFrames == undefined && this.#state.decoderHasQueuedVideoFrames === true) {
      this.#resetDecoderForReplayableFrames();
    }

    const target = frames[frames.length - 1] as MessageEvent<CompressedVideo>;
    const displayState = { exactTargetDisplayed: false };
    const updateImageState = options?.updateImageState;
    const result = await this.#displayReplayFramesResult(frames, generation, "direct", {
      ...options,
      updateImageState: (event) => {
        updateImageState?.(event);
        if (!sameCompressedVideoFrame(event, target)) {
          return;
        }
        displayState.exactTargetDisplayed = true;
        if (this.#isCurrentGeneration(generation)) {
          this.#state.synchronizedReplayNeedsReset = false;
        }
      },
    });
    if (this.#isCurrentGeneration(generation)) {
      if (result.ok) {
        this.#recordDisplayedPublishTime(result, frames);
      }
      this.#state.synchronizedReplayNeedsReset =
        !displayState.exactTargetDisplayed && synchronizedReplayNeedsReset(result, frames);
    }
    return result;
  }

  async #processSeekFrames(
    frames: readonly MessageEvent<CompressedVideo>[],
    synchronizedTarget: PartialMessageEvent<CompressedVideo> | undefined,
    options?: SetCompressedVideoFramesOptions,
  ): Promise<ImageSetImageResult> {
    const generation = this.#generation;
    const targetFrame =
      synchronizedTarget != undefined
        ? normalizeVideoMessageEvent(synchronizedTarget)
        : frames[frames.length - 1];
    const replayTarget =
      synchronizedTarget != undefined && targetFrame != undefined
        ? (() => {
            const info = parseVideoFrameInfo(targetFrame);
            return info != undefined
              ? ({ type: "publish", time: info.frame.timestamp } as const)
              : undefined;
          })()
        : this.#seekReplayTarget(targetFrame);
    if (replayTarget == undefined) {
      return { ok: false, reason: "failed" };
    }

    const replayFrames = this.#framesForReplayTarget(replayTarget);
    if (replayFrames != undefined) {
      const result = await this.#displayReplayFramesResult(
        replayFrames,
        generation,
        "seek",
        options,
      );
      if (this.#isCurrentGeneration(generation) && (result.ok || result.reason === "timeout")) {
        this.#markSeekReplayComplete(generation, { queueAnimationFrame: false });
      }
      if (result.ok && this.#isCurrentGeneration(generation)) {
        this.#recordDisplayedPublishTime(result, replayFrames);
      }
      await this.#flushPendingSeekFrames(generation);
      return result;
    }

    const seekTargetNs = this.#seekTargetNs;
    if (seekTargetNs == undefined || this.#renderer.subscribeMessageRange == undefined) {
      return { ok: false, reason: "failed" };
    }
    this.#state.lookbackGeneration = generation;
    const result = await this.#runLookback(generation, replayTarget, seekTargetNs, options, {
      queueAnimationFrameOnComplete: false,
    });
    await this.#flushPendingSeekFrames(generation);
    return result;
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
    return await this.processVideoFrames([messageEvent], {
      ...options,
      synchronize: true,
      targetFrame: messageEvent,
    });
  }

  public handleSeek(
    options?: SetCompressedVideoFramesOptions,
    control: { deferReplay?: boolean } = {},
  ): void {
    this.#generation++;
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.pendingSeekAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#state.playbackCacheReplayGeneration = undefined;
    this.#lastInputPublishTimeNs = undefined;
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cache.handleSeek(fromNanoSec(this.#renderer.currentTime));

    this.#cancelLookback();
    this.#state.lastDisplayedPublishTimeNs = undefined;
    this.#resetDecoderForSeek(this.#generation);
    if (control.deferReplay === true) {
      return;
    }
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
    this.#state.pendingSeekAfterReplay = undefined;
    this.#state.replayGeneration = undefined;
    this.#state.completedSeekGeneration = undefined;
    this.#state.playbackDecoderResetGeneration = this.#generation;
    this.#state.playbackCacheReplayGeneration = this.#generation;
    this.#state.lastDisplayedPublishTimeNs = undefined;
    this.#resetDecoderForReplay();
  }

  /** Start a new timestamp epoch without allowing cached GOP frames from the old epoch to mix in. */
  public handleTimestampRegression(): void {
    this.resetPlaybackState();
    this.#cache.clearTopic(this.#topic);
    this.#lastInputPublishTimeNs = undefined;
  }

  public clear(): void {
    this.#generation++;
    this.#cancelLookback();
    this.#endSeekReplayPlaybackPause();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.pendingSeekAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#state.playbackCacheReplayGeneration = undefined;
    this.#state.playbackDecoderHasContinuousGop = false;
    this.#state.decoderHasQueuedVideoFrames = false;
    this.#lastInputPublishTimeNs = undefined;
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
    this.#state.pendingSeekAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#state.playbackCacheReplayGeneration = undefined;
    this.#state.lastDisplayedPublishTimeNs = undefined;
  }

  #beginReplayGeneration(): number {
    const generation = ++this.#generation;
    this.#cancelLookback();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.pendingSeekAfterReplay = undefined;
    this.#state.playbackDecoderResetGeneration = undefined;
    this.#state.playbackCacheReplayGeneration = undefined;
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
    this.#state.decoderHasQueuedVideoFrames = true;
    void Promise.resolve(
      this.#displayFrames([messageEvent], "playback", {
        ...displayOptionsForMode("playback", [messageEvent], options),
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
    if (this.#state.playbackCacheReplayGeneration !== this.#generation) {
      return false;
    }
    if (frameInfo.isKeyframe) {
      this.#state.playbackDecoderResetGeneration = undefined;
      this.#state.playbackCacheReplayGeneration = undefined;
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
        this.#state.playbackCacheReplayGeneration = undefined;
        this.#recordDisplayedPublishTime(result, frames);
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
    const options = entries[entries.length - 1]?.options;
    const playbackFrames = filterCompressedVideoQueue(entries.map((entry) => entry.messageEvent));
    const firstPlaybackFrame = playbackFrames[0];
    if (
      firstPlaybackFrame != undefined &&
      parseVideoFrameInfo(firstPlaybackFrame)?.isKeyframe === false
    ) {
      return;
    }
    void this.processVideoFrames(
      entries.map((entry) => entry.messageEvent),
      options,
    );
  }

  #resetDecoderForReplayableFrames(): void {
    this.#state.playbackDecoderHasContinuousGop = false;
    this.#state.decoderHasQueuedVideoFrames = false;
    this.#state.synchronizedReplayNeedsReset = false;
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
        this.#markSeekReplayComplete(generation);
        this.#flushPendingPlaybackAfterReplay(generation);
        return;
      }

      this.#resetDecoderForReplay();
      this.#startLookback(generation, replayTarget, options);
    } finally {
      this.#endSeekReplayPlaybackPause(generation);
    }
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
    control: { queueAnimationFrameOnComplete?: boolean } = {},
  ): Promise<ImageSetImageResult> {
    const metricsSeekId = playbackPerformanceMetrics.captureActiveSeek();
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
          return { ok: false, reason: "stale" };
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
          return { ok: false, reason: "stale" };
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
        if (replayFrames.length === 0) {
          continue;
        }

        // Once a decodable GOP has been submitted, this tick owns exactly that one decode batch.
        // Timeout may still have one late target-frame correction in flight, so do not reset the
        // decoder or expand the range and submit another batch after any terminal result.
        const result = await this.#displayReplayFramesResult(
          replayFrames,
          generation,
          "seek",
          options,
        );
        if (!this.#isCurrentLookback(generation)) {
          outcome = !result.ok && result.reason === "stale" ? "cancelled" : "failure";
          return result.ok ? { ok: false, reason: "stale" } : result;
        }

        this.#state.lookbackCancel = undefined;
        this.#state.lookbackGeneration = undefined;
        if (!result.ok) {
          this.#state.pendingPlaybackAfterReplay = undefined;
          if (result.reason === "timeout") {
            this.#markSeekReplayComplete(generation, {
              queueAnimationFrame: control.queueAnimationFrameOnComplete,
            });
          }
          outcome = result.reason === "stale" ? "cancelled" : "failure";
          return result;
        }

        this.#recordDisplayedPublishTime(result, replayFrames);
        this.#state.successfulWindowSeconds =
          windowSec ?? this.#windowSecondsForSpan(lookbackTargetNs - windowStartNs);
        this.#markSeekReplayComplete(generation, {
          queueAnimationFrame: control.queueAnimationFrameOnComplete,
        });
        this.#flushPendingPlaybackAfterReplay(generation);
        outcome = "success";
        return result;
      }

      this.#state.lookbackCancel = undefined;
      this.#state.lookbackGeneration = undefined;
      this.#state.pendingPlaybackAfterReplay = undefined;
      return { ok: false, reason: "failed" };
    } finally {
      this.#endSeekKeyframeSearch(generation);
      if (metricsSeekId != undefined) {
        playbackPerformanceMetrics.recordVideoLookback(metricsSeekId, outcome);
      }
    }
  }

  #markSeekReplayComplete(
    generation: number,
    control: { queueAnimationFrame?: boolean } = {},
  ): void {
    this.#state.completedSeekGeneration = generation;
    this.#seekTargetNs = undefined;
    if (control.queueAnimationFrame !== false) {
      this.#renderer.queueAnimationFrame();
    }
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
    const options = pendingPlayback.entries[pendingPlayback.entries.length - 1]?.options;
    void this.processVideoFrames(
      pendingPlayback.entries.map((entry) => entry.messageEvent),
      options,
    );
  }

  #stagePendingSeekFrames(
    frames: readonly MessageEvent<CompressedVideo>[],
    options: ProcessCompressedVideoFramesOptions,
  ): void {
    const pending = this.#state.pendingSeekAfterReplay;
    if (pending?.generation === this.#generation) {
      pending.frames.push(...frames);
      pending.options = options;
      return;
    }
    this.#state.pendingSeekAfterReplay = {
      generation: this.#generation,
      frames: [...frames],
      options,
    };
  }

  async #flushPendingSeekFrames(generation: number): Promise<void> {
    const pending = this.#state.pendingSeekAfterReplay;
    if (
      pending?.generation !== generation ||
      !this.#isCurrentGeneration(generation) ||
      this.#state.replayGeneration === generation ||
      this.#state.lookbackGeneration === generation
    ) {
      return;
    }

    this.#state.pendingSeekAfterReplay = undefined;
    await this.processVideoFrames(pending.frames, {
      ...pending.options,
      didSeek: this.#state.completedSeekGeneration !== generation,
    });
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
    if (result.ok) {
      this.#recordDisplayedPublishTime(result, frames);
    }
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
      const displayOptions = displayOptionsForMode(mode, normalizedFrames, options);
      const updateImageState = displayOptions.updateImageState;
      const upstreamGuard = displayOptions.isVideoFrameRequestCurrent;
      const decoderHadContinuousGop = this.#state.playbackDecoderHasContinuousGop === true;
      const batchStartsContinuousGop = normalizedFrames.some(
        (frame) => parseVideoFrameInfo(frame)?.isKeyframe === true,
      );
      this.#state.decoderHasQueuedVideoFrames = true;
      const result = await this.#displayFrames(normalizedFrames, mode, {
        ...displayOptions,
        isVideoFrameRequestCurrent: () =>
          this.#isCurrentGeneration(generation) && (upstreamGuard?.() ?? true),
        updateImageState: (event) => {
          if (!this.#isCurrentGeneration(generation) || !(upstreamGuard?.() ?? true)) {
            return;
          }
          const frameInfo = parseVideoFrameInfo(event);
          if (frameInfo != undefined) {
            this.#state.lastDisplayedPublishTimeNs = toNanoSec(frameInfo.frame.timestamp);
          }
          updateImageState?.(event);
        },
      });
      if (!this.#isCurrentGeneration(generation)) {
        return {
          ok: false,
          reason: mode === "playback" ? "stale" : "failed",
        };
      }
      if (!result.ok && result.reason === "frame-out-of-order") {
        this.#invalidatePlaybackContinuity();
      } else if (result.ok) {
        this.#state.playbackDecoderHasContinuousGop =
          decoderHadContinuousGop || batchStartsContinuousGop;
      } else if (result.reason === "timeout") {
        this.#state.playbackDecoderHasContinuousGop =
          decoderHadContinuousGop || batchStartsContinuousGop;
      }
      return result;
    } catch (error) {
      log.error(error);
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

  #recordDisplayedPublishTime(
    result: ImageSetImageResult,
    fallbackFrames: readonly MessageEvent[],
  ): void {
    const displayedFrame = result.ok ? result.decodedFrame : undefined;
    const frame = displayedFrame ?? fallbackFrames[fallbackFrames.length - 1];
    if (frame == undefined) {
      return;
    }
    const frameInfo = parseVideoFrameInfo(frame);
    if (frameInfo != undefined) {
      this.#state.lastDisplayedPublishTimeNs = toNanoSec(frameInfo.frame.timestamp);
    }
  }

  #invalidatePlaybackContinuity(): void {
    this.#generation++;
    this.#cancelLookback();
    this.#state.pendingPlaybackAfterReplay = undefined;
    this.#state.pendingSeekAfterReplay = undefined;
    this.#state.replayGeneration = undefined;
    this.#state.completedSeekGeneration = undefined;
    this.#state.lastDisplayedPublishTimeNs = undefined;
    this.#state.playbackDecoderHasContinuousGop = false;
    this.#state.decoderHasQueuedVideoFrames = false;
    this.#state.playbackDecoderResetGeneration = this.#generation;
    this.#state.playbackCacheReplayGeneration = undefined;
  }
}

function displayOptionsForMode(
  mode: VideoDisplayMode,
  frames: readonly MessageEvent[],
  options?: SetCompressedVideoFramesOptions,
): SetCompressedVideoFramesOptions {
  const {
    targetFrameTimeoutMs: _targetFrameTimeoutMs,
    anyFrameTimeoutMs: _anyFrameTimeoutMs,
    ...rest
  } = options ?? {};
  const hasKeyframe = frames.some((frame) => parseVideoFrameInfo(frame)?.isKeyframe === true);
  if (mode === "seek") {
    return { ...rest, targetFrameTimeoutMs: 200, anyFrameTimeoutMs: 2000 };
  }
  if (mode === "direct") {
    return {
      ...rest,
      targetFrameTimeoutMs: 100,
      ...(hasKeyframe ? { anyFrameTimeoutMs: 2000 } : {}),
    };
  }
  return {
    ...rest,
    targetFrameTimeoutMs: 30,
    ...(hasKeyframe ? { anyFrameTimeoutMs: 100 } : {}),
  };
}

function synchronizedReplayNeedsReset(
  result: ImageSetImageResult,
  frames: readonly MessageEvent[],
): boolean {
  if (!result.ok) {
    return result.reason === "timeout" || result.reason === "failed";
  }
  if (result.decodedFrame == undefined) {
    return false;
  }

  const target = frames[frames.length - 1] as MessageEvent<CompressedVideo> | undefined;
  return target == undefined || !sameCompressedVideoFrame(result.decodedFrame, target);
}

function sameCompressedVideoFrame(
  left: MessageEvent<CompressedVideo>,
  right: MessageEvent<CompressedVideo>,
): boolean {
  return (
    left.topic === right.topic &&
    toNanoSec(left.receiveTime) === toNanoSec(right.receiveTime) &&
    toNanoSec(left.message.timestamp) === toNanoSec(right.message.timestamp) &&
    left.message.data === right.message.data
  );
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

function framesForLookbackReplayTarget(
  frames: readonly MessageEvent[],
  replayTarget: VideoSeekReplayTarget,
): readonly MessageEvent[] {
  if (replayTarget.type !== "publish") {
    return frames;
  }

  let targetIndex = -1;
  for (let index = 0; index < frames.length; index++) {
    const messageEvent = frames[index]!;
    const frameInfo = parseVideoFrameInfo(messageEvent);
    if (frameInfo != undefined && compare(frameInfo.frame.timestamp, replayTarget.time) <= 0) {
      targetIndex = index;
    }
  }
  return targetIndex >= 0 ? frames.slice(0, targetIndex + 1) : [];
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
