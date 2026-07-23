// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapTypes } from "@mcap/core";

import { loadDecompressHandlers } from "@foxglove/mcap-support";
import { Initalization } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { McapIndexedIterableSource } from "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIndexedIterableSource";
import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import { ShardManifestIterableSource } from "./ShardManifestIterableSource";
import { Manifest, ShardEntry } from "./manifest";

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

const mockInitializeReader = McapIndexedReader.Initialize as jest.MockedFunction<
  typeof McapIndexedReader.Initialize
>;
const mockLoadDecompressHandlers = loadDecompressHandlers as jest.MockedFunction<
  typeof loadDecompressHandlers
>;
const mockMcapIndexedIterableSource = McapIndexedIterableSource as jest.MockedClass<
  typeof McapIndexedIterableSource
>;
const mockReader = {} as unknown as McapIndexedReader;
const mockDecompressHandlers: McapTypes.DecompressHandlers = {};

function mockDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function shard(id: string): ShardEntry {
  return {
    id,
    kind: "topic",
    topic: "/cam/h264",
    schema: "CompressedImage",
    profile: "480p10",
    filename: `${id}.mcap`,
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    timeRange: { startNs: "0", endNs: "1000000000" },
    topics: [{ name: "/cam/h264", schema: "CompressedImage", messageCount: 1 }],
    messageCount: 1,
  };
}

function manifest(): Manifest {
  return {
    version: 1,
    sourceFiles: [
      {
        name: "record",
        sha256: "0".repeat(64),
        sizeBytes: 2048,
        timeRange: { startNs: "0", endNs: "1000000000" },
      },
    ],
    profiles: [{ id: "480p10", modality: "video", label: "480p", params: { h: 480, fps: 10 } }],
    shards: [shard("input-a"), shard("input-b")],
  };
}

function initResult(): Initalization {
  return {
    start: { sec: 0, nsec: 0 },
    end: { sec: 1, nsec: 0 },
    topics: [{ name: "/cam/h264", schemaName: "CompressedImage" }],
    topicStats: new Map(),
    datatypes: new Map(),
    profile: undefined,
    problems: [],
    publishersByTopic: new Map(),
  };
}

function indexedSource(): McapIndexedIterableSource {
  return {
    sourceType: "serialized",
    initialize: jest.fn(async () => initResult()),
    messageIterator: jest.fn(async function* () {
      yield* [];
    }),
    getBackfillMessages: jest.fn(async () => []),
  } as unknown as McapIndexedIterableSource;
}

describe("ShardManifestIterableSource", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> =>
        ({
          ok: true,
          json: async () => manifest(),
        }) as Response,
    );

    mockInitializeReader.mockReset();
    mockInitializeReader.mockResolvedValue(mockReader);
    mockLoadDecompressHandlers.mockReset();
    mockLoadDecompressHandlers.mockResolvedValue(mockDecompressHandlers);
    mockMcapIndexedIterableSource.mockReset();
    mockMcapIndexedIterableSource.mockImplementation(() => indexedSource());
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("opens temporary message iterator shard readers in parallel", async () => {
    const source = new ShardManifestIterableSource({
      manifestUrl: "https://example.com/manifest.json",
    });

    await source.initialize();

    const pendingOpens: Array<ReturnType<typeof mockDeferred<McapIndexedReader>>> = [];
    mockInitializeReader.mockReset();
    mockInitializeReader.mockImplementation(async () => {
      const pending = mockDeferred<McapIndexedReader>();
      pendingOpens.push(pending);
      return await pending.promise;
    });

    const iterator = source.messageIterator({
      topics: mockTopicSelection("/cam/h264"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 1, nsec: 0 },
      consumptionType: "partial",
    });

    const next = iterator.next();
    await Promise.resolve();

    expect(pendingOpens).toHaveLength(2);

    pendingOpens[0]!.resolve(mockReader);
    pendingOpens[1]!.resolve(mockReader);

    await expect(next).resolves.toEqual({ done: true, value: undefined });
  });

  it("cancels temporary reader opens without caching them", async () => {
    const source = new ShardManifestIterableSource({
      manifestUrl: "https://example.com/manifest.json",
    });
    const abortController = new AbortController();

    await source.initialize();

    const pendingOpens: Array<ReturnType<typeof mockDeferred<McapIndexedReader>>> = [];
    mockInitializeReader.mockReset();
    mockInitializeReader.mockImplementation(async () => {
      const pending = mockDeferred<McapIndexedReader>();
      pendingOpens.push(pending);
      return await pending.promise;
    });

    const iterator = source.messageIterator({
      topics: mockTopicSelection("/cam/h264"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 1, nsec: 0 },
      consumptionType: "partial",
      abortSignal: abortController.signal,
    });

    const next = iterator.next();
    await Promise.resolve();
    expect(pendingOpens).toHaveLength(2);

    abortController.abort();
    const abortError = new DOMException("signal is aborted without reason", "AbortError");
    pendingOpens[0]!.reject(abortError);
    pendingOpens[1]!.reject(abortError);

    await expect(next).resolves.toEqual({ done: true, value: undefined });

    mockInitializeReader.mockReset();
    mockInitializeReader.mockResolvedValue(mockReader);

    await source.getBackfillMessages({
      topics: mockTopicSelection("/cam/h264"),
      time: { sec: 0, nsec: 0 },
    });

    expect(mockInitializeReader).toHaveBeenCalledTimes(1);
  });

  it("cancels abortable backfill shard opens without reusing cached eager readers", async () => {
    const source = new ShardManifestIterableSource({
      manifestUrl: "https://example.com/manifest.json",
    });
    const abortController = new AbortController();
    const abortPromise = new Promise<void>((resolve) => {
      abortController.signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });

    await source.initialize();

    mockInitializeReader.mockReset();
    mockInitializeReader.mockImplementation(async ({ readable }) => {
      await abortPromise;
      await readable.read(0n, 1n);
      return mockReader;
    });

    const backfill = source.getBackfillMessages({
      topics: mockTopicSelection("/cam/h264"),
      time: { sec: 0, nsec: 0 },
      abortSignal: abortController.signal,
    });

    await Promise.resolve();
    abortController.abort();

    await expect(backfill).resolves.toEqual([]);
    expect(mockInitializeReader).toHaveBeenCalledTimes(2);

    mockInitializeReader.mockReset();
    mockInitializeReader.mockResolvedValue(mockReader);

    await source.getBackfillMessages({
      topics: mockTopicSelection("/cam/h264"),
      time: { sec: 0, nsec: 0 },
    });

    expect(mockInitializeReader).toHaveBeenCalledTimes(1);
  });

  it("preserves non-abort errors from backfill lazy shard opens", async () => {
    const source = new ShardManifestIterableSource({
      manifestUrl: "https://example.com/manifest.json",
    });

    await source.initialize();

    mockInitializeReader.mockReset();
    mockInitializeReader.mockRejectedValue(new Error("open failed"));

    await expect(
      source.getBackfillMessages({
        topics: mockTopicSelection("/cam/h264"),
        time: { sec: 0, nsec: 0 },
      }),
    ).rejects.toThrow("open failed");
  });
});
