// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Time } from "@foxglove/rostime";
import type { MessageEvent } from "@foxglove/studio";

import { CompressedVideo } from "./ImageTypes";
import { isVideoKeyframe } from "./decodeImage";
import { normalizeCompressedVideo } from "./imageNormalizers";
import { PartialMessage } from "../../SceneExtension";

export type CompressedVideoMessageEvent = MessageEvent<PartialMessage<CompressedVideo>>;

export type RecordCompressedVideoKeyframe = (topic: string, receiveTime: Time) => void;

/**
 * Compressed video frames depend on previous frames. Keep the newest decodable GOP instead of
 * keeping only the last message. If a newer keyframe arrives, older frames on the same topic can be
 * discarded because the keyframe starts a new decodable segment.
 */
export function filterCompressedVideoQueue(
  queue: CompressedVideoMessageEvent[],
): CompressedVideoMessageEvent[] {
  return filterCompressedVideoQueueWithKeyframes(queue);
}

export function recordKeyframesAndFilterCompressedVideoQueue(
  queue: CompressedVideoMessageEvent[],
  recordKeyframe: RecordCompressedVideoKeyframe,
): CompressedVideoMessageEvent[] {
  return filterCompressedVideoQueueWithKeyframes(queue, recordKeyframe);
}

function filterCompressedVideoQueueWithKeyframes(
  queue: CompressedVideoMessageEvent[],
  recordKeyframe?: RecordCompressedVideoKeyframe,
): CompressedVideoMessageEvent[] {
  const selectedMessages = new Set<CompressedVideoMessageEvent>();
  const messagesByTopic = new Map<
    string,
    { messageEvent: CompressedVideoMessageEvent; isKeyframe: boolean }[]
  >();

  for (const messageEvent of queue) {
    const normalizedMessage = normalizeCompressedVideo(messageEvent.message);
    const isKeyframe = isVideoKeyframe(normalizedMessage);
    if (isKeyframe) {
      recordKeyframe?.(messageEvent.topic, messageEvent.receiveTime);
    }

    const topicMessages = messagesByTopic.get(messageEvent.topic);
    if (topicMessages) {
      topicMessages.push({ messageEvent, isKeyframe });
    } else {
      messagesByTopic.set(messageEvent.topic, [{ messageEvent, isKeyframe }]);
    }
  }

  for (const topicMessages of messagesByTopic.values()) {
    const lastKeyframeIndex = findLastIndex(topicMessages, (message) => message.isKeyframe);

    const selectedTopicMessages =
      lastKeyframeIndex >= 0 ? topicMessages.slice(lastKeyframeIndex) : topicMessages;
    for (const { messageEvent } of selectedTopicMessages) {
      selectedMessages.add(messageEvent);
    }
  }

  return queue.filter((messageEvent) => selectedMessages.has(messageEvent));
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) {
      return i;
    }
  }
  return -1;
}
