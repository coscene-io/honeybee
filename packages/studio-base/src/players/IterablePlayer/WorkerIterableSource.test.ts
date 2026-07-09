// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { ComlinkWrap } from "@foxglove/den/worker";
import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import { Initalization, IteratorResult, MessageIteratorArgs } from "./IIterableSource";
import { WorkerIterableSource } from "./WorkerIterableSource";
import { WorkerSerializedIterableSource } from "./WorkerSerializedIterableSource";

jest.mock("@foxglove/den/worker", () => ({
  ComlinkWrap: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (err: unknown) => void;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function stamp(sec: number): IteratorResult {
  return { type: "stamp", stamp: { sec, nsec: 0 } };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const initResult: Initalization = {
  start: { sec: 0, nsec: 0 },
  end: { sec: 1, nsec: 0 },
  topics: [],
  topicStats: new Map(),
  profile: undefined,
  problems: [],
  datatypes: new Map(),
  publishersByTopic: new Map(),
};

const iteratorArgs: MessageIteratorArgs = {
  topics: mockTopicSelection("a"),
  start: { sec: 0, nsec: 0 },
};

function setupWorkerRemote() {
  const first = deferred<IteratorResult[] | undefined>();
  const second = deferred<IteratorResult[] | undefined>();
  const releaseProxy = jest.fn();
  const remoteCursor = {
    next: jest.fn(async () => undefined),
    nextBatch: jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(undefined),
    readUntil: jest.fn(async () => []),
    end: jest.fn(async () => {}),
    [Comlink.releaseProxy]: releaseProxy,
  };
  const sourceWorkerRemote = {
    initialize: jest.fn(async () => initResult),
    getBackfillMessages: jest.fn(async () => []),
    getMessageCursor: jest.fn(async () => remoteCursor),
    terminate: jest.fn(async () => {}),
  };
  const initializeWorker = jest.fn(async () => sourceWorkerRemote);
  const dispose = jest.fn();
  (ComlinkWrap as jest.Mock).mockReturnValue({ remote: initializeWorker, dispose });

  return { first, second, remoteCursor, releaseProxy };
}

describe("WorkerIterableSource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prefetches the next worker cursor batch during message iteration", async () => {
    const { first, second, remoteCursor, releaseProxy } = setupWorkerRemote();
    const source = new WorkerIterableSource({
      initWorker: () => ({}) as Worker,
      initArgs: {},
    });
    await source.initialize();

    const iterator = source.messageIterator(iteratorArgs);
    const firstRead = iterator.next();
    await flushPromises();
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(1);

    first.resolve([stamp(1)]);
    await expect(firstRead).resolves.toEqual({ done: false, value: stamp(1) });
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(2);

    const secondRead = iterator.next();
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(2);

    second.resolve([stamp(2)]);
    await expect(secondRead).resolves.toEqual({ done: false, value: stamp(2) });

    await iterator.return?.();
    expect(releaseProxy).toHaveBeenCalledTimes(1);
  });

  it("returns an unwrapped worker cursor from getMessageCursor", async () => {
    const { first, remoteCursor, releaseProxy } = setupWorkerRemote();
    const source = new WorkerIterableSource({
      initWorker: () => ({}) as Worker,
      initArgs: {},
    });
    await source.initialize();

    const cursor = source.getMessageCursor(iteratorArgs);
    const firstRead = cursor.nextBatch(100);
    await flushPromises();
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(1);

    first.resolve([stamp(1)]);
    await expect(firstRead).resolves.toEqual([stamp(1)]);
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(1);

    await cursor.end();
    expect(releaseProxy).toHaveBeenCalledTimes(1);
  });
});

describe("WorkerSerializedIterableSource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prefetches the next serialized worker cursor batch during message iteration", async () => {
    const { first, second, remoteCursor, releaseProxy } = setupWorkerRemote();
    const source = new WorkerSerializedIterableSource({
      initWorker: () => ({}) as Worker,
      initArgs: {},
    });
    await source.initialize();

    const iterator = source.messageIterator(iteratorArgs);
    const firstRead = iterator.next();
    await flushPromises();
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(1);

    first.resolve([stamp(1)]);
    await expect(firstRead).resolves.toEqual({ done: false, value: stamp(1) });
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(2);

    const secondRead = iterator.next();
    expect(remoteCursor.nextBatch).toHaveBeenCalledTimes(2);

    second.resolve([stamp(2)]);
    await expect(secondRead).resolves.toEqual({ done: false, value: stamp(2) });

    await iterator.return?.();
    expect(releaseProxy).toHaveBeenCalledTimes(1);
  });

  it("uses 100ms batches for serialized worker message iteration", async () => {
    const { remoteCursor } = setupWorkerRemote();
    remoteCursor.nextBatch.mockReset().mockResolvedValueOnce(undefined);
    const source = new WorkerSerializedIterableSource({
      initWorker: () => ({}) as Worker,
      initArgs: {},
    });
    await source.initialize();

    const iterator = source.messageIterator(iteratorArgs);
    await iterator.next();

    expect(remoteCursor.nextBatch).toHaveBeenCalledWith(100);
  });
});
