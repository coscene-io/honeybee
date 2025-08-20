// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, Time } from "@foxglove/rostime";
import { Immutable, MessageEvent } from "@foxglove/studio";

import type { PersistentMessageCache } from "../../persistence/PersistentMessageCache";
import {
  GetBackfillMessagesArgs,
  IDeserializedIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "../IterablePlayer/IIterableSource";

/**
 * Adapts a PersistentMessageCache to work as an IDeserializedIterableSource
 * for use with IterablePlayer, enabling playback of cached real-time data.
 */
export class PersistentCacheIterableSource implements IDeserializedIterableSource {
  public readonly sourceType = "deserialized";

  #cache: PersistentMessageCache;
  #name?: string;

  public constructor({ cache, name }: { cache: PersistentMessageCache; name?: string }) {
    this.#cache = cache;
    this.#name = name;
  }

  public async initialize(): Promise<Initalization> {
    await this.#cache.init();

    const stats = await this.#cache.stats();

    // If no data is available, return minimal initialization
    if (stats.count === 0 || !stats.earliest || !stats.latest) {
      return {
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
        topics: [],
        topicStats: new Map(),
        datatypes: new Map(),
        profile: undefined,
        name: this.#name ?? "Persistent Cache",
        publishersByTopic: new Map(),
        problems: [],
      };
    }

    // Get a sample of messages to determine available topics and their schemas
    const sampleMessages = await this.#cache.getMessages({
      start: stats.earliest,
      end: stats.latest,
      limit: 1000, // Sample first 1000 messages to discover topics
    });

    // Build topics list from sample messages
    const topicsMap = new Map<string, { name: string; schemaName: string }>();
    const topicStats = new Map<string, { numMessages: number }>();

    for (const msg of sampleMessages) {
      if (!topicsMap.has(msg.topic)) {
        topicsMap.set(msg.topic, {
          name: msg.topic,
          schemaName: msg.schemaName,
        });
        topicStats.set(msg.topic, { numMessages: 0 });
      }
      const stats = topicStats.get(msg.topic);
      if (stats) {
        stats.numMessages++;
      }
    }

    return {
      start: stats.earliest,
      end: stats.latest,
      topics: Array.from(topicsMap.values()),
      topicStats,
      datatypes: new Map(), // We don't have datatype definitions in the cache
      profile: undefined,
      name: this.#name ?? `Persistent Cache (${stats.count} messages)`,
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

    const topicList = Array.from(topics.keys());
    const messages = await this.#cache.getBackfillMessages({
      time,
      topics: topicList,
    });
    return [...messages];
  }

  public async terminate(): Promise<void> {
    await this.#cache.close();
  }
}
