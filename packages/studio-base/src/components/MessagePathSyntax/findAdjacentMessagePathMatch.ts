// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@foxglove/message-path";
import { add, compare, subtract } from "@foxglove/rostime";
import type { Time } from "@foxglove/rostime";
import type {
  MessageAndData,
  MessagePathDataItem,
} from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import type { MessageEvent, SubscribeMessageRange } from "@foxglove/studio-base/players/types";

export type FrameNavigationDirection = "previous" | "next";

export type GetMessagePathDataItems = (
  path: string,
  message: MessageEvent,
) => MessagePathDataItem[] | undefined;

export type AdjacentMessagePathMatchResult =
  | { readonly type: "found"; readonly message: MessageAndData }
  | { readonly type: "notFound" }
  | { readonly type: "aborted" }
  | { readonly type: "unsupported" }
  | { readonly type: "error"; readonly error: Error };

type FindAdjacentMessagePathMatchArgs = {
  readonly path: string;
  readonly direction: FrameNavigationDirection;
  readonly fromTime: Time;
  readonly startTime: Time;
  readonly endTime: Time;
  readonly windowDuration: Time;
  readonly subscribeMessageRange: SubscribeMessageRange | undefined;
  readonly getMessagePathDataItems: GetMessagePathDataItems;
  readonly abortSignal?: AbortSignal;
};

const ONE_NANOSECOND = Object.freeze({ sec: 0, nsec: 1 });
const ZERO_DURATION = Object.freeze({ sec: 0, nsec: 0 });

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function minTime(a: Time, b: Time): Time {
  return compare(a, b) <= 0 ? a : b;
}

function maxTime(a: Time, b: Time): Time {
  return compare(a, b) >= 0 ? a : b;
}

function messagePathMatch(
  path: string,
  message: MessageEvent,
  getMessagePathDataItems: GetMessagePathDataItems,
): MessageAndData | undefined {
  const queriedData = getMessagePathDataItems(path, message);
  if (queriedData == undefined || queriedData.length === 0) {
    return undefined;
  }
  return { messageEvent: message, queriedData };
}

async function scanMessagesInRange(args: {
  readonly topic: string;
  readonly start: Time;
  readonly end: Time;
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly abortSignal: AbortSignal | undefined;
  readonly scanBatch: (batch: readonly MessageEvent[]) => MessageAndData | undefined;
  readonly getDoneResult: () => AdjacentMessagePathMatchResult;
}): Promise<AdjacentMessagePathMatchResult> {
  if (args.abortSignal?.aborted === true) {
    return { type: "aborted" };
  }

  return await new Promise<AdjacentMessagePathMatchResult>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let latestIteratorGeneration = 0;

    const cleanup = () => {
      args.abortSignal?.removeEventListener("abort", onAbort);
      unsubscribe?.();
    };

    const settle = (result: AdjacentMessagePathMatchResult, iteratorGeneration?: number) => {
      if (settled) {
        return;
      }
      if (iteratorGeneration != undefined && iteratorGeneration !== latestIteratorGeneration) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      settle({ type: "aborted" });
    };

    args.abortSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      unsubscribe = args.subscribeMessageRange({
        topic: args.topic,
        timeRange: { start: args.start, end: args.end },
        onNewRangeIterator: async (iterator) => {
          const iteratorGeneration = ++latestIteratorGeneration;
          try {
            for await (const batch of iterator) {
              if (args.abortSignal?.aborted === true) {
                settle({ type: "aborted" }, iteratorGeneration);
                return;
              }
              if (settled || iteratorGeneration !== latestIteratorGeneration) {
                return;
              }
              const match = args.scanBatch(batch);
              if (match != undefined) {
                settle({ type: "found", message: match }, iteratorGeneration);
                return;
              }
            }
          } catch (error) {
            settle({ type: "error", error: toError(error) }, iteratorGeneration);
            return;
          }
          settle(args.getDoneResult(), iteratorGeneration);
        },
      });
    } catch (error) {
      settle({ type: "error", error: toError(error) });
      return;
    }

    if (unsubscribe == undefined) {
      settle({ type: "unsupported" });
    }
  });
}

async function findNextMessagePathMatch(args: {
  readonly topic: string;
  readonly fromTime: Time;
  readonly endTime: Time;
  readonly path: string;
  readonly windowDuration: Time;
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly getMessagePathDataItems: GetMessagePathDataItems;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<AdjacentMessagePathMatchResult> {
  if (compare(args.fromTime, args.endTime) >= 0) {
    return { type: "notFound" };
  }

  let rangeStart = add(args.fromTime, ONE_NANOSECOND);
  while (compare(rangeStart, args.endTime) <= 0) {
    const rangeEnd = minTime(add(rangeStart, args.windowDuration), args.endTime);
    const rangeResult = await scanMessagesInRange({
      topic: args.topic,
      start: rangeStart,
      end: rangeEnd,
      subscribeMessageRange: args.subscribeMessageRange,
      abortSignal: args.abortSignal,
      scanBatch: (batch) => {
        for (const message of batch) {
          if (compare(message.receiveTime, args.fromTime) <= 0) {
            continue;
          }
          const match = messagePathMatch(args.path, message, args.getMessagePathDataItems);
          if (match != undefined) {
            return match;
          }
        }
        return undefined;
      },
      getDoneResult: () => ({ type: "notFound" }),
    });

    if (rangeResult.type !== "notFound") {
      return rangeResult;
    }

    rangeStart = add(rangeEnd, ONE_NANOSECOND);
  }

  return { type: "notFound" };
}

async function findPreviousMessagePathMatch(args: {
  readonly topic: string;
  readonly fromTime: Time;
  readonly startTime: Time;
  readonly path: string;
  readonly windowDuration: Time;
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly getMessagePathDataItems: GetMessagePathDataItems;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<AdjacentMessagePathMatchResult> {
  if (compare(args.fromTime, args.startTime) <= 0) {
    return { type: "notFound" };
  }

  let rangeEnd = subtract(args.fromTime, ONE_NANOSECOND);
  while (compare(rangeEnd, args.startTime) >= 0) {
    const rangeStart = maxTime(subtract(rangeEnd, args.windowDuration), args.startTime);
    let latestMatch: MessageAndData | undefined;
    const rangeResult = await scanMessagesInRange({
      topic: args.topic,
      start: rangeStart,
      end: rangeEnd,
      subscribeMessageRange: args.subscribeMessageRange,
      abortSignal: args.abortSignal,
      scanBatch: (batch) => {
        for (const message of batch) {
          if (compare(message.receiveTime, args.fromTime) >= 0) {
            continue;
          }
          latestMatch =
            messagePathMatch(args.path, message, args.getMessagePathDataItems) ?? latestMatch;
        }
        return undefined;
      },
      getDoneResult: () =>
        latestMatch != undefined ? { type: "found", message: latestMatch } : { type: "notFound" },
    });

    if (rangeResult.type !== "notFound") {
      return rangeResult;
    }

    rangeEnd = subtract(rangeStart, ONE_NANOSECOND);
  }

  return { type: "notFound" };
}

export async function findAdjacentMessagePathMatch(
  args: FindAdjacentMessagePathMatchArgs,
): Promise<AdjacentMessagePathMatchResult> {
  if (args.abortSignal?.aborted === true) {
    return { type: "aborted" };
  }
  if (args.subscribeMessageRange == undefined) {
    return { type: "unsupported" };
  }
  if (compare(args.windowDuration, ZERO_DURATION) <= 0) {
    return { type: "error", error: new Error("windowDuration must be positive") };
  }

  const messagePath = parseMessagePath(args.path);
  if (messagePath == undefined) {
    return { type: "notFound" };
  }

  switch (args.direction) {
    case "next":
      return await findNextMessagePathMatch({
        topic: messagePath.topicName,
        fromTime: args.fromTime,
        endTime: args.endTime,
        path: args.path,
        windowDuration: args.windowDuration,
        subscribeMessageRange: args.subscribeMessageRange,
        getMessagePathDataItems: args.getMessagePathDataItems,
        abortSignal: args.abortSignal,
      });
    case "previous":
      return await findPreviousMessagePathMatch({
        topic: messagePath.topicName,
        fromTime: args.fromTime,
        startTime: args.startTime,
        path: args.path,
        windowDuration: args.windowDuration,
        subscribeMessageRange: args.subscribeMessageRange,
        getMessagePathDataItems: args.getMessagePathDataItems,
        abortSignal: args.abortSignal,
      });
  }
}
