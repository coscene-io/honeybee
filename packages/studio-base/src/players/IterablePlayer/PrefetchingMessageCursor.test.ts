// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/studio";

import { IMessageCursor, IteratorResult } from "./IIterableSource";
import { PrefetchingMessageCursor } from "./PrefetchingMessageCursor";

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

function makeCursor(
  nextBatch: jest.Mock<Promise<IteratorResult[] | undefined>, [number]>,
): IMessageCursor {
  return {
    next: jest.fn(async () => undefined),
    nextBatch,
    readUntil: jest.fn(async () => []),
    end: jest.fn(async () => {}),
  };
}

describe("PrefetchingMessageCursor", () => {
  it("starts the next batch as soon as the current batch resolves", async () => {
    const first = deferred<IteratorResult[] | undefined>();
    const second = deferred<IteratorResult[] | undefined>();
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(undefined);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    const firstRead = cursor.nextBatch(100);
    expect(nextBatch).toHaveBeenCalledTimes(1);

    first.resolve([stamp(1)]);
    await expect(firstRead).resolves.toEqual([stamp(1)]);
    expect(nextBatch).toHaveBeenCalledTimes(2);

    const secondRead = cursor.nextBatch(100);
    expect(nextBatch).toHaveBeenCalledTimes(2);

    second.resolve([stamp(2)]);
    await expect(secondRead).resolves.toEqual([stamp(2)]);
    expect(nextBatch).toHaveBeenCalledTimes(3);
  });

  it("does not prefetch after the cursor is exhausted", async () => {
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValueOnce([stamp(1)])
      .mockResolvedValueOnce(undefined);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    await expect(cursor.nextBatch(100)).resolves.toEqual([stamp(1)]);
    expect(nextBatch).toHaveBeenCalledTimes(2);

    await expect(cursor.nextBatch(100)).resolves.toBeUndefined();
    expect(nextBatch).toHaveBeenCalledTimes(2);
  });

  it("does not prefetch after an empty batch", async () => {
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValue([]);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    await expect(cursor.nextBatch(100)).resolves.toEqual([]);
    expect(nextBatch).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from a prefetched batch", async () => {
    const err = new Error("prefetch failed");
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValueOnce([stamp(1)])
      .mockRejectedValueOnce(err);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    await cursor.nextBatch(100);
    await expect(cursor.nextBatch(100)).rejects.toThrow("prefetch failed");
  });

  it("ends the underlying cursor before an in-flight prefetch completes", async () => {
    const second = deferred<IteratorResult[] | undefined>();
    const end = jest.fn(async () => {});
    const underlying = {
      ...makeCursor(
        jest
          .fn<Promise<IteratorResult[] | undefined>, [number]>()
          .mockResolvedValueOnce([stamp(1)])
          .mockReturnValueOnce(second.promise),
      ),
      end,
    };
    const cursor = new PrefetchingMessageCursor(underlying);

    await cursor.nextBatch(100);
    const endPromise = cursor.end();
    await Promise.resolve();
    expect(end).toHaveBeenCalledTimes(1);

    second.resolve([stamp(2)]);
    await endPromise;
  });

  it("supports batch duration changes on the same cursor", async () => {
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValueOnce([stamp(1)])
      .mockResolvedValueOnce([stamp(2)]);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    await expect(cursor.nextBatch(100)).resolves.toEqual([stamp(1)]);
    await expect(cursor.nextBatch(17)).resolves.toEqual([stamp(2)]);
  });

  it("does not merge old buffered results with a same-duration prefetched batch", async () => {
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValueOnce([stamp(0)])
      .mockResolvedValueOnce([stamp(200), stamp(230), stamp(260)])
      .mockResolvedValueOnce([stamp(300), stamp(330), stamp(360)])
      .mockResolvedValue(undefined);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    await expect(cursor.nextBatch(100)).resolves.toEqual([stamp(0)]);
    await expect(cursor.nextBatch(17)).resolves.toEqual([stamp(200), stamp(230)]);

    await expect(cursor.nextBatch(17)).resolves.toEqual([stamp(260), stamp(300)]);
  });

  it("serves direct reads from an already-prefetched batch", async () => {
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValueOnce([stamp(1)])
      .mockResolvedValueOnce([stamp(2), stamp(3)]);
    const cursor = new PrefetchingMessageCursor(makeCursor(nextBatch));

    await cursor.nextBatch(100);
    await expect(cursor.readUntil({ sec: 3, nsec: 0 } as Time)).resolves.toEqual([stamp(2)]);
    await expect(cursor.next()).resolves.toEqual(stamp(3));
  });

  it("delegates direct reads before batch prefetching starts", async () => {
    const nextBatch = jest
      .fn<Promise<IteratorResult[] | undefined>, [number]>()
      .mockResolvedValue([]);
    const readUntil = jest.fn(async () => []);
    const underlying = { ...makeCursor(nextBatch), readUntil };
    const cursor = new PrefetchingMessageCursor(underlying);
    const end = { sec: 1, nsec: 0 } as Time;

    await cursor.readUntil(end);

    expect(readUntil).toHaveBeenCalledWith(end);
    expect(nextBatch).not.toHaveBeenCalled();
  });
});
