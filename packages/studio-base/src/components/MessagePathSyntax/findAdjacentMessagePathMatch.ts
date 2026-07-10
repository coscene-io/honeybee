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

export type PreviousRangeWindow = {
  /** The fully scanned half-open range [coveredStart, coveredEndExclusive). */
  readonly coveredStart: Time;
  readonly coveredEndExclusive: Time;
  /**
   * Sorted oldest to newest. Filtered paths contain confirmed matches; unfiltered paths contain
   * topic/time candidates that must be materialized again when consumed.
   */
  readonly candidates: readonly MessageEvent[];
};

export type AdjacentMessagePathMatchResult =
  | {
      readonly type: "found";
      readonly message: MessageAndData;
      readonly previousWindow?: PreviousRangeWindow;
    }
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
const PREVIOUS_WINDOW_DURATIONS = Object.freeze([
  { sec: 0, nsec: 500_000_000 },
  { sec: 1, nsec: 0 },
  { sec: 2, nsec: 0 },
  { sec: 5, nsec: 0 },
]);
const MAX_PREVIOUS_RANGE_CANDIDATES = 1000;
const MAX_PREVIOUS_RANGE_CACHE_BYTES = 16 * 1024 * 1024;

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

function previousWindowDuration(index: number, maxDuration: Time): Time {
  const duration = PREVIOUS_WINDOW_DURATIONS[index] ?? maxDuration;
  return minTime(duration, maxDuration);
}

type PreviousRangeAccumulator = {
  candidates: MessageEvent[];
  candidateBytes: number;
  latestMatch: MessageAndData | undefined;
  latestEvictedMatch: MessageAndData | undefined;
  truncated: boolean;
};

function createPreviousRangeAccumulator(): PreviousRangeAccumulator {
  return {
    candidates: [],
    candidateBytes: 0,
    latestMatch: undefined,
    latestEvictedMatch: undefined,
    truncated: false,
  };
}

function isLaterMatch(candidate: MessageAndData, current: MessageAndData | undefined): boolean {
  return (
    current == undefined ||
    compare(candidate.messageEvent.receiveTime, current.messageEvent.receiveTime) > 0
  );
}

function addPreviousCandidates(args: {
  readonly accumulator: PreviousRangeAccumulator;
  readonly candidates: readonly MessageEvent[];
  readonly path: string;
  readonly hasFilter: boolean;
  readonly getMessagePathDataItems: GetMessagePathDataItems;
}): void {
  const { accumulator } = args;
  for (const candidate of args.candidates) {
    accumulator.candidates.push(candidate);
    accumulator.candidateBytes += Math.max(0, candidate.sizeInBytes);
  }
  accumulator.candidates.sort((a, b) => compare(a.receiveTime, b.receiveTime));

  while (
    accumulator.candidates.length > MAX_PREVIOUS_RANGE_CANDIDATES ||
    accumulator.candidateBytes > MAX_PREVIOUS_RANGE_CACHE_BYTES
  ) {
    const evicted = accumulator.candidates.shift();
    if (evicted == undefined) {
      break;
    }
    accumulator.truncated = true;
    accumulator.candidateBytes -= Math.max(0, evicted.sizeInBytes);
    if (!args.hasFilter) {
      const evictedMatch = messagePathMatch(
        args.path,
        evicted,
        args.getMessagePathDataItems,
      );
      if (evictedMatch != undefined && isLaterMatch(evictedMatch, accumulator.latestEvictedMatch)) {
        accumulator.latestEvictedMatch = evictedMatch;
      }
    }
  }
}

async function scanMessagesInRange(args: {
  readonly topic: string;
  readonly start: Time;
  readonly end: Time;
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly abortSignal: AbortSignal | undefined;
  readonly onIteratorStart?: () => void;
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
          args.onIteratorStart?.();
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
  readonly hasFilter: boolean;
  readonly windowDuration: Time;
  readonly subscribeMessageRange: SubscribeMessageRange;
  readonly getMessagePathDataItems: GetMessagePathDataItems;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<AdjacentMessagePathMatchResult> {
  if (compare(args.fromTime, args.startTime) <= 0) {
    return { type: "notFound" };
  }

  let rangeEnd = subtract(args.fromTime, ONE_NANOSECOND);
  let windowIndex = 0;
  while (compare(rangeEnd, args.startTime) >= 0) {
    const duration = previousWindowDuration(windowIndex, args.windowDuration);
    const rangeStart = maxTime(subtract(rangeEnd, duration), args.startTime);
    let accumulator = createPreviousRangeAccumulator();
    const rangeResult = await scanMessagesInRange({
      topic: args.topic,
      start: rangeStart,
      end: rangeEnd,
      subscribeMessageRange: args.subscribeMessageRange,
      abortSignal: args.abortSignal,
      onIteratorStart: () => {
        accumulator = createPreviousRangeAccumulator();
      },
      scanBatch: (batch) => {
        const batchCandidates: MessageEvent[] = [];
        for (const message of batch) {
          if (message.topic !== args.topic || compare(message.receiveTime, args.fromTime) >= 0) {
            continue;
          }
          if (args.hasFilter) {
            const match = messagePathMatch(args.path, message, args.getMessagePathDataItems);
            if (match == undefined) {
              continue;
            }
            if (isLaterMatch(match, accumulator.latestMatch)) {
              accumulator.latestMatch = match;
            }
          }
          batchCandidates.push(message);
        }
        addPreviousCandidates({
          accumulator,
          candidates: batchCandidates,
          path: args.path,
          hasFilter: args.hasFilter,
          getMessagePathDataItems: args.getMessagePathDataItems,
        });
        return undefined;
      },
      getDoneResult: () => {
        let latestMatch = accumulator.latestMatch;
        if (!args.hasFilter) {
          for (let i = accumulator.candidates.length - 1; i >= 0; i--) {
            const candidate = accumulator.candidates[i];
            if (candidate == undefined) {
              continue;
            }
            const match = messagePathMatch(args.path, candidate, args.getMessagePathDataItems);
            if (match != undefined) {
              latestMatch = match;
              break;
            }
          }
          latestMatch ??= accumulator.latestEvictedMatch;
        }
        if (latestMatch == undefined) {
          return { type: "notFound" };
        }

        const firstCandidate = accumulator.candidates[0];
        const coveredStart = accumulator.truncated
          ? firstCandidate?.receiveTime
          : rangeStart;
        const previousWindow =
          coveredStart != undefined &&
          accumulator.candidates.length > 0 &&
          compare(latestMatch.messageEvent.receiveTime, coveredStart) >= 0
            ? {
                coveredStart,
                coveredEndExclusive: args.fromTime,
                candidates: accumulator.candidates,
              }
            : undefined;
        return previousWindow != undefined
          ? { type: "found", message: latestMatch, previousWindow }
          : { type: "found", message: latestMatch };
      },
    });

    if (rangeResult.type !== "notFound") {
      return rangeResult;
    }

    rangeEnd = subtract(rangeStart, ONE_NANOSECOND);
    windowIndex++;
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
        hasFilter: messagePath.messagePath.some((part) => part.type === "filter"),
        windowDuration: args.windowDuration,
        subscribeMessageRange: args.subscribeMessageRange,
        getMessagePathDataItems: args.getMessagePathDataItems,
        abortSignal: args.abortSignal,
      });
  }
}
