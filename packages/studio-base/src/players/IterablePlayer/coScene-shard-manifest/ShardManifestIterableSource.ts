// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapTypes } from "@mcap/core";

import Logger from "@foxglove/log";
import { loadDecompressHandlers } from "@foxglove/mcap-support";
import { compare, fromNanoSec } from "@foxglove/rostime";
import { Immutable, MessageEvent } from "@foxglove/studio";
import {
  GetBackfillMessagesArgs,
  Initalization,
  IterableSourceInitializeArgs,
  IteratorResult,
  ISerializedIterableSource,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { McapIndexedIterableSource } from "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIndexedIterableSource";
import { PlayerProblem, TopicStats } from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { CoalescingRemoteReadable } from "./CoalescingRemoteReadable";
import { Manifest, parseManifest, ShardEntry } from "./manifest";
import { mergeShards } from "./mergeShards";
import { selectActiveShards } from "./profileSelection";

const log = Logger.getLogger(__filename);

type ShardChild = {
  shard: ShardEntry;
  source: McapIndexedIterableSource;
  init: Initalization;
};

// Returns the set of topic names a shard will yield. For tail shards we know
// the full set only after opening (the manifest carries `topics[]` but we
// trust the open if available). For topic-kind shards, the manifest's
// `topic` field is authoritative — exactly one stream per shard.
function manifestTopicSet(shard: ShardEntry): Set<string> {
  if (shard.kind === "topic" && shard.topic != undefined) {
    return new Set([shard.topic]);
  }
  return new Set(shard.topics.map((t) => t.name));
}

// Pick a read-ahead window for a shard. Two regimes:
//   1. Small shards (sizeBytes ≤ WHOLE_FILE_THRESHOLD): fetch the entire
//      shard in one HTTP request. Avoids the chunking overhead for tiny
//      files where streaming bytes-by-time-window doesn't pay off.
//   2. Larger shards: fetch ~READ_AHEAD_SECONDS of playback per request,
//      computed from the shard's average bitrate (sizeBytes / duration).
const READ_AHEAD_SECONDS = 30;
const READ_AHEAD_MIN_BYTES = 1 * 1024 * 1024; // 1 MiB
const READ_AHEAD_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
const WHOLE_FILE_THRESHOLD_BYTES = 8 * 1024 * 1024; // 8 MiB

function readAheadBytesForShard(shard: ShardEntry): number {
  if (shard.sizeBytes > 0 && shard.sizeBytes <= WHOLE_FILE_THRESHOLD_BYTES) {
    return shard.sizeBytes;
  }
  let startNs: bigint;
  let endNs: bigint;
  try {
    startNs = BigInt(shard.timeRange.startNs);
    endNs = BigInt(shard.timeRange.endNs);
  } catch {
    return READ_AHEAD_MIN_BYTES;
  }
  const durationNs = endNs - startNs;
  if (durationNs <= 0n || shard.sizeBytes <= 0) {
    return READ_AHEAD_MIN_BYTES;
  }
  const durationSec = Number(durationNs) / 1e9;
  const avgBytesPerSec = shard.sizeBytes / durationSec;
  const target = Math.round(avgBytesPerSec * READ_AHEAD_SECONDS);
  return Math.max(READ_AHEAD_MIN_BYTES, Math.min(READ_AHEAD_MAX_BYTES, target));
}

export class ShardManifestIterableSource implements ISerializedIterableSource {
  public readonly sourceType = "serialized";

  #manifestUrl: string;
  #preferredProfile: string | undefined;

  #manifest?: Manifest;
  #activeShards: ShardEntry[] = [];
  #decompressHandlers?: McapTypes.DecompressHandlers;

  // Promise cache so concurrent ensureOpen() calls for the same shard share
  // a single open. Resolved children are stored in #openChildren too.
  #openPromises = new Map<string, Promise<ShardChild>>();
  #openChildren = new Map<string, ShardChild>();

  public constructor(args: { manifestUrl: string; preferredProfile?: string }) {
    this.#manifestUrl = args.manifestUrl;
    this.#preferredProfile = args.preferredProfile;
  }

  public async initialize(): Promise<Initalization> {
    log.info(`fetching manifest: ${this.#manifestUrl}`);
    const resp = await fetch(this.#manifestUrl);
    if (!resp.ok) {
      throw new Error(
        `manifest fetch failed: ${resp.status} ${resp.statusText} for ${this.#manifestUrl}`,
      );
    }
    const json = (await resp.json()) as unknown;
    const manifest = parseManifest(json);
    this.#manifest = manifest;

    const active = selectActiveShards(manifest, this.#preferredProfile);
    this.#activeShards = active.shards;
    log.info(
      `manifest: ${manifest.shards.length} shards total; ${
        active.shards.length
      } active for profile=${this.#preferredProfile ?? "<default>"}`,
    );
    for (const [topic, profile] of active.selectedProfileByTopic) {
      log.info(`  topic ${topic} -> profile ${profile}`);
    }

    // ZSTD/LZ4 chunks are the default in our shards; without these handlers
    // McapIndexedReader throws "Unsupported compression zstd" on the first
    // compressed chunk it tries to read.
    this.#decompressHandlers = await loadDecompressHandlers();

    // Pick the eager set: tail shards always (they carry every non-heavy
    // topic schema in one place), plus one schema-discovery shard per
    // distinct schemaName among the non-tail active shards. Other non-tail
    // shards stay closed until their topic is actually subscribed.
    const eager: ShardEntry[] = [];
    const seenSchemas = new Set<string>();
    for (const shard of active.shards) {
      if (shard.kind === "tail") {
        eager.push(shard);
      } else {
        const schemaKey = shard.schema ?? "<unknown>";
        if (!seenSchemas.has(schemaKey)) {
          seenSchemas.add(schemaKey);
          eager.push(shard);
        }
      }
    }
    log.info(
      `opening ${eager.length} of ${active.shards.length} shards eagerly (tail + 1 per schema family); rest are lazy`,
    );

    await Promise.all(eager.map(async (shard) => await this.#ensureOpen(shard)));

    // Build the union of topic info / datatypes from the eagerly-opened
    // children. For non-eagerly-opened video shards, synthesize topic
    // entries using the schema info from a sibling we already opened.
    const topicsByName = new Map<string, TopicWithDecodingInfo>();
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const problems: PlayerProblem[] = [];
    const publishersByTopic = new Map<string, Set<string>>();

    for (const child of this.#openChildren.values()) {
      const ci = child.init;
      for (const topic of ci.topics) {
        if (!topicsByName.has(topic.name)) {
          topicsByName.set(topic.name, topic);
        }
      }
      for (const [topic, stats] of ci.topicStats) {
        const existing = topicStats.get(topic);
        if (!existing) {
          topicStats.set(topic, stats);
        } else {
          existing.numMessages += stats.numMessages;
        }
      }
      for (const [name, dt] of ci.datatypes) {
        if (!datatypes.has(name)) {
          datatypes.set(name, dt);
        }
      }
      for (const [topic, set] of ci.publishersByTopic) {
        let dst = publishersByTopic.get(topic);
        if (!dst) {
          dst = new Set();
          publishersByTopic.set(topic, dst);
        }
        for (const v of set) {
          dst.add(v);
        }
      }
      for (const p of ci.problems) {
        problems.push(p);
      }
    }

    // Synthesize topic entries for the remaining (lazy) shards using the
    // schema info we discovered from the eager schema-source shard. Each
    // lazy shard yields exactly one topic; we copy messageEncoding +
    // schemaEncoding + schemaData from the topic info we already have for
    // its schemaName, so the player pipeline can build the deserializer
    // without needing to open the shard yet.
    const topicInfoBySchema = new Map<string, TopicWithDecodingInfo>();
    for (const t of topicsByName.values()) {
      if (t.schemaName != undefined && !topicInfoBySchema.has(t.schemaName)) {
        topicInfoBySchema.set(t.schemaName, t);
      }
    }

    for (const shard of active.shards) {
      if (this.#openChildren.has(shard.id)) {
        continue;
      }
      const topicName = shard.topic;
      const schemaName = shard.schema;
      if (topicName == undefined || schemaName == undefined) {
        continue;
      }
      if (topicsByName.has(topicName)) {
        continue;
      }

      const template = topicInfoBySchema.get(schemaName);
      if (!template) {
        // We have no schema bytes for this schemaName — this shouldn't
        // happen for video shards (we open one per schema family eagerly)
        // but could happen if the manifest references a schema we never
        // saw. The shard's topic stays out of the catalog; the player
        // won't list it.
        problems.push({
          severity: "warn",
          message: `Topic ${topicName} (schema ${schemaName}) has no eagerly-discovered schema; topic skipped from init catalog (shard will open on subscription).`,
        });
        continue;
      }
      topicsByName.set(topicName, {
        ...template,
        name: topicName,
      });
      if (shard.messageCount != undefined) {
        topicStats.set(topicName, { numMessages: shard.messageCount });
      }
    }

    // Time range from the manifest's sourceFiles[]. This avoids depending on
    // every shard being open at init (the lazy ones aren't).
    let startNs: bigint | undefined;
    let endNs: bigint | undefined;
    for (const sf of manifest.sourceFiles) {
      const s = BigInt(sf.timeRange.startNs);
      const e = BigInt(sf.timeRange.endNs);
      if (startNs == undefined || s < startNs) {
        startNs = s;
      }
      if (endNs == undefined || e > endNs) {
        endNs = e;
      }
    }
    const start = startNs != undefined ? fromNanoSec(startNs) : { sec: 0, nsec: 0 };
    const end = endNs != undefined ? fromNanoSec(endNs) : { sec: 0, nsec: 0 };

    return {
      start,
      end,
      topics: Array.from(topicsByName.values()),
      datatypes,
      profile: undefined,
      name: this.#manifest.sourceFiles.map((s) => s.name).join(", "),
      problems,
      publishersByTopic,
      topicStats,
    };
  }

  // Open a single shard if it isn't already open. Concurrent callers share
  // one in-flight open. Returns the resolved ShardChild.
  async #ensureOpen(shard: ShardEntry): Promise<ShardChild> {
    const cached = this.#openChildren.get(shard.id);
    if (cached) {
      return cached;
    }

    let pending = this.#openPromises.get(shard.id);
    if (!pending) {
      pending = (async () => {
        const handlers = this.#decompressHandlers;
        if (!handlers) {
          throw new Error("decompressHandlers not loaded; initialize() must run first");
        }
        const url = new URL(shard.filename, this.#manifestUrl).toString();
        const readAhead = readAheadBytesForShard(shard);
        log.info(
          `opening shard ${shard.id} (${shard.filename}, read-ahead ${(
            readAhead /
            1024 /
            1024
          ).toFixed(1)} MiB)`,
        );
        const readable = new CoalescingRemoteReadable(url, readAhead);
        await readable.open();
        const reader = await McapIndexedReader.Initialize({
          readable,
          decompressHandlers: handlers,
        });
        const source = new McapIndexedIterableSource(reader);
        const init = await source.initialize();
        const child: ShardChild = { shard, source, init };
        this.#openChildren.set(shard.id, child);
        return child;
      })();
      this.#openPromises.set(shard.id, pending);
    }
    return await pending;
  }

  public async *messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    if (this.#activeShards.length === 0) {
      return;
    }

    const requestedTopics = new Map(args.topics);
    if (requestedTopics.size === 0) {
      return;
    }

    // Open any shards whose topic set overlaps the request, in parallel.
    const matchingShards = this.#activeShards.filter((shard) => {
      const shardTopics = manifestTopicSet(shard);
      for (const t of requestedTopics.keys()) {
        if (shardTopics.has(t)) {
          return true;
        }
      }
      return false;
    });
    if (matchingShards.length === 0) {
      return;
    }

    const children = await Promise.all(matchingShards.map(async (s) => await this.#ensureOpen(s)));

    const iterators: AsyncIterator<Readonly<IteratorResult<Uint8Array>>>[] = [];
    for (const child of children) {
      // Re-narrow against the shard's actual topic set (post-open) — for
      // tail this can differ from the manifest's `topics[]` if the shard
      // was written by a future tool.
      const childTopicNames = new Set(child.init.topics.map((t) => t.name));
      const childSelection = new Map<string, unknown>();
      for (const [topic, value] of requestedTopics) {
        if (childTopicNames.has(topic)) {
          childSelection.set(topic, value);
        }
      }
      if (childSelection.size === 0) {
        continue;
      }
      const childArgs: MessageIteratorArgs = {
        ...args,
        topics: childSelection as MessageIteratorArgs["topics"],
      };
      iterators.push(
        child.source.messageIterator(childArgs)[Symbol.asyncIterator]() as AsyncIterator<
          Readonly<IteratorResult<Uint8Array>>
        >,
      );
    }

    if (iterators.length === 0) {
      return;
    }
    yield* mergeShards<Uint8Array>(iterators);
  }

  public async getBackfillMessages(
    args: Immutable<GetBackfillMessagesArgs>,
  ): Promise<MessageEvent<Uint8Array>[]> {
    if (this.#activeShards.length === 0) {
      return [];
    }

    const requestedTopics = new Map(args.topics);
    if (requestedTopics.size === 0) {
      return [];
    }

    const matchingShards = this.#activeShards.filter((shard) => {
      const shardTopics = manifestTopicSet(shard);
      for (const t of requestedTopics.keys()) {
        if (shardTopics.has(t)) {
          return true;
        }
      }
      return false;
    });
    if (matchingShards.length === 0) {
      return [];
    }

    const children = await Promise.all(matchingShards.map(async (s) => await this.#ensureOpen(s)));

    const out: MessageEvent<Uint8Array>[] = [];
    for (const child of children) {
      const childTopicNames = new Set(child.init.topics.map((t) => t.name));
      const childSelection = new Map<string, unknown>();
      for (const [topic, value] of requestedTopics) {
        if (childTopicNames.has(topic)) {
          childSelection.set(topic, value);
        }
      }
      if (childSelection.size === 0) {
        continue;
      }
      const childMsgs = await child.source.getBackfillMessages({
        ...args,
        topics: childSelection as GetBackfillMessagesArgs["topics"],
      });
      for (const m of childMsgs) {
        out.push(m);
      }
    }
    out.sort((a, b) => compare(a.receiveTime, b.receiveTime));
    return out;
  }
}

// Worker entry point — used by the data source factory.
export function initialize(args: IterableSourceInitializeArgs): ShardManifestIterableSource {
  const url = args.params?.["url"] ?? args.url;
  if (!url) {
    throw new Error("ShardManifestIterableSource requires `url` param (manifest URL)");
  }
  const preferredProfile = args.params?.["profile"];
  return new ShardManifestIterableSource({ manifestUrl: url, preferredProfile });
}
