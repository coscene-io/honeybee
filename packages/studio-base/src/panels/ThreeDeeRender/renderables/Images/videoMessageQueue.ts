// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

import { CompressedVideo } from "./ImageTypes";
import { isVideoKeyframe } from "./decodeImage";
import { normalizeCompressedVideo } from "./imageNormalizers";
import { PartialMessage } from "../../SceneExtension";

export type CompressedVideoMessageEvent = MessageEvent<PartialMessage<CompressedVideo>>;

export type CompressedVideoQueueFilterOptions = {
  maxQueueMessages?: number;
  maxQueueDurationNs?: bigint;
};

export const DEFAULT_COMPRESSED_VIDEO_QUEUE_FILTER_OPTIONS = {
  maxQueueMessages: 15,
  maxQueueDurationNs: 500_000_000n,
};

export type CompressedVideoQueueFilterResult = {
  messages: CompressedVideoMessageEvent[];
  topicsToReset: Set<string>;
};

/**
 * Compressed video frames depend on previous frames. Keep the newest decodable GOP instead of
 * keeping only the last message, and wait for a keyframe when the decoder falls too far behind.
 */
export function filterCompressedVideoQueue(
  queue: CompressedVideoMessageEvent[],
  waitingForKeyframeTopics: Set<string>,
  options: CompressedVideoQueueFilterOptions = {},
): CompressedVideoQueueFilterResult {
  const filterOptions: Required<CompressedVideoQueueFilterOptions> = {
    maxQueueMessages:
      options.maxQueueMessages ?? DEFAULT_COMPRESSED_VIDEO_QUEUE_FILTER_OPTIONS.maxQueueMessages,
    maxQueueDurationNs:
      options.maxQueueDurationNs ??
      DEFAULT_COMPRESSED_VIDEO_QUEUE_FILTER_OPTIONS.maxQueueDurationNs,
  };
  const topicsToReset = new Set<string>();
  const selectedMessages = new Set<CompressedVideoMessageEvent>();
  const messagesByTopic = new Map<string, CompressedVideoMessageEvent[]>();

  for (const messageEvent of queue) {
    const topicMessages = messagesByTopic.get(messageEvent.topic);
    if (topicMessages) {
      topicMessages.push(messageEvent);
    } else {
      messagesByTopic.set(messageEvent.topic, [messageEvent]);
    }
  }

  for (const [topic, topicMessages] of messagesByTopic) {
    const normalizedMessages = topicMessages.map((messageEvent) =>
      normalizeCompressedVideo(messageEvent.message),
    );
    const lastKeyframeIndex = findLastIndex(normalizedMessages, isVideoKeyframe);

    if (lastKeyframeIndex >= 0) {
      const selectedTopicMessages = topicMessages.slice(lastKeyframeIndex);
      const selectedNormalizedMessages = normalizedMessages.slice(lastKeyframeIndex);
      if (isBacklogged(selectedTopicMessages, selectedNormalizedMessages, filterOptions)) {
        waitingForKeyframeTopics.add(topic);
        topicsToReset.add(topic);
        continue;
      }

      if (lastKeyframeIndex > 0 || waitingForKeyframeTopics.has(topic)) {
        topicsToReset.add(topic);
      }
      waitingForKeyframeTopics.delete(topic);

      for (const messageEvent of selectedTopicMessages) {
        selectedMessages.add(messageEvent);
      }
      continue;
    }

    if (waitingForKeyframeTopics.has(topic)) {
      continue;
    }

    if (isBacklogged(topicMessages, normalizedMessages, filterOptions)) {
      waitingForKeyframeTopics.add(topic);
      topicsToReset.add(topic);
      continue;
    }

    for (const messageEvent of topicMessages) {
      selectedMessages.add(messageEvent);
    }
  }

  return {
    messages: queue.filter((messageEvent) => selectedMessages.has(messageEvent)),
    topicsToReset,
  };
}

function isBacklogged(
  topicMessages: CompressedVideoMessageEvent[],
  normalizedMessages: CompressedVideo[],
  options: Required<CompressedVideoQueueFilterOptions>,
): boolean {
  if (topicMessages.length > options.maxQueueMessages) {
    return true;
  }

  let minTime: bigint | undefined;
  let maxTime: bigint | undefined;
  for (const message of normalizedMessages) {
    const timestamp = toNanoSec(message.timestamp);
    minTime = minTime == undefined || timestamp < minTime ? timestamp : minTime;
    maxTime = maxTime == undefined || timestamp > maxTime ? timestamp : maxTime;
  }

  if (minTime == undefined || maxTime == undefined) {
    return false;
  }
  return maxTime - minTime > options.maxQueueDurationNs;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) {
      return i;
    }
  }
  return -1;
}
