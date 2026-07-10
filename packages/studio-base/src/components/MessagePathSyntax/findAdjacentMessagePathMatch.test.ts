// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";

import { compare, fromSec, subtract, type Time } from "@foxglove/rostime";
import type { MessageEvent, SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import {
  findAdjacentMessagePathMatch,
  GetMessagePathDataItems,
} from "./findAdjacentMessagePathMatch";

function time(sec: number, nsec = 0): Time {
  return { sec, nsec };
}

function messageAt(receiveTime: Time, value: number): MessageEvent<{ value: number }> {
  return {
    topic: "/topic",
    receiveTime,
    message: { value },
    schemaName: "datatype",
    sizeInBytes: 0,
  };
}

function message(sec: number, value: number): MessageEvent<{ value: number }> {
  return messageAt(time(sec), value);
}

function isInRange(messageTime: Time, start: Time, end: Time): boolean {
  return compare(messageTime, start) >= 0 && compare(messageTime, end) <= 0;
}

function makeGetFilteredItems(matchingValue: number): GetMessagePathDataItems {
  return (path, msg) => {
    if (path !== "/topic{value==1}.value") {
      return undefined;
    }
    const value =
      typeof msg.message === "object" && msg.message != undefined && "value" in msg.message
        ? msg.message.value
        : undefined;
    return value === matchingValue ? [{ path, value: matchingValue }] : [];
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise == undefined) {
    throw new Error("Expected deferred resolver to be initialized");
  }
  return { promise, resolve: resolvePromise };
}

function makeSubscribeMessageRange(messages: readonly MessageEvent[]): {
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly unsubscribeMocks: jest.Mock[];
} {
  const unsubscribeMocks: jest.Mock[] = [];
  const subscribeMessageRange: SubscribeMessageRange = ({ timeRange, onNewRangeIterator }) => {
    const unsubscribe = jest.fn();
    unsubscribeMocks.push(unsubscribe);
    const batch = messages.filter((msg) =>
      isInRange(msg.receiveTime, timeRange.start, timeRange.end),
    );

    void onNewRangeIterator(
      (async function* messageBatchIterator() {
        yield batch;
      })(),
    );

    return unsubscribe;
  };

  return { subscribeMessageRange, unsubscribeMocks };
}

describe("findAdjacentMessagePathMatch", () => {
  it("finds the next message that matches the current filter", async () => {
    const { subscribeMessageRange, unsubscribeMocks } = makeSubscribeMessageRange([
      message(2, 2),
      message(3, 1),
      message(4, 1),
    ]);

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "next",
      fromTime: time(1),
      startTime: time(0),
      endTime: time(5),
      windowDuration: time(1),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toEqual({
      type: "found",
      message: {
        messageEvent: message(3, 1),
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
    expect(unsubscribeMocks).toHaveLength(2);
  });

  it("stops scanning the current range after the first next match", async () => {
    const releaseSecondBatch = deferred();
    const unsubscribe = jest.fn();
    let waitedForSecondBatch = false;
    const subscribeMessageRange: SubscribeMessageRange = ({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* messageBatchIterator() {
          yield [message(2, 1)];
          waitedForSecondBatch = true;
          await releaseSecondBatch.promise;
          yield [message(3, 1)];
        })(),
      );

      return unsubscribe;
    };

    const resultPromise = findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "next",
      fromTime: time(1),
      startTime: time(0),
      endTime: time(5),
      windowDuration: time(4),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    const result = await race([
      resultPromise,
      new Promise<"timedOut">((resolve) => {
        setTimeout(() => {
          resolve("timedOut");
        }, 0);
      }),
    ]);

    expect(result).toEqual({
      type: "found",
      message: {
        messageEvent: message(2, 1),
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
    expect(waitedForSecondBatch).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("finds the previous matching message closest to the current time", async () => {
    const { subscribeMessageRange } = makeSubscribeMessageRange([
      message(1, 1),
      message(2, 1),
      message(3, 2),
    ]);

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(4),
      startTime: time(0),
      endTime: time(5),
      windowDuration: time(2),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toMatchObject({
      type: "found",
      message: {
        messageEvent: message(2, 1),
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
  });

  it("finds the previous closest matching message across multiple batches", async () => {
    const subscribeMessageRange: SubscribeMessageRange = ({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* messageBatchIterator() {
          yield [message(1, 1), message(2, 2)];
          yield [message(3, 1), message(4, 2)];
        })(),
      );

      return jest.fn();
    };

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(5),
      startTime: time(0),
      endTime: time(6),
      windowDuration: time(6),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toMatchObject({
      type: "found",
      message: {
        messageEvent: message(3, 1),
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
  });

  it("finds the latest previous match from unsorted batches", async () => {
    const messages = [
      messageAt(fromSec(4.8), 1),
      messageAt(fromSec(4.6), 1),
      messageAt(fromSec(4.7), 1),
    ];
    const subscribeMessageRange: SubscribeMessageRange = ({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* messageBatchIterator() {
          yield [messages[0]!, messages[1]!];
          yield [messages[2]!];
        })(),
      );
      return jest.fn();
    };

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(5),
      startTime: time(0),
      endTime: time(6),
      windowDuration: time(6),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toEqual({
      type: "found",
      message: {
        messageEvent: messages[0],
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
  });

  it("searches across empty adaptive windows", async () => {
    const target = message(7, 1);
    const ranges: { readonly start: Time; readonly end: Time }[] = [];
    const subscribeMessageRange: SubscribeMessageRange = ({ timeRange, onNewRangeIterator }) => {
      ranges.push(timeRange);
      const batch = isInRange(target.receiveTime, timeRange.start, timeRange.end) ? [target] : [];
      void onNewRangeIterator(
        (async function* messageBatchIterator() {
          yield batch;
        })(),
      );
      return jest.fn();
    };

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(10),
      startTime: time(0),
      endTime: time(11),
      windowDuration: time(10),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(ranges).toHaveLength(3);
    expect(result).toMatchObject({
      type: "found",
      message: { messageEvent: target },
    });
  });

  it.each([
    [0.25, [0.25, 0.25, 0.25]],
    [0.5, [0.5, 0.5, 0.5]],
    [0.75, [0.5, 0.75, 0.75]],
    [1, [0.5, 1, 1]],
    [3, [0.5, 1, 2, 3]],
    [10, [0.5, 1, 2, 5, 10]],
  ])("uses adaptive previous windows capped at %s seconds", async (maxSeconds, expected) => {
    const ranges: { readonly start: Time; readonly end: Time }[] = [];
    const subscribeMessageRange: SubscribeMessageRange = ({ timeRange, onNewRangeIterator }) => {
      ranges.push(timeRange);
      void onNewRangeIterator(
        (async function* emptyIterator() {
          yield [];
        })(),
      );
      return jest.fn();
    };

    await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(20),
      startTime: time(0),
      endTime: time(21),
      windowDuration: fromSec(maxSeconds),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    const initialRanges = ranges.slice(0, expected.length);
    expect(initialRanges.map(({ start, end }) => subtract(end, start))).toEqual(
      expected.map(fromSec),
    );
    for (let i = 1; i < initialRanges.length; i++) {
      expect(initialRanges[i]!.end).toEqual(subtract(initialRanges[i - 1]!.start, time(0, 1)));
    }
  });

  it("checks an earlier unfiltered candidate when the latest has no queried data", async () => {
    const candidates = [messageAt(fromSec(4.6), 1), messageAt(fromSec(4.8), 2)];
    const { subscribeMessageRange } = makeSubscribeMessageRange(candidates);
    const getMessagePathDataItems = jest.fn<
      ReturnType<GetMessagePathDataItems>,
      Parameters<GetMessagePathDataItems>
    >((path, event) => (event === candidates[0] ? [{ path, value: event.message }] : []));

    const result = await findAdjacentMessagePathMatch({
      path: "/topic",
      direction: "previous",
      fromTime: time(5),
      startTime: time(0),
      endTime: time(6),
      windowDuration: time(6),
      subscribeMessageRange,
      getMessagePathDataItems,
    });

    expect(result).toMatchObject({ type: "found", message: { messageEvent: candidates[0] } });
    expect(getMessagePathDataItems).toHaveBeenCalledTimes(2);
  });

  it("does not return previous messages with the current receive time", async () => {
    const previous = message(4, 1);
    const { subscribeMessageRange } = makeSubscribeMessageRange([
      previous,
      message(5, 1),
      message(5, 1),
    ]);

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(5),
      startTime: time(0),
      endTime: time(6),
      windowDuration: time(5),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toMatchObject({ type: "found", message: { messageEvent: previous } });
  });

  it("ignores stale iterators after a replacement range iterator arrives", async () => {
    const releaseNextIterator = deferred();
    const subscribeMessageRange: SubscribeMessageRange = ({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* staleIterator() {
          await Promise.resolve();
          yield [message(2, 1)];
        })(),
      );
      void onNewRangeIterator(
        (async function* currentIterator() {
          await releaseNextIterator.promise;
          yield [message(3, 1)];
        })(),
      );

      return jest.fn();
    };

    const resultPromise = findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "next",
      fromTime: time(1),
      startTime: time(0),
      endTime: time(5),
      windowDuration: time(4),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    await Promise.resolve();
    await expect(race([resultPromise, Promise.resolve("pending")])).resolves.toBe("pending");

    releaseNextIterator.resolve();

    await expect(resultPromise).resolves.toEqual({
      type: "found",
      message: {
        messageEvent: message(3, 1),
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
  });

  it("does not return stale previous matches from a replaced iterator", async () => {
    const keepStaleIteratorOpen = deferred();
    const staleIteratorScanned = deferred();
    const subscribeMessageRange: SubscribeMessageRange = ({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* staleIterator() {
          yield [message(2, 1)];
          staleIteratorScanned.resolve();
          await keepStaleIteratorOpen.promise;
        })(),
      );
      void (async () => {
        await staleIteratorScanned.promise;
        void onNewRangeIterator(
          (async function* currentIterator() {
            yield [message(3, 2)];
          })(),
        );
      })();

      return jest.fn();
    };

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "previous",
      fromTime: time(4),
      startTime: time(0),
      endTime: time(5),
      windowDuration: time(4),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toEqual({ type: "notFound" });
  });

  it("returns notFound after scanning to the data boundary without backfilling old messages", async () => {
    const { subscribeMessageRange } = makeSubscribeMessageRange([message(0, 1)]);

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "next",
      fromTime: time(1),
      startTime: time(0),
      endTime: time(3),
      windowDuration: time(1),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result).toEqual({ type: "notFound" });
  });

  it("does not navigate across messages with the same receive time", async () => {
    const { subscribeMessageRange } = makeSubscribeMessageRange([
      message(1, 1),
      message(1, 1),
      message(2, 1),
    ]);

    const result = await findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "next",
      fromTime: time(1),
      startTime: time(0),
      endTime: time(3),
      windowDuration: time(1),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
    });

    expect(result.type).toBe("found");
    if (result.type === "found") {
      expect(result.message.messageEvent.receiveTime).toEqual(time(2));
    }
  });

  it("aborts an in-flight range subscription", async () => {
    const abortController = new AbortController();
    const unsubscribe = jest.fn();
    const subscribeMessageRange: SubscribeMessageRange = () => unsubscribe;

    const promise = findAdjacentMessagePathMatch({
      path: "/topic{value==1}.value",
      direction: "next",
      fromTime: time(1),
      startTime: time(0),
      endTime: time(3),
      windowDuration: time(1),
      subscribeMessageRange,
      getMessagePathDataItems: makeGetFilteredItems(1),
      abortSignal: abortController.signal,
    });

    abortController.abort();

    await expect(promise).resolves.toEqual({ type: "aborted" });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
