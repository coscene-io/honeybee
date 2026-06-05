// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264, H265 } from "@foxglove/den/video";
import { Time, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

const VIDEO_FORMATS = new Set(["h264", "h265"]);
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

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
  readonly #framesByTopic = new Map<string, CachedVideoFrame[]>();
  readonly #maxBytes: number;
  #byteSize = 0;

  public constructor(options: { maxBytes?: number } = {}) {
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
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

    const frames = this.#framesByTopic.get(msg.topic) ?? [];
    const existingIndex = frames.findIndex((frame) => frame.publishTimeNs === publishTimeNs);
    if (existingIndex >= 0) {
      this.#byteSize -= frames[existingIndex]!.byteLength;
      frames.splice(existingIndex, 1, cachedFrame);
    } else {
      frames.push(cachedFrame);
    }
    frames.sort(compareCachedFramesByPublishTime);
    this.#framesByTopic.set(msg.topic, frames);
    this.#byteSize += cachedFrame.byteLength;
    this.#pruneToBudget();
    return true;
  }

  public addFrames(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      this.addFrame(msg);
    }
  }

  public framesForReceiveTime(topic: string, targetTime: Time): MessageEvent[] | undefined {
    const targetNs = toNanoSec(targetTime);
    const frames = this.#framesByTopic.get(topic);
    if (frames == undefined || frames.length === 0) {
      return undefined;
    }

    let targetFrame: CachedVideoFrame | undefined;
    for (const frame of frames) {
      if (frame.receiveTimeNs <= targetNs) {
        if (
          targetFrame == undefined ||
          frame.receiveTimeNs > targetFrame.receiveTimeNs ||
          (frame.receiveTimeNs === targetFrame.receiveTimeNs &&
            frame.publishTimeNs > targetFrame.publishTimeNs)
        ) {
          targetFrame = frame;
        }
      }
    }
    if (targetFrame == undefined) {
      return undefined;
    }

    return this.#framesForTargetFrame(
      frames,
      targetFrame,
      (frame) => frame.receiveTimeNs <= targetNs,
    );
  }

  public framesForPublishTime(topic: string, targetTime: Time): MessageEvent[] | undefined {
    const targetNs = toNanoSec(targetTime);
    const frames = this.#framesByTopic.get(topic);
    if (frames == undefined || frames.length === 0) {
      return undefined;
    }

    let targetFrame: CachedVideoFrame | undefined;
    for (const frame of frames) {
      if (frame.publishTimeNs <= targetNs) {
        targetFrame = frame;
      } else {
        break;
      }
    }
    if (targetFrame == undefined) {
      return undefined;
    }

    return this.#framesForTargetFrame(frames, targetFrame);
  }

  public clear(): void {
    this.#framesByTopic.clear();
    this.#byteSize = 0;
  }

  public clearTopic(topic: string): void {
    const frames = this.#framesByTopic.get(topic);
    if (frames == undefined) {
      return;
    }
    for (const frame of frames) {
      this.#byteSize -= frame.byteLength;
    }
    this.#framesByTopic.delete(topic);
  }

  public byteSize(): number {
    return this.#byteSize;
  }

  #framesForTargetFrame(
    frames: readonly CachedVideoFrame[],
    targetFrame: CachedVideoFrame,
    isAvailable: (frame: CachedVideoFrame) => boolean = () => true,
  ): MessageEvent[] | undefined {
    const targetIndex = frames.indexOf(targetFrame);
    if (targetIndex < 0) {
      return undefined;
    }

    let keyframeIndex = -1;
    for (let i = targetIndex; i >= 0; i--) {
      const frame = frames[i]!;
      if (!isAvailable(frame)) {
        continue;
      }
      if (frame.isKeyframe) {
        keyframeIndex = i;
        break;
      }
    }
    if (keyframeIndex < 0) {
      return undefined;
    }

    const replayableFrames = frames
      .slice(keyframeIndex, targetIndex + 1)
      .filter(isAvailable)
      .map((frame) => frame.messageEvent);
    return replayableFrames.length > 0 ? replayableFrames : undefined;
  }

  #pruneToBudget(): void {
    if (this.#byteSize <= this.#maxBytes) {
      return;
    }

    let pruned = true;
    while (this.#byteSize > this.#maxBytes && pruned) {
      pruned = false;
      for (const [topic, frames] of this.#framesByTopic) {
        if (this.#byteSize <= this.#maxBytes) {
          return;
        }

        const secondKeyframeIndex = frames.findIndex(
          (frame, index) => index > 0 && frame.isKeyframe,
        );
        if (secondKeyframeIndex <= 0) {
          continue;
        }

        const removed = frames.splice(0, secondKeyframeIndex);
        for (const frame of removed) {
          this.#byteSize -= frame.byteLength;
        }
        pruned = true;
        if (frames.length === 0) {
          this.#framesByTopic.delete(topic);
        }
      }
    }
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
