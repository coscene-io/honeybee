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

import { ImageSetImageResult } from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";
import { normalizeCompressedVideo } from "./imageNormalizers";
import { VideoGopCache, parseVideoFrameInfo } from "./videoGopCache";
import { IRenderer } from "../../IRenderer";
import { PartialMessageEvent } from "../../SceneExtension";

const LOOKBACK_WINDOWS_SEC = [5, 10, 20, 40, 60] as const;
const LOOKBACK_RANGE_RETRY_DELAYS_MS = [50, 250, 1000] as const;

type DisplayFrame = (
  messageEvent: PartialMessageEvent<CompressedVideo>,
  image: CompressedVideo,
  mode: VideoDisplayMode,
) => void | ImageSetImageResult | Promise<ImageSetImageResult>;

export type VideoDisplayMode = "playback" | "seek";

export type VideoSeekReplayTarget = {
  type: "receive" | "publish";
  time: Time;
};

type GetSeekReplayTarget = (
  messageEvent: MessageEvent<CompressedVideo> | undefined,
) => VideoSeekReplayTarget | "defer" | undefined;

type TopicState = {
  lookbackCancel?: () => void;
  lookbackGeneration?: number;
  replayGeneration?: number;
  successfulWindowSeconds?: number;
  completedSeekGeneration?: number;
  decoderResetGeneration?: number;
};

type ControllerRenderer = Pick<
  IRenderer,
  "currentTime" | "startTime" | "subscribeMessageRange" | "queueAnimationFrame"
>;

export class CompressedVideoController {
  readonly #renderer: ControllerRenderer;
  readonly #displayFrame: DisplayFrame;
  readonly #resetDecoder?: (topic: string) => void;
  readonly #getSeekReplayTarget?: GetSeekReplayTarget;
  readonly #cache = new VideoGopCache();
  readonly #statesByTopic = new Map<string, TopicState>();

  #seekGeneration = 0;
  #seekTargetNs: bigint | undefined;

  public constructor(args: {
    renderer: ControllerRenderer;
    displayFrame: DisplayFrame;
    resetDecoder?: (topic: string) => void;
    getSeekReplayTarget?: GetSeekReplayTarget;
  }) {
    this.#renderer = args.renderer;
    this.#displayFrame = args.displayFrame;
    this.#resetDecoder = args.resetDecoder;
    this.#getSeekReplayTarget = args.getSeekReplayTarget;
  }

  public processMessage(messageEvent: PartialMessageEvent<CompressedVideo>): void {
    const normalizedEvent = normalizeVideoMessageEvent(messageEvent);
    const frameInfo = parseVideoFrameInfo(normalizedEvent);
    if (frameInfo == undefined) {
      void this.#displayVideoFrame(normalizedEvent, "playback");
      return;
    }

    const state = this.#stateForTopic(normalizedEvent.topic);
    const receiveTimeNs = toNanoSec(normalizedEvent.receiveTime);
    const shouldStartImplicitSeekBackfill = this.#shouldStartImplicitSeekBackfill({
      messageEvent: normalizedEvent,
      receiveTimeNs,
      isKeyframe: frameInfo.isKeyframe,
    });
    if (shouldStartImplicitSeekBackfill) {
      this.#startImplicitSeekBackfill();
    }

    const isSeekFrame =
      this.#seekTargetNs != undefined &&
      receiveTimeNs <= this.#seekTargetNs &&
      state.completedSeekGeneration !== this.#seekGeneration;

    if (isSeekFrame) {
      this.#resetDecoderForSeek(normalizedEvent.topic, state, this.#seekGeneration);

      if (
        state.replayGeneration === this.#seekGeneration ||
        state.lookbackGeneration === this.#seekGeneration
      ) {
        return;
      }

      const replayTarget = this.#seekReplayTarget(normalizedEvent);
      if (this.#replayCachedSeek(normalizedEvent.topic, state, normalizedEvent)) {
        return;
      }

      if (frameInfo.isKeyframe) {
        this.#cache.addFrameRange([normalizedEvent]);
        if (replayTarget != undefined) {
          this.#startSeekReplay(normalizedEvent.topic, state, this.#seekGeneration, replayTarget, [
            normalizedEvent,
          ]);
        }
        return;
      }

      this.#startLookback(normalizedEvent.topic, state, this.#seekGeneration, replayTarget);
      return;
    }

    this.#cache.addFrame(normalizedEvent);
    void this.#displayVideoFrame(normalizedEvent, "playback");
  }

  public handleSeek(): void {
    this.#seekGeneration++;
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cache.handleSeek(fromNanoSec(this.#renderer.currentTime));

    for (const [topic, state] of this.#statesByTopic) {
      this.#cancelLookback(state);
      this.#resetDecoderForSeek(topic, state, this.#seekGeneration);
      if (!this.#replayCachedSeek(topic, state)) {
        this.#startLookback(topic, state, this.#seekGeneration);
      }
    }
  }

  public registerTopic(topic: string): void {
    this.#stateForTopic(topic);
  }

  public clearTopic(topic: string): void {
    const state = this.#statesByTopic.get(topic);
    if (state != undefined) {
      this.#cancelLookback(state);
      this.#statesByTopic.delete(topic);
    }
    this.#cache.clearTopic(topic);
  }

  public clear(): void {
    for (const state of this.#statesByTopic.values()) {
      this.#cancelLookback(state);
    }
    this.#statesByTopic.clear();
    this.#cache.clear();
  }

  public dispose(): void {
    this.clear();
  }

  #stateForTopic(topic: string): TopicState {
    let state = this.#statesByTopic.get(topic);
    if (state == undefined) {
      state = {};
      this.#statesByTopic.set(topic, state);
    }
    return state;
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

    return this.#framesForReplayTarget(messageEvent.topic, replayTarget) == undefined;
  }

  #startImplicitSeekBackfill(): void {
    this.#seekGeneration++;
    this.#seekTargetNs = this.#renderer.currentTime;
    this.#cache.handleSeek(fromNanoSec(this.#seekTargetNs));

    for (const state of this.#statesByTopic.values()) {
      this.#cancelLookback(state);
    }
  }

  #resetDecoderForSeek(topic: string, state: TopicState, generation: number): void {
    if (state.decoderResetGeneration === generation) {
      return;
    }
    this.#resetDecoder?.(topic);
    state.decoderResetGeneration = generation;
  }

  #replayCachedSeek(
    topic: string,
    state: TopicState,
    messageEvent?: MessageEvent<CompressedVideo>,
  ): boolean {
    const replayTarget = this.#seekReplayTarget(messageEvent);
    if (replayTarget == undefined) {
      return false;
    }
    const frames = this.#framesForReplayTarget(topic, replayTarget);
    if (frames == undefined) {
      return false;
    }

    this.#startSeekReplay(topic, state, this.#seekGeneration, replayTarget, frames);
    return true;
  }

  #startSeekReplay(
    topic: string,
    state: TopicState,
    generation: number,
    replayTarget: VideoSeekReplayTarget,
    frames: readonly MessageEvent[],
  ): void {
    if (state.replayGeneration === generation) {
      return;
    }

    this.#cancelLookback(state);
    state.replayGeneration = generation;
    void this.#runSeekReplay(topic, state, generation, replayTarget, frames);
  }

  async #runSeekReplay(
    topic: string,
    state: TopicState,
    generation: number,
    replayTarget: VideoSeekReplayTarget,
    frames: readonly MessageEvent[],
  ): Promise<void> {
    const ok = await this.#displayReplayFrames(frames, generation);
    if (generation !== this.#seekGeneration) {
      return;
    }

    state.replayGeneration = undefined;
    if (ok) {
      state.completedSeekGeneration = generation;
      this.#renderer.queueAnimationFrame();
      return;
    }

    this.#resetDecoder?.(topic);
    this.#startLookback(topic, state, generation, replayTarget);
  }

  #startLookback(
    topic: string,
    state: TopicState,
    generation: number,
    replayTarget = this.#seekReplayTarget(undefined),
  ): void {
    const subscribeMessageRange = this.#renderer.subscribeMessageRange;
    const seekTargetNs = this.#seekTargetNs;
    if (
      subscribeMessageRange == undefined ||
      seekTargetNs == undefined ||
      replayTarget == undefined ||
      state.lookbackGeneration === generation
    ) {
      return;
    }

    this.#cancelLookback(state);
    state.lookbackGeneration = generation;
    void this.#runLookback(topic, state, generation, replayTarget);
  }

  async #runLookback(
    topic: string,
    state: TopicState,
    generation: number,
    replayTarget: VideoSeekReplayTarget,
  ): Promise<void> {
    const requestedStart = state.successfulWindowSeconds ?? LOOKBACK_WINDOWS_SEC[0];
    const startIndex = Math.max(
      0,
      LOOKBACK_WINDOWS_SEC.findIndex((windowSec) => windowSec >= requestedStart),
    );

    for (const lookbackSec of LOOKBACK_WINDOWS_SEC.slice(startIndex)) {
      if (!this.#isCurrentLookback(state, generation)) {
        return;
      }

      const frames = await this.#readLookbackWindowWithRetries(
        topic,
        state,
        generation,
        lookbackSec,
      );
      if (!this.#isCurrentLookback(state, generation)) {
        return;
      }
      if (frames == undefined) {
        break;
      }
      if (frames.length === 0) {
        continue;
      }

      this.#cache.addFrameRange(frames);
      const replayFrames = framesForLookbackReplayTarget(frames, replayTarget);

      const ok = await this.#displayReplayFrames(replayFrames, generation);
      if (!this.#isCurrentLookback(state, generation)) {
        return;
      }
      if (!ok) {
        this.#resetDecoder?.(topic);
        continue;
      }

      state.successfulWindowSeconds = lookbackSec;
      state.completedSeekGeneration = generation;
      state.lookbackCancel = undefined;
      state.lookbackGeneration = undefined;
      this.#renderer.queueAnimationFrame();
      return;
    }

    state.lookbackCancel = undefined;
    state.lookbackGeneration = undefined;
  }

  async #readLookbackWindowWithRetries(
    topic: string,
    state: TopicState,
    generation: number,
    lookbackSec: number,
  ): Promise<MessageEvent[] | undefined> {
    let frames = await this.#readLookbackWindow(topic, state, generation, lookbackSec);
    for (const retryDelayMs of LOOKBACK_RANGE_RETRY_DELAYS_MS) {
      if (frames != undefined || !this.#isCurrentLookback(state, generation)) {
        return frames;
      }
      await delay(retryDelayMs);
      if (!this.#isCurrentLookback(state, generation)) {
        return undefined;
      }
      frames = await this.#readLookbackWindow(topic, state, generation, lookbackSec);
    }
    return frames;
  }

  async #readLookbackWindow(
    topic: string,
    state: TopicState,
    generation: number,
    lookbackSec: number,
  ): Promise<MessageEvent[] | undefined> {
    const seekTargetNs = this.#seekTargetNs;
    const subscribeMessageRange = this.#renderer.subscribeMessageRange;
    if (seekTargetNs == undefined || subscribeMessageRange == undefined) {
      return [];
    }

    const seekTime = fromNanoSec(seekTargetNs);
    const startTime = fromNanoSec(this.#renderer.startTime ?? 0n);
    const lookbackStart = clampTime(subtract(seekTime, fromSec(lookbackSec)), startTime, seekTime);

    return await new Promise<MessageEvent[] | undefined>((resolve) => {
      let finished = false;
      let unsubscribe: (() => void) | undefined;
      const currentCancel = () => {
        finish([]);
      };
      const finish = (frames: MessageEvent[] | undefined) => {
        if (finished) {
          return;
        }
        finished = true;
        unsubscribe?.();
        unsubscribe = undefined;
        if (state.lookbackCancel === currentCancel) {
          state.lookbackCancel = undefined;
        }
        resolve(frames);
      };

      state.lookbackCancel = currentCancel;
      unsubscribe = subscribeMessageRange({
        topic,
        timeRange: { start: lookbackStart, end: seekTime },
        onNewRangeIterator: async (iterator) => {
          try {
            const frames = await collectReplayableFrames(iterator, topic, seekTime);
            if (this.#isCurrentLookback(state, generation)) {
              finish(frames);
            }
          } catch {
            if (this.#isCurrentLookback(state, generation)) {
              finish([]);
            }
          }
        },
      });
      if (unsubscribe == undefined) {
        finish(undefined);
        return;
      }
    });
  }

  #cancelLookback(state: TopicState): void {
    state.lookbackCancel?.();
    state.lookbackCancel = undefined;
    state.lookbackGeneration = undefined;
  }

  #isCurrentLookback(state: TopicState, generation: number): boolean {
    return state.lookbackGeneration === generation && generation === this.#seekGeneration;
  }

  async #displayReplayFrames(
    frames: readonly MessageEvent[],
    generation: number,
  ): Promise<boolean> {
    if (frames.length === 0) {
      return false;
    }

    const results = frames.map(
      async (frame) =>
        await this.#displayVideoFrame(
          normalizeVideoMessageEvent(frame as MessageEvent<CompressedVideo>),
          "seek",
        ),
    );
    const result = await results[results.length - 1]!;
    return generation === this.#seekGeneration && result.ok;
  }

  async #displayVideoFrame(
    messageEvent: MessageEvent<CompressedVideo>,
    mode: VideoDisplayMode,
  ): Promise<ImageSetImageResult> {
    try {
      const result = await this.#displayFrame(messageEvent, messageEvent.message, mode);
      if (result == undefined) {
        return { ok: true };
      }
      return result;
    } catch {
      return { ok: false };
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

  #framesForReplayTarget(
    topic: string,
    replayTarget: VideoSeekReplayTarget,
  ): MessageEvent[] | undefined {
    return replayTarget.type === "publish"
      ? this.#cache.framesForPublishTime(topic, replayTarget.time)
      : this.#cache.framesForReceiveTime(topic, replayTarget.time);
  }
}

async function collectReplayableFrames(
  iterator: AsyncIterable<readonly MessageEvent[]>,
  topic: string,
  seekTime: Time,
): Promise<MessageEvent[]> {
  let currentGop: MessageEvent[] = [];
  for await (const batch of iterator) {
    for (const messageEvent of batch) {
      if (messageEvent.topic !== topic) {
        continue;
      }
      if (compare(messageEvent.receiveTime, seekTime) > 0) {
        continue;
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
      currentGop.push(normalizeVideoMessageEvent(messageEvent as MessageEvent<CompressedVideo>));
    }
  }
  return currentGop;
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
  } as MessageEvent<CompressedVideo>;
}
