// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";
import {
  MessageEvent,
  SubscribeMessageRange,
} from "@foxglove/studio-base/players/types";

import {
  findAdjacentMessagePathMatch,
  GetMessagePathDataItems,
} from "./findAdjacentMessagePathMatch";

function time(sec: number, nsec = 0): Time {
  return { sec, nsec };
}

function message(sec: number, value: number): MessageEvent<{ value: number }> {
  return {
    topic: "/topic",
    receiveTime: time(sec),
    message: { value },
    schemaName: "datatype",
    sizeInBytes: 0,
  };
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
    return value === matchingValue
      ? [{ path, value: matchingValue }]
      : [];
  };
}

function makeSubscribeMessageRange(messages: readonly MessageEvent[]): {
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly unsubscribeMocks: jest.Mock[];
} {
  const unsubscribeMocks: jest.Mock[] = [];
  const subscribeMessageRange: SubscribeMessageRange = ({ timeRange, onNewRangeIterator }) => {
    const unsubscribe = jest.fn();
    unsubscribeMocks.push(unsubscribe);
    const batch = messages.filter((msg) => isInRange(msg.receiveTime, timeRange.start, timeRange.end));

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

    expect(result).toEqual({
      type: "found",
      message: {
        messageEvent: message(2, 1),
        queriedData: [{ path: "/topic{value==1}.value", value: 1 }],
      },
    });
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
