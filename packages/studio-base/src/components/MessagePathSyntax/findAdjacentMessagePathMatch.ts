// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

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

type ReadRangeResult =
  | { readonly type: "messages"; readonly messages: readonly MessageEvent[] }
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

async function readMessagesInRange(args: {
  readonly topic: string;
  readonly start: Time;
  readonly end: Time;
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<ReadRangeResult> {
  if (args.abortSignal?.aborted === true) {
    return { type: "aborted" };
  }

  return await new Promise<ReadRangeResult>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let cleanupRequested = false;

    const cleanup = () => {
      args.abortSignal?.removeEventListener("abort", onAbort);
      if (unsubscribe) {
        unsubscribe();
      } else {
        cleanupRequested = true;
      }
    };

    const settle = (result: ReadRangeResult) => {
      if (settled) {
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
          const messages: MessageEvent[] = [];
          try {
            for await (const batch of iterator) {
              if (args.abortSignal?.aborted === true) {
                settle({ type: "aborted" });
                return;
              }
              messages.push(...batch);
            }
          } catch (error) {
            settle({ type: "error", error: toError(error) });
            return;
          }
          settle({ type: "messages", messages });
        },
      });
    } catch (error) {
      settle({ type: "error", error: toError(error) });
      return;
    }

    if (cleanupRequested) {
      unsubscribe?.();
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
    const rangeResult = await readMessagesInRange({
      topic: args.topic,
      start: rangeStart,
      end: rangeEnd,
      subscribeMessageRange: args.subscribeMessageRange,
      abortSignal: args.abortSignal,
    });

    if (rangeResult.type !== "messages") {
      return rangeResult;
    }

    for (const message of rangeResult.messages) {
      if (compare(message.receiveTime, args.fromTime) <= 0) {
        continue;
      }
      const match = messagePathMatch(args.path, message, args.getMessagePathDataItems);
      if (match) {
        return { type: "found", message: match };
      }
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
    const rangeResult = await readMessagesInRange({
      topic: args.topic,
      start: rangeStart,
      end: rangeEnd,
      subscribeMessageRange: args.subscribeMessageRange,
      abortSignal: args.abortSignal,
    });

    if (rangeResult.type !== "messages") {
      return rangeResult;
    }

    let latestMatch: MessageAndData | undefined;
    for (const message of rangeResult.messages) {
      if (compare(message.receiveTime, args.fromTime) >= 0) {
        continue;
      }
      latestMatch = messagePathMatch(args.path, message, args.getMessagePathDataItems) ?? latestMatch;
    }
    if (latestMatch) {
      return { type: "found", message: latestMatch };
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
