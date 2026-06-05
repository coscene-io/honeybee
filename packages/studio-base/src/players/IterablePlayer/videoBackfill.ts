// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264, H265 } from "@foxglove/den/video";
import Logger from "@foxglove/log";
import { Time, clampTime, compare, fromSec, subtract } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { SubscribePayload, TopicSelection } from "@foxglove/studio-base/players/types";

import { IIterableSource } from "./IIterableSource";
import { KeyframeIndex } from "./keyframeIndex";

const log = Logger.getLogger(__filename);

const VIDEO_FORMATS = new Set(["h264", "h265"]);
const DEFAULT_LOOKBACK_SEC = 15;
const MAX_GOP_FRAMES = 1500;

type CompressedVideoLike = { format: string; data: Uint8Array };

function asVideoFrame(msg: MessageEvent): CompressedVideoLike | undefined {
  const m = msg.message as Partial<CompressedVideoLike> | undefined;
  if (
    m != undefined &&
    typeof m.format === "string" &&
    VIDEO_FORMATS.has(m.format) &&
    m.data instanceof Uint8Array
  ) {
    return m as CompressedVideoLike;
  }
  return undefined;
}

function isKeyframe(frame: CompressedVideoLike): boolean {
  switch (frame.format) {
    case "h264":
      return H264.IsKeyframe(frame.data);
    case "h265":
      return H265.IsKeyframe(frame.data);
    default:
      return false;
  }
}

export type GopBackfillArgs = {
  source: IIterableSource;
  backfillMessages: MessageEvent[];
  subscriptions: TopicSelection;
  targetTime: Time;
  startTime: Time;
  abortSignal?: AbortSignal;
  lookbackSec?: number;
  keyframeIndexes?: Map<string, KeyframeIndex>;
};

export async function gopBackfillForVideo(args: GopBackfillArgs): Promise<MessageEvent[]> {
  const { source, backfillMessages, subscriptions, targetTime, startTime, abortSignal } = args;
  const lookbackSec = args.lookbackSec ?? DEFAULT_LOOKBACK_SEC;
  const keyframeIndexes = args.keyframeIndexes;

  const needsGop = new Set<string>();
  for (const msg of backfillMessages) {
    const frame = asVideoFrame(msg);
    if (frame != undefined && !isKeyframe(frame)) {
      needsGop.add(msg.topic);
    }
  }
  if (needsGop.size === 0) {
    return backfillMessages;
  }

  const lookbackStart = clampTime(
    subtract(targetTime, fromSec(lookbackSec)),
    startTime,
    targetTime,
  );

  const windowTopics: TopicSelection = new Map();
  let windowStart = targetTime;
  for (const topic of needsGop) {
    const sub: SubscribePayload = subscriptions.get(topic) ?? { topic };
    windowTopics.set(topic, sub);

    let index = keyframeIndexes?.get(topic);
    if (keyframeIndexes != undefined && index == undefined) {
      index = new KeyframeIndex();
      keyframeIndexes.set(topic, index);
    }
    const knownKeyframe = index?.nearestKeyframeAtOrBefore(targetTime);
    const topicStart =
      knownKeyframe != undefined && compare(knownKeyframe, lookbackStart) > 0
        ? knownKeyframe
        : lookbackStart;
    if (compare(topicStart, windowStart) < 0) {
      windowStart = topicStart;
    }
  }

  const framesByTopic = new Map<string, MessageEvent[]>();
  try {
    const iterator = source.messageIterator({
      topics: windowTopics,
      start: windowStart,
      end: targetTime,
      consumptionType: "partial",
      abortSignal,
    });
    try {
      for await (const result of iterator) {
        if (abortSignal?.aborted === true) {
          return backfillMessages;
        }
        if (result.type !== "message-event") {
          continue;
        }
        if (compare(result.msgEvent.receiveTime, targetTime) > 0) {
          break;
        }
        const list = framesByTopic.get(result.msgEvent.topic);
        if (list != undefined) {
          list.push(result.msgEvent);
        } else {
          framesByTopic.set(result.msgEvent.topic, [result.msgEvent]);
        }
      }
    } finally {
      await iterator.return?.();
    }
  } catch (err) {
    log.warn(`GOP backfill window read failed; using single-frame backfill: ${String(err)}`);
    return backfillMessages;
  }

  const gopByTopic = new Map<string, MessageEvent[]>();
  for (const [topic, frames] of framesByTopic) {
    const index = keyframeIndexes?.get(topic);
    let keyframeIndex = -1;
    for (let i = 0; i < frames.length; i++) {
      const frame = asVideoFrame(frames[i]!);
      if (frame != undefined && isKeyframe(frame)) {
        index?.addKeyframe(frames[i]!.receiveTime);
        keyframeIndex = i;
      }
    }
    if (keyframeIndex === -1) {
      log.debug(`No keyframe within ${lookbackSec}s before seek on ${topic}; using single frame`);
      continue;
    }
    const gop = frames.slice(keyframeIndex);
    if (gop.length > MAX_GOP_FRAMES) {
      log.warn(`GOP on ${topic} exceeds ${MAX_GOP_FRAMES} frames; using single frame`);
      continue;
    }
    gopByTopic.set(topic, gop);
  }
  if (gopByTopic.size === 0) {
    return backfillMessages;
  }

  const merged: MessageEvent[] = [];
  for (const msg of backfillMessages) {
    if (!gopByTopic.has(msg.topic)) {
      merged.push(msg);
    }
  }
  for (const gop of gopByTopic.values()) {
    merged.push(...gop);
  }
  merged.sort((a, b) => compare(a.receiveTime, b.receiveTime));
  return merged;
}
