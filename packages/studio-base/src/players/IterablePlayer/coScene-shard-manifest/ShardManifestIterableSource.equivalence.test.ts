// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Output-equivalence tests for shard time pruning.
//
// The count-based tests in ShardManifestIterableSource.test.ts prove that pruning skips reader
// opens, but their mocked children yield no messages, so they cannot detect the failure mode that
// actually matters: pruning a shard that contains requested data. These tests bind each mocked
// child source to its shard and make it yield synthetic messages that honor the child's time
// bounds, then compare the merged output against an oracle computed from the flat dataset with no
// pruning at all. Any wrongly-pruned shard shows up as missing messages.

import { McapIndexedReader, McapTypes } from "@mcap/core";

import { loadDecompressHandlers } from "@foxglove/mcap-support";
import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import {
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { McapIndexedIterableSource } from "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIndexedIterableSource";
import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import { ShardManifestIterableSource } from "./ShardManifestIterableSource";
import { Manifest, ShardEntry, TimeRange } from "./manifest";

jest.mock("@mcap/core", () => ({
  McapIndexedReader: {
    Initialize: jest.fn(),
  },
}));

jest.mock("@foxglove/mcap-support", () => ({
  loadDecompressHandlers: jest.fn(),
}));

jest.mock("@foxglove/studio-base/players/IterablePlayer/Mcap/McapIndexedIterableSource", () => ({
  McapIndexedIterableSource: jest.fn(),
}));

// The real readable issues HTTP range requests. The mock only needs to carry the shard URL so the
// reader/source chain can recover which shard it was opened for.
jest.mock("./CoalescingRemoteReadable", () => ({
  CoalescingRemoteReadable: jest.fn().mockImplementation((url: string) => ({
    url,
    open: async () => {},
    read: async () => new Uint8Array(),
  })),
}));

const mockInitializeReader = McapIndexedReader.Initialize as jest.MockedFunction<
  typeof McapIndexedReader.Initialize
>;
const mockLoadDecompressHandlers = loadDecompressHandlers as jest.MockedFunction<
  typeof loadDecompressHandlers
>;
const mockMcapIndexedIterableSource = McapIndexedIterableSource as jest.MockedClass<
  typeof McapIndexedIterableSource
>;

const NS_PER_SEC = 1_000_000_000n;

type SyntheticMessage = { topic: string; timeNs: bigint };

// Four time-split shards of one video topic (the Astribot layout shape) plus one tail shard with
// a low-rate topic spanning the whole recording. Timestamps are globally unique so merged order
// is fully determined by time and the oracle needs no tie-breaking rules.
//
// cam-k: /cam/h264 at k.0s, k.1s, ..., k.9s     (range [k s, k.9 s])
// tail:  /state at 0.05s, 0.55s, ..., 3.55s     (range [0.05 s, 3.55 s])
const CAM_TOPIC = "/cam/h264";
const STATE_TOPIC = "/state";
const CAM_SHARD_COUNT = 4;

function camShardMessages(shardIndex: number): SyntheticMessage[] {
  const base = BigInt(shardIndex) * NS_PER_SEC;
  return Array.from({ length: 10 }, (_, i) => ({
    topic: CAM_TOPIC,
    timeNs: base + BigInt(i) * 100_000_000n,
  }));
}

function tailShardMessages(): SyntheticMessage[] {
  return Array.from({ length: 8 }, (_, i) => ({
    topic: STATE_TOPIC,
    timeNs: 50_000_000n + BigInt(i) * 500_000_000n,
  }));
}

function messagesByFilename(): Map<string, SyntheticMessage[]> {
  const map = new Map<string, SyntheticMessage[]>();
  for (let k = 0; k < CAM_SHARD_COUNT; k++) {
    map.set(`cam-${k}.mcap`, camShardMessages(k));
  }
  map.set("tail.mcap", tailShardMessages());
  return map;
}

function timeRangeOf(messages: SyntheticMessage[]): TimeRange {
  return {
    startNs: messages[0]!.timeNs.toString(),
    endNs: messages[messages.length - 1]!.timeNs.toString(),
  };
}

function buildManifest(timeRangeOverrides?: Map<string, TimeRange>): Manifest {
  const data = messagesByFilename();
  const shards: ShardEntry[] = [];
  for (let k = 0; k < CAM_SHARD_COUNT; k++) {
    const filename = `cam-${k}.mcap`;
    shards.push({
      id: `cam-${k}`,
      kind: "topic",
      topic: CAM_TOPIC,
      schema: "CompressedImage",
      profile: "480p10",
      filename,
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      timeRange: timeRangeOverrides?.get(filename) ?? timeRangeOf(data.get(filename)!),
      topics: [{ name: CAM_TOPIC, schema: "CompressedImage", messageCount: 10 }],
      messageCount: 10,
    });
  }
  shards.push({
    id: "tail",
    kind: "tail",
    filename: "tail.mcap",
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    timeRange: timeRangeOverrides?.get("tail.mcap") ?? timeRangeOf(data.get("tail.mcap")!),
    topics: [{ name: STATE_TOPIC, schema: "State", messageCount: 8 }],
    messageCount: 8,
  });
  return {
    version: 1,
    sourceFiles: [
      {
        name: "record",
        sha256: "0".repeat(64),
        sizeBytes: 4096,
        timeRange: { startNs: "0", endNs: "3900000000" },
      },
    ],
    profiles: [{ id: "480p10", modality: "video", label: "480p", params: { h: 480, fps: 10 } }],
    shards,
  };
}

function makeEvent(m: SyntheticMessage): MessageEvent<Uint8Array> {
  return {
    topic: m.topic,
    receiveTime: fromNanoSec(m.timeNs),
    message: new Uint8Array(0),
    sizeInBytes: 0,
    schemaName: m.topic === CAM_TOPIC ? "CompressedImage" : "State",
  };
}

function childSourceForUrl(url: string): McapIndexedIterableSource {
  const filename = url.slice(url.lastIndexOf("/") + 1);
  const shardMessages = messagesByFilename().get(filename);
  if (!shardMessages) {
    throw new Error(`no synthetic dataset for shard url ${url}`);
  }
  const topics = [...new Set(shardMessages.map((m) => m.topic))];
  const first = shardMessages[0]!;
  const last = shardMessages[shardMessages.length - 1]!;
  const init: Initalization = {
    start: fromNanoSec(first.timeNs),
    end: fromNanoSec(last.timeNs),
    topics: topics.map((name) => ({
      name,
      schemaName: name === CAM_TOPIC ? "CompressedImage" : "State",
    })),
    topicStats: new Map(),
    datatypes: new Map(),
    profile: undefined,
    problems: [],
    publishersByTopic: new Map(),
  };
  return {
    sourceType: "serialized",
    initialize: jest.fn(async () => init),
    messageIterator: jest.fn(async function* (
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<IteratorResult<Uint8Array>> {
      const requested = new Set(args.topics.keys());
      const startNs = args.start ? toNanoSec(args.start) : undefined;
      const endNs = args.end ? toNanoSec(args.end) : undefined;
      for (const m of shardMessages) {
        if (!requested.has(m.topic)) {
          continue;
        }
        if (startNs != undefined && m.timeNs < startNs) {
          continue;
        }
        if (endNs != undefined && m.timeNs > endNs) {
          continue;
        }
        yield { type: "message-event", msgEvent: makeEvent(m) };
      }
    }),
    getBackfillMessages: jest.fn(
      async (args: { topics: Map<string, unknown>; time: { sec: number; nsec: number } }) => {
        const targetNs = toNanoSec(args.time);
        const out: MessageEvent<Uint8Array>[] = [];
        for (const topic of args.topics.keys()) {
          let best: SyntheticMessage | undefined;
          for (const m of shardMessages) {
            if (m.topic === topic && m.timeNs <= targetNs) {
              best = m;
            }
          }
          if (best) {
            out.push(makeEvent(best));
          }
        }
        return out;
      },
    ),
  } as unknown as McapIndexedIterableSource;
}

// ---- Oracle: computed from the flat dataset, with no knowledge of shards or pruning ----

function allMessages(): SyntheticMessage[] {
  return [...messagesByFilename().values()]
    .flat()
    .sort((a, b) => (a.timeNs < b.timeNs ? -1 : a.timeNs > b.timeNs ? 1 : 0));
}

function keyOf(m: { topic: string; timeNs: bigint }): string {
  return `${m.topic}@${m.timeNs}`;
}

function oracleIterate(topics: string[], startNs?: bigint, endNs?: bigint): string[] {
  const requested = new Set(topics);
  return allMessages()
    .filter(
      (m) =>
        requested.has(m.topic) &&
        (startNs == undefined || m.timeNs >= startNs) &&
        (endNs == undefined || m.timeNs <= endNs),
    )
    .map(keyOf);
}

function oracleBackfill(topics: string[], targetNs: bigint): string[] {
  const keys: string[] = [];
  for (const topic of topics) {
    let best: SyntheticMessage | undefined;
    for (const m of allMessages()) {
      if (m.topic === topic && m.timeNs <= targetNs) {
        best = m;
      }
    }
    if (best) {
      keys.push(keyOf(best));
    }
  }
  return keys.sort();
}

async function collectIterate(
  source: ShardManifestIterableSource,
  topics: string[],
  startNs?: bigint,
  endNs?: bigint,
): Promise<string[]> {
  const keys: string[] = [];
  for await (const result of source.messageIterator({
    topics: mockTopicSelection(...topics),
    start: startNs != undefined ? fromNanoSec(startNs) : undefined,
    end: endNs != undefined ? fromNanoSec(endNs) : undefined,
    consumptionType: "partial",
  })) {
    expect(result.type).toBe("message-event");
    if (result.type === "message-event") {
      keys.push(`${result.msgEvent.topic}@${toNanoSec(result.msgEvent.receiveTime)}`);
    }
  }
  return keys;
}

async function collectBackfill(
  source: ShardManifestIterableSource,
  topics: string[],
  targetNs: bigint,
): Promise<string[]> {
  const msgs = await source.getBackfillMessages({
    topics: mockTopicSelection(...topics),
    time: fromNanoSec(targetNs),
  });
  // Multiple shards of one topic can each contribute their own latest-at-or-before message; keep
  // only the newest per topic, matching what the downstream player state retains.
  const bestByTopic = new Map<string, bigint>();
  for (const m of msgs) {
    const t = toNanoSec(m.receiveTime);
    const prev = bestByTopic.get(m.topic);
    if (prev == undefined || t > prev) {
      bestByTopic.set(m.topic, t);
    }
  }
  return [...bestByTopic.entries()].map(([topic, timeNs]) => keyOf({ topic, timeNs })).sort();
}

function installManifest(manifest: Manifest): void {
  global.fetch = jest.fn(
    async (..._args: Parameters<typeof fetch>): Promise<Response> =>
      ({
        ok: true,
        json: async () => manifest,
      }) as Response,
  );
}

async function makeSource(manifest: Manifest): Promise<ShardManifestIterableSource> {
  installManifest(manifest);
  const source = new ShardManifestIterableSource({
    manifestUrl: "https://example.com/manifest.json",
  });
  await source.initialize();
  return source;
}

describe("ShardManifestIterableSource pruning output equivalence", () => {
  let originalFetch: typeof global.fetch;
  let openedUrls: string[];

  beforeEach(() => {
    originalFetch = global.fetch;
    openedUrls = [];

    mockLoadDecompressHandlers.mockReset();
    mockLoadDecompressHandlers.mockResolvedValue({} as McapTypes.DecompressHandlers);
    mockInitializeReader.mockReset();
    // Pass the mocked readable (which carries the shard URL) through as the "reader" so the
    // source constructor below can recover the shard identity.
    mockInitializeReader.mockImplementation(async ({ readable }) => {
      openedUrls.push((readable as unknown as { url: string }).url);
      return readable as unknown as McapIndexedReader;
    });
    mockMcapIndexedIterableSource.mockReset();
    mockMcapIndexedIterableSource.mockImplementation((reader) =>
      childSourceForUrl((reader as unknown as { url: string }).url),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    { label: "full range", startNs: 0n, endNs: 3_900_000_000n },
    { label: "interior window", startNs: 1_250_000_000n, endNs: 2_750_000_000n },
    { label: "exact shard boundaries", startNs: 1_000_000_000n, endNs: 2_000_000_000n },
    { label: "before all data", startNs: 0n, endNs: 40_000_000n },
    { label: "after all data", startNs: 3_950_000_000n, endNs: 4_500_000_000n },
    { label: "single sample", startNs: 2_300_000_000n, endNs: 2_300_000_000n },
  ])("matches the no-pruning oracle: $label", async ({ startNs, endNs }) => {
    const source = await makeSource(buildManifest());
    const topics = [CAM_TOPIC, STATE_TOPIC];
    expect(await collectIterate(source, topics, startNs, endNs)).toEqual(
      oracleIterate(topics, startNs, endNs),
    );
  });

  it("matches the oracle with unbounded requests", async () => {
    const source = await makeSource(buildManifest());
    const topics = [CAM_TOPIC, STATE_TOPIC];
    expect(await collectIterate(source, topics)).toEqual(oracleIterate(topics));
    expect(await collectIterate(source, topics, 1_500_000_000n)).toEqual(
      oracleIterate(topics, 1_500_000_000n),
    );
    expect(await collectIterate(source, topics, undefined, 1_500_000_000n)).toEqual(
      oracleIterate(topics, undefined, 1_500_000_000n),
    );
  });

  it("actually prunes non-overlapping shards while matching the oracle", async () => {
    const source = await makeSource(buildManifest());
    openedUrls = [];

    const topics = [CAM_TOPIC];
    expect(await collectIterate(source, topics, 1_250_000_000n, 1_650_000_000n)).toEqual(
      oracleIterate(topics, 1_250_000_000n, 1_650_000_000n),
    );

    // Only cam-1 overlaps [1.25 s, 1.65 s]; cam-0/2/3 must not be opened.
    expect(openedUrls).toEqual(["https://example.com/cam-1.mcap"]);
  });

  it("matches the backfill oracle and skips shards that start after the target", async () => {
    const source = await makeSource(buildManifest());
    openedUrls = [];

    const topics = [CAM_TOPIC, STATE_TOPIC];
    const targetNs = 1_450_000_000n;
    expect(await collectBackfill(source, topics, targetNs)).toEqual(
      oracleBackfill(topics, targetNs),
    );

    // cam-2 and cam-3 start after 1.45 s and must not be opened. (tail and cam-0 were opened
    // eagerly during initialize; cam-1 is the only new open.)
    const newlyOpened = openedUrls.filter((u) => !u.endsWith("manifest.json"));
    expect(newlyOpened).toEqual(["https://example.com/cam-1.mcap"]);
  });

  it.each([
    { label: "empty-string range", timeRange: { startNs: "", endNs: "" } },
    { label: "reversed range", timeRange: { startNs: "2900000000", endNs: "2000000000" } },
    { label: "non-numeric range", timeRange: { startNs: "NaN", endNs: "NaN" } },
    { label: "whitespace range", timeRange: { startNs: " ", endNs: " " } },
  ])(
    "does not lose data when a shard declares a malformed time range: $label",
    async ({ timeRange }) => {
      // Corrupt cam-2's declared range; its actual data still covers [2 s, 2.9 s]. A pruning
      // decision that trusts the malformed range would silently drop these messages.
      const source = await makeSource(buildManifest(new Map([["cam-2.mcap", timeRange]])));
      const topics = [CAM_TOPIC, STATE_TOPIC];

      expect(await collectIterate(source, topics, 2_100_000_000n, 2_500_000_000n)).toEqual(
        oracleIterate(topics, 2_100_000_000n, 2_500_000_000n),
      );
      expect(await collectBackfill(source, topics, 2_450_000_000n)).toEqual(
        oracleBackfill(topics, 2_450_000_000n),
      );
    },
  );

  it("matches the oracle across seeded randomized range and topic combinations", async () => {
    const source = await makeSource(buildManifest());

    // Deterministic LCG (numerical recipes constants) so failures are reproducible.
    let lcgState = 42n;
    const nextRandom = (): number => {
      lcgState = (lcgState * 1664525n + 1013904223n) % 4294967296n;
      return Number(lcgState) / 4294967296;
    };
    const topicSets = [[CAM_TOPIC], [STATE_TOPIC], [CAM_TOPIC, STATE_TOPIC]];

    for (let i = 0; i < 100; i++) {
      const startNs = BigInt(Math.floor(nextRandom() * 4_200_000_000));
      const endNs = startNs + BigInt(Math.floor(nextRandom() * 1_500_000_000));
      const topics = topicSets[Math.floor(nextRandom() * topicSets.length)]!;

      const actual = await collectIterate(source, topics, startNs, endNs);
      const expected = oracleIterate(topics, startNs, endNs);
      if (actual.join() !== expected.join()) {
        throw new Error(
          `iterate divergence at iteration ${i} range [${startNs}, ${endNs}] topics ${topics.join()}: actual ${actual.join()} expected ${expected.join()}`,
        );
      }

      const targetNs = BigInt(Math.floor(nextRandom() * 4_200_000_000));
      const actualBackfill = await collectBackfill(source, topics, targetNs);
      const expectedBackfill = oracleBackfill(topics, targetNs);
      if (actualBackfill.join() !== expectedBackfill.join()) {
        throw new Error(
          `backfill divergence at iteration ${i} target ${targetNs} topics ${topics.join()}: actual ${actualBackfill.join()} expected ${expectedBackfill.join()}`,
        );
      }
    }
  });
});
