// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@foxglove/message-path";
import { fillInGlobalVariablesInPath } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import type { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import type { SubscribeMessageRange, SubscribePayload } from "@foxglove/studio-base/players/types";

import type { BasePlotPath, PlotPath, PlotXAxisVal } from "./config";
import { isReferenceLinePlotPathType } from "./config";
import { pathToSubscribePayload } from "./subscription";

export type PlotRangeRequestPlan = Readonly<{
  topic: string;
  payload: Readonly<Pick<SubscribePayload, "fields">>;
  seriesIndices: readonly number[];
  includesXAxis?: boolean;
}>;

export type PlotTopicSubscriptionPlan = Readonly<{
  /** Current-only subscription used while a range iterator supplies replay history. */
  subscription: SubscribePayload;
  /** Subscription to use when the range request is unsupported for this topic. */
  fallbackSubscription: SubscribePayload;
  rangeRequest?: PlotRangeRequestPlan;
}>;

type RangeSubscriptionState = {
  cancelled: boolean;
  fallbackQueue: Promise<void>;
  latestIteratorByTopic: Map<string, number>;
  rangeTopics: Set<string>;
};

export type RunningPlotRangeSubscriptions = Readonly<{
  /** Topics whose history was initially assigned to a range iterator. */
  rangeTopics: ReadonlySet<string>;
  /** Initial current subscriptions, including synchronous per-topic full-history fallbacks. */
  subscriptions: readonly SubscribePayload[];
  cancel: () => void;
}>;

type StartPlotRangeSubscriptionsArgs = Readonly<{
  plans: readonly PlotTopicSubscriptionPlan[];
  /** False for live players and x-axis modes which do not use range history. */
  attemptRanges: boolean;
  subscribeMessageRange?: SubscribeMessageRange;
  /** Resolved after the Dataset builder has established ownership for this generation. */
  generation: Promise<number>;
  /** Reset a topic before every initial or replacement iterator starts replaying it. */
  onIteratorStart: (topic: string, generation: number) => Promise<void>;
  onRangeBatch: (
    topic: string,
    batch: readonly import("@foxglove/studio").MessageEvent[],
    generation: number,
  ) => Promise<void>;
  /**
   * Switch one asynchronously failed range topic to its full-preload subscription. Returning true
   * means the fallback was established; false lets the caller surface the original error.
   */
  onTopicFallback?: (args: {
    topic: string;
    generation: number;
    rangeTopics: ReadonlySet<string>;
    subscriptions: readonly SubscribePayload[];
  }) => Promise<boolean>;
  onError?: (error: unknown) => void;
}>;

type PlanPlotSubscriptionsArgs = Readonly<{
  paths: readonly Readonly<PlotPath>[];
  globalVariables: GlobalVariables;
  xAxisMode: PlotXAxisVal;
  xAxisPath?: Readonly<BasePlotPath>;
}>;

type MutableTopicPlan = {
  topic: string;
  fields: Set<string>;
  seriesIndices: number[];
  includesXAxis: boolean;
};

const MAX_RANGE_INGEST_BATCH_SIZE = 10_000;

/**
 * Builds one subscription plan per topic, preserving the order in which topics first appear.
 * Timestamp and accumulated custom-x history use range requests; latest-value modes keep their
 * existing preload behavior.
 */
export function planPlotSubscriptions(
  args: PlanPlotSubscriptionsArgs,
): readonly PlotTopicSubscriptionPlan[] {
  const { paths, globalVariables, xAxisMode, xAxisPath } = args;
  const topics = new Map<string, MutableTopicPlan>();

  const addPath = (value: string, seriesIndex?: number, role?: "xAxis"): void => {
    const parsed = parseMessagePath(value);
    if (parsed == undefined) {
      return;
    }

    const resolved = fillInGlobalVariablesInPath(parsed, globalVariables);
    const subscription = pathToSubscribePayload(resolved, "partial");
    if (subscription == undefined) {
      return;
    }

    let topicPlan = topics.get(subscription.topic);
    if (topicPlan == undefined) {
      topicPlan = {
        topic: subscription.topic,
        fields: new Set<string>(),
        seriesIndices: [],
        includesXAxis: false,
      };
      topics.set(subscription.topic, topicPlan);
    }

    for (const field of subscription.fields ?? []) {
      topicPlan.fields.add(field);
    }
    if (seriesIndex != undefined) {
      topicPlan.seriesIndices.push(seriesIndex);
    }
    topicPlan.includesXAxis ||= role === "xAxis";
  };

  paths.forEach((path, index) => {
    if (!path.enabled || isReferenceLinePlotPathType(path)) {
      return;
    }
    addPath(path.value, index);
  });

  if (
    (xAxisMode === "custom" || xAxisMode === "currentCustom") &&
    xAxisPath != undefined &&
    ((xAxisPath as { enabled?: boolean }).enabled ?? true)
  ) {
    addPath(xAxisPath.value, undefined, "xAxis");
  }

  const rangeEnabled = xAxisMode === "timestamp" || xAxisMode === "custom";
  const primaryPreloadType = "partial";

  return Array.from(topics.values(), (topicPlan): PlotTopicSubscriptionPlan => {
    const fields = Array.from(topicPlan.fields);
    const subscription: SubscribePayload = {
      topic: topicPlan.topic,
      fields: [...fields],
      preloadType: primaryPreloadType,
    };
    const fallbackSubscription: SubscribePayload = {
      topic: topicPlan.topic,
      fields: [...fields],
      preloadType: rangeEnabled ? "full" : primaryPreloadType,
    };

    return {
      subscription,
      fallbackSubscription,
      ...(rangeEnabled
        ? {
            rangeRequest: {
              topic: topicPlan.topic,
              payload: { fields: [...fields] },
              seriesIndices: [...topicPlan.seriesIndices],
              ...(topicPlan.includesXAxis ? { includesXAxis: true } : {}),
            },
          }
        : {}),
    };
  });
}

/**
 * Starts the range iterators synchronously so unsupported topics can fall back independently.
 * Iterator consumption is backpressured by `onRangeBatch`; `cancel` also makes already-resolved
 * iterator batches stale before asking the Player to unsubscribe.
 */
export function startPlotRangeSubscriptions(
  args: StartPlotRangeSubscriptionsArgs,
): RunningPlotRangeSubscriptions {
  const rangeTopics = new Set<string>();
  const subscriptions: SubscribePayload[] = [];
  const unsubscribes: (() => void)[] = [];
  const state: RangeSubscriptionState = {
    cancelled: false,
    fallbackQueue: Promise.resolve(),
    latestIteratorByTopic: new Map<string, number>(),
    rangeTopics,
  };

  for (const [planIndex, plan] of args.plans.entries()) {
    const request = plan.rangeRequest;
    const subscribeMessageRange = args.subscribeMessageRange;
    if (!args.attemptRanges || request == undefined || subscribeMessageRange == undefined) {
      subscriptions.push(
        args.attemptRanges && request != undefined ? plan.fallbackSubscription : plan.subscription,
      );
      continue;
    }

    const unsubscribe = tryStartRangeSubscription(
      args,
      subscribeMessageRange,
      request,
      state,
      async (error, generation) => {
        state.rangeTopics.delete(request.topic);
        state.latestIteratorByTopic.delete(request.topic);
        subscriptions[planIndex] = plan.fallbackSubscription;

        // Player iterators may fail concurrently. Serialize commits so a slower earlier fallback
        // cannot finish after a later fallback and restore that topic's stale partial subscription.
        const fallbackOperation = state.fallbackQueue.then(async () => {
          let fallbackEstablished = false;
          try {
            fallbackEstablished =
              (await args.onTopicFallback?.({
                topic: request.topic,
                generation,
                rangeTopics: new Set(state.rangeTopics),
                subscriptions: [...subscriptions],
              })) === true;
          } catch (fallbackError) {
            args.onError?.(fallbackError);
          }
          if (!fallbackEstablished) {
            args.onError?.(error);
          }
        });
        state.fallbackQueue = fallbackOperation.catch(() => undefined);
        await fallbackOperation;
      },
    );

    if (unsubscribe == undefined) {
      subscriptions.push(plan.fallbackSubscription);
      continue;
    }

    rangeTopics.add(request.topic);
    unsubscribes.push(unsubscribe);
    subscriptions.push(plan.subscription);
  }

  return {
    rangeTopics: new Set(rangeTopics),
    subscriptions: [...subscriptions],
    cancel: () => {
      if (state.cancelled) {
        return;
      }
      state.cancelled = true;
      state.latestIteratorByTopic.clear();
      for (const unsubscribe of unsubscribes) {
        try {
          unsubscribe();
        } catch {
          // Continue cancelling the other topic ranges during cleanup.
        }
      }
    },
  };
}

function tryStartRangeSubscription(
  args: StartPlotRangeSubscriptionsArgs,
  subscribeMessageRange: SubscribeMessageRange,
  request: PlotRangeRequestPlan,
  state: RangeSubscriptionState,
  onAsyncFailure: (error: unknown, generation: number) => Promise<void>,
): (() => void) | undefined {
  let iteratorGeneration = 0;
  let unsubscribe: (() => void) | undefined;
  let unsubscribed = false;
  const stop = (): void => {
    if (unsubscribed) {
      return;
    }
    unsubscribed = true;
    try {
      unsubscribe?.();
    } catch {
      // A failed Player cleanup must not prevent the topic from switching to its fallback.
    }
  };
  try {
    const subscription = subscribeMessageRange({
      topic: request.topic,
      payload: request.payload,
      receiveLiveData: false,
      skipUserScripts: true,
      onNewRangeIterator: async (iterator) => {
        const currentIteratorGeneration = ++iteratorGeneration;
        state.latestIteratorByTopic.set(request.topic, currentIteratorGeneration);
        let generation: number | undefined;
        try {
          generation = await args.generation;
          if (!isCurrentRangeIterator(state, request.topic, currentIteratorGeneration)) {
            return;
          }
          await args.onIteratorStart(request.topic, generation);
          if (!isCurrentRangeIterator(state, request.topic, currentIteratorGeneration)) {
            return;
          }

          for await (const batch of iterator) {
            if (!isCurrentRangeIterator(state, request.topic, currentIteratorGeneration)) {
              return;
            }
            if (batch.length === 0) {
              await args.onRangeBatch(request.topic, batch, generation);
              continue;
            }
            for (let offset = 0; offset < batch.length; offset += MAX_RANGE_INGEST_BATCH_SIZE) {
              if (!isCurrentRangeIterator(state, request.topic, currentIteratorGeneration)) {
                return;
              }
              // Awaiting each bounded slice lets the Dataset worker control stream backpressure.
              await args.onRangeBatch(
                request.topic,
                batch.slice(offset, offset + MAX_RANGE_INGEST_BATCH_SIZE),
                generation,
              );
            }
          }
        } catch (error) {
          if (isCurrentRangeIterator(state, request.topic, currentIteratorGeneration)) {
            stop();
            if (generation == undefined) {
              args.onError?.(error);
            } else {
              await onAsyncFailure(error, generation);
            }
          }
        }
      },
    });
    if (subscription == undefined) {
      return undefined;
    }
    unsubscribe = subscription;
    return stop;
  } catch {
    // A synchronous range setup failure has the same compatibility semantics as unsupported.
    return undefined;
  }
}

function isCurrentRangeIterator(
  state: RangeSubscriptionState,
  topic: string,
  iteratorGeneration: number,
): boolean {
  return (
    !state.cancelled &&
    state.rangeTopics.has(topic) &&
    state.latestIteratorByTopic.get(topic) === iteratorGeneration
  );
}
