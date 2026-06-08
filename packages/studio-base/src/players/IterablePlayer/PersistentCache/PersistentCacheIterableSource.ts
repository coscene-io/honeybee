// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0
import Logger from "@foxglove/log";
import { compare, Time } from "@foxglove/rostime";
import { Immutable, MessageEvent } from "@foxglove/studio";
import { IndexedDbMessageStore } from "@foxglove/studio-base/persistence/IndexedDbMessageStore";

import {
  IIterableSource,
  Initalization,
  MessageIteratorArgs,
  IteratorResult,
  GetBackfillMessagesArgs,
  IterableSourceInitializeArgs,
  TopicWithDecodingInfo,
} from "../IIterableSource";

const log = Logger.getLogger(__filename);

export class PersistentCacheIterableSource implements IIterableSource {
  #retentionWindowMs?: number;
  #maxCacheSize?: number;
  #cache?: IndexedDbMessageStore;
  #sessionId: string;

  public constructor({
    sessionId,
    retentionWindowMs,
    maxCacheSize,
  }: {
    sessionId: string;
    retentionWindowMs?: number;
    maxCacheSize?: number;
  }) {
    this.#sessionId = sessionId;
    this.#retentionWindowMs = retentionWindowMs;
    this.#maxCacheSize = maxCacheSize;
  }

  public async initialize(): Promise<Initalization> {
    this.#cache = new IndexedDbMessageStore({
      sessionId: this.#sessionId,
      retentionWindowMs: this.#retentionWindowMs,
      maxCacheSize: this.#maxCacheSize,
    });

    await this.#cache.init();

    const stats = await this.#cache.stats();
    const storedTopics = await this.#cache.getTopics();
    const datatypes = (await this.#cache.getDatatypes()) ?? new Map();

    // If no data is available, return minimal initialization
    if (stats.count === 0 || !stats.earliest || !stats.latest) {
      return {
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
        topics: [],
        topicStats: new Map(),
        datatypes: new Map(),
        profile: undefined,
        publishersByTopic: new Map(),
        problems: [],
      };
    }

    const topicStats = new Map<string, { numMessages: number }>();

    const topics: TopicWithDecodingInfo[] = [];
    for (const topic of storedTopics) {
      const { topicStats: _topicStats, ...topicInfo } = topic;
      topics.push(topicInfo);
      topicStats.set(topic.name, topic.topicStats ?? { numMessages: 0 });
    }

    if (topics.length === 0) {
      return {
        start: stats.earliest,
        end: stats.latest,
        topics: [],
        topicStats,
        datatypes,
        profile: undefined,
        publishersByTopic: new Map(),
        problems: [
          {
            severity: "warn",
            message:
              "Persistent cache metadata is incomplete; cached realtime data cannot be replayed.",
          },
        ],
      };
    }

    return {
      start: stats.earliest,
      end: stats.latest,
      topics,
      topicStats,
      datatypes,
      profile: undefined,
      publishersByTopic: new Map(),
      problems: [],
    };
  }

  public async *messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    const { topics, start, end } = args;

    if (topics.size === 0) {
      return;
    }

    if (!this.#cache) {
      throw new Error("PersistentCacheIterableSource not initialized");
    }

    const topicList = Array.from(topics.keys());
    const stats = await this.#cache.stats();

    if (!stats.earliest || !stats.latest) {
      return;
    }

    // Determine actual time range
    const startTime = start ?? stats.earliest;
    const endTime = end ?? stats.latest;

    // Read messages in chunks to avoid loading too much into memory at once
    const CHUNK_DURATION_MS = 1000; // 1 second chunks
    const CHUNK_DURATION_NS = CHUNK_DURATION_MS * 1e6;

    let currentTime = startTime;

    while (compare(currentTime, endTime) <= 0) {
      const chunkEnd: Time = {
        sec: currentTime.sec + Math.floor((currentTime.nsec + CHUNK_DURATION_NS) / 1e9),
        nsec: (currentTime.nsec + CHUNK_DURATION_NS) % 1e9,
      };

      const actualChunkEnd = compare(chunkEnd, endTime) <= 0 ? chunkEnd : endTime;

      const messages = await this.#cache.getMessages({
        start: currentTime,
        end: actualChunkEnd,
        topics: topicList,
      });

      // Yield each message
      for (const message of messages) {
        yield {
          type: "message-event",
          msgEvent: message,
        };
      }

      // Yield a timestamp marker to indicate progress through time
      if (
        messages.length === 0 ||
        compare(messages[messages.length - 1]!.receiveTime, actualChunkEnd) < 0
      ) {
        yield {
          type: "stamp",
          stamp: actualChunkEnd,
        };
      }

      // Move to next chunk
      currentTime = {
        sec: actualChunkEnd.sec,
        nsec: actualChunkEnd.nsec + 1,
      };
      if (currentTime.nsec >= 1e9) {
        currentTime = {
          sec: currentTime.sec + 1,
          nsec: 0,
        };
      }

      if (compare(currentTime, endTime) > 0) {
        break;
      }
    }
  }

  public async getBackfillMessages(
    args: Immutable<GetBackfillMessagesArgs>,
  ): Promise<MessageEvent[]> {
    const { topics, time } = args;

    if (topics.size === 0) {
      return [];
    }

    if (!this.#cache) {
      throw new Error("PersistentCacheIterableSource not initialized");
    }

    const topicList = Array.from(topics.keys());
    const messages = await this.#cache.getBackfillMessages({
      time,
      topics: topicList,
    });
    return [...messages];
  }

  public async terminate(): Promise<void> {
    if (!this.#cache) {
      throw new Error("PersistentCacheIterableSource not initialized");
    }

    await this.#cache.close();
  }
}

export function initialize(args: IterableSourceInitializeArgs): PersistentCacheIterableSource {
  const { sessionId, retentionWindowMs, maxCacheSize } = args;

  if (!sessionId) {
    throw new Error("sessionId is required for persistent cache source");
  }

  log.info(
    `Initializing persistent cache source for session ${sessionId}, retentionWindowMs: ${retentionWindowMs}, maxCacheSize: ${maxCacheSize}`,
  );

  // Create the persistent cache iterable source
  return new PersistentCacheIterableSource({
    sessionId,
    retentionWindowMs,
    maxCacheSize,
  });
}
