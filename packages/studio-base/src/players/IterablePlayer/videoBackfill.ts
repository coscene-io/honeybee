// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import { Time, clampTime, compare, fromSec, subtract } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { TopicSelection } from "@foxglove/studio-base/players/types";

import { IIterableSource } from "./IIterableSource";
import { VideoGopCache, parseVideoFrameInfo } from "./videoGopCache";

const log = Logger.getLogger(__filename);

const DEFAULT_LOOKBACK_WINDOWS_SEC = [5, 10, 20, 40, 60] as const;

export type GopBackfillArgs = {
  source: IIterableSource;
  backfillMessages: MessageEvent[];
  subscriptions: TopicSelection;
  targetTime: Time;
  startTime: Time;
  abortSignal?: AbortSignal;
  lookbackWindowsSec?: readonly number[];
  gopCache?: VideoGopCache;
};

export async function gopBackfillForVideo(args: GopBackfillArgs): Promise<MessageEvent[]> {
  const { source, backfillMessages, targetTime, startTime, abortSignal } = args;
  const lookbackWindowsSec = args.lookbackWindowsSec ?? DEFAULT_LOOKBACK_WINDOWS_SEC;
  const gopCache = args.gopCache;

  gopCache?.addFrames(backfillMessages);

  const needsGop = new Set<string>();
  for (const msg of backfillMessages) {
    const frameInfo = parseVideoFrameInfo(msg);
    if (frameInfo != undefined && !frameInfo.isKeyframe) {
      needsGop.add(msg.topic);
    }
  }
  if (needsGop.size === 0) {
    return backfillMessages;
  }

  const gopByTopic = new Map<string, MessageEvent[]>();
  const lookbackTopics: string[] = [];
  for (const topic of needsGop) {
    const cachedGop = gopCache?.framesForReceiveTime(topic, targetTime);
    if (cachedGop != undefined) {
      gopByTopic.set(topic, cachedGop);
    } else {
      lookbackTopics.push(topic);
    }
  }

  for (const topic of lookbackTopics) {
    const gop = await findGopForTopic({
      source,
      topic,
      targetTime,
      startTime,
      abortSignal,
      lookbackWindowsSec,
      gopCache,
    });
    if (gop != undefined) {
      gopByTopic.set(topic, gop);
    }
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
  gopCache?.addFrames(merged);
  return merged;
}

async function findGopForTopic(args: {
  source: IIterableSource;
  topic: string;
  targetTime: Time;
  startTime: Time;
  abortSignal: AbortSignal | undefined;
  lookbackWindowsSec: readonly number[];
  gopCache: VideoGopCache | undefined;
}): Promise<MessageEvent[] | undefined> {
  const { source, topic, targetTime, startTime, abortSignal, lookbackWindowsSec, gopCache } = args;

  for (const lookbackSec of lookbackWindowsSec) {
    if (isAborted(abortSignal)) {
      return undefined;
    }

    const lookbackStart = clampTime(
      subtract(targetTime, fromSec(lookbackSec)),
      startTime,
      targetTime,
    );
    const windowTopics: TopicSelection = new Map([[topic, { topic }]]);
    let currentGop: MessageEvent[] = [];

    try {
      const iterator = source.messageIterator({
        topics: windowTopics,
        start: lookbackStart,
        end: targetTime,
        consumptionType: "full",
        abortSignal,
      });
      try {
        for await (const result of iterator) {
          if (isAborted(abortSignal)) {
            return undefined;
          }
          if (result.type !== "message-event" || result.msgEvent.topic !== topic) {
            continue;
          }
          if (compare(result.msgEvent.receiveTime, targetTime) > 0) {
            break;
          }

          const frameInfo = parseVideoFrameInfo(result.msgEvent);
          if (frameInfo == undefined) {
            continue;
          }
          gopCache?.addFrame(result.msgEvent);
          if (frameInfo.isKeyframe) {
            currentGop = [result.msgEvent];
          } else if (currentGop.length > 0) {
            currentGop.push(result.msgEvent);
          }
        }
      } finally {
        await iterator.return?.();
      }
    } catch (err) {
      log.warn(`GOP backfill window read failed; using single-frame backfill: ${String(err)}`);
      return undefined;
    }

    if (currentGop.length > 0) {
      return currentGop;
    }
    log.debug(`No keyframe within ${lookbackSec}s before seek on ${topic}; expanding lookback`);
  }

  return undefined;
}

function isAborted(abortSignal: AbortSignal | undefined): boolean {
  return abortSignal?.aborted === true;
}
