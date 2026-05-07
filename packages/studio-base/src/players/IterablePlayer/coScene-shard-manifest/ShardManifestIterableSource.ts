// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "@mcap/core";

import Logger from "@foxglove/log";
import { loadDecompressHandlers } from "@foxglove/mcap-support";
import { compare, Time } from "@foxglove/rostime";
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
import { RemoteFileReadable } from "@foxglove/studio-base/players/IterablePlayer/Mcap/RemoteFileReadable";
import { PlayerProblem, TopicStats } from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { Manifest, parseManifest, ShardEntry } from "./manifest";
import { mergeShards } from "./mergeShards";
import { selectActiveShards } from "./profileSelection";

const log = Logger.getLogger(__filename);

type ShardChild = {
  shard: ShardEntry;
  source: McapIndexedIterableSource;
  init: Initalization;
};

export class ShardManifestIterableSource implements ISerializedIterableSource {
  public readonly sourceType = "serialized";

  #manifestUrl: string;
  #preferredProfile: string | undefined;

  #manifest?: Manifest;
  #children: ShardChild[] = [];
  #start?: Time;
  #end?: Time;

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
    log.info(
      `manifest: ${manifest.shards.length} shards total; ${active.shards.length} active for profile=${this.#preferredProfile ?? "<default>"}`,
    );
    for (const [topic, profile] of active.selectedProfileByTopic) {
      log.info(`  topic ${topic} -> profile ${profile}`);
    }

    // ZSTD/LZ4 chunks are the default in our shards; without these handlers
    // McapIndexedReader throws "Unsupported compression zstd" on the first
    // compressed chunk it tries to read.
    const decompressHandlers = await loadDecompressHandlers();

    // Open one indexed reader per active shard. In parallel for first-paint speed.
    // Each shard URL is resolved relative to the manifest URL — for v1 we
    // assume the bucket prefix is publicly readable, so no presigned URLs.
    const childPromises = active.shards.map(async (shard) => {
      const shardUrl = new URL(shard.filename, this.#manifestUrl).toString();
      const readable = new RemoteFileReadable(shardUrl);
      await readable.open();
      const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });
      const source = new McapIndexedIterableSource(reader);
      const init = await source.initialize();
      return { shard, source, init };
    });
    this.#children = await Promise.all(childPromises);

    // Union per-shard initialization results.
    const topicsByName = new Map<string, TopicWithDecodingInfo>();
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const problems: PlayerProblem[] = [];
    const publishersByTopic = new Map<string, Set<string>>();
    let start: Time | undefined;
    let end: Time | undefined;

    for (const child of this.#children) {
      const ci = child.init;
      if (!start || compare(ci.start, start) < 0) start = ci.start;
      if (!end || compare(ci.end, end) > 0) end = ci.end;

      for (const topic of ci.topics) {
        const existing = topicsByName.get(topic.name);
        if (!existing) {
          topicsByName.set(topic.name, topic);
        }
      }
      for (const [topic, stats] of ci.topicStats) {
        const existing = topicStats.get(topic);
        if (!existing) {
          topicStats.set(topic, stats);
        } else {
          // Sum message counts across shards if same topic appears in multiple
          // (shouldn't happen with our split, but be safe).
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

    this.#start = start;
    this.#end = end;

    return {
      start: start ?? { sec: 0, nsec: 0 },
      end: end ?? { sec: 0, nsec: 0 },
      topics: Array.from(topicsByName.values()),
      datatypes,
      profile: undefined,
      name: this.#manifest.sourceFile.name,
      problems,
      publishersByTopic,
      topicStats,
    };
  }

  public async *messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    if (this.#children.length === 0) {
      return;
    }

    const requestedTopicsRaw = args.topics;
    const requestedTopics = new Map(requestedTopicsRaw);
    if (requestedTopics.size === 0) {
      return;
    }

    // For each child, slice the topic selection to the topics it actually
    // contains. Skip children that have no overlapping topics.
    const iterators: AsyncIterator<Readonly<IteratorResult<Uint8Array>>>[] = [];
    for (const child of this.#children) {
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
    if (this.#children.length === 0) {
      return [];
    }
    const out: MessageEvent<Uint8Array>[] = [];
    const requestedTopics = new Map(args.topics);
    for (const child of this.#children) {
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
