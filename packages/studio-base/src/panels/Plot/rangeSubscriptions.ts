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
}>;

export type PlotTopicSubscriptionPlan = Readonly<{
  /** Subscription used while the range iterator supplies timestamp history. */
  subscription: SubscribePayload;
  /** Subscription to use when the range request is unsupported for this topic. */
  fallbackSubscription: SubscribePayload;
  rangeRequest?: PlotRangeRequestPlan;
}>;

type RangeSubscriptionState = {
  cancelled: boolean;
  latestIteratorByTopic: Map<string, number>;
  rangeTopics: Set<string>;
};

export type RunningPlotRangeSubscriptions = Readonly<{
  /** Topics whose history is owned by a range iterator instead of message-cache blocks. */
  rangeTopics: ReadonlySet<string>;
  /** Current-frame subscriptions, with per-topic full-history fallbacks where ranges failed. */
  subscriptions: readonly SubscribePayload[];
  cancel: () => void;
}>;

type StartPlotRangeSubscriptionsArgs = Readonly<{
  plans: readonly PlotTopicSubscriptionPlan[];
  /** False for live players and modes which do not use timestamp range history. */
  attemptRanges: boolean;
  subscribeMessageRange?: SubscribeMessageRange;
  generation: number;
  onRangeBatch: (
    topic: string,
    batch: readonly import("@foxglove/studio").MessageEvent[],
    generation: number,
  ) => Promise<void>;
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
};

const MAX_RANGE_INGEST_BATCH_SIZE = 10_000;

/**
 * Builds one subscription plan per topic, preserving the order in which topics first appear.
 * Timestamp history uses range requests; all other x-axis modes keep their existing preload mode.
 */
export function planPlotSubscriptions(
  args: PlanPlotSubscriptionsArgs,
): readonly PlotTopicSubscriptionPlan[] {
  const { paths, globalVariables, xAxisMode, xAxisPath } = args;
  const topics = new Map<string, MutableTopicPlan>();

  const addPath = (value: string, seriesIndex?: number): void => {
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
      };
      topics.set(subscription.topic, topicPlan);
    }

    for (const field of subscription.fields ?? []) {
      topicPlan.fields.add(field);
    }
    if (seriesIndex != undefined) {
      topicPlan.seriesIndices.push(seriesIndex);
    }
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
    addPath(xAxisPath.value);
  }

  const rangeEnabled = xAxisMode === "timestamp";
  const primaryPreloadType =
    rangeEnabled ||
    xAxisMode === "index" ||
    xAxisMode === "currentCustom" ||
    xAxisMode === "partialTimestamp"
      ? "partial"
      : "full";

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
    latestIteratorByTopic: new Map<string, number>(),
    rangeTopics,
  };

  for (const plan of args.plans) {
    const request = plan.rangeRequest;
    if (!args.attemptRanges || request == undefined || args.subscribeMessageRange == undefined) {
      subscriptions.push(
        args.attemptRanges && request != undefined ? plan.fallbackSubscription : plan.subscription,
      );
      continue;
    }

    const unsubscribe = tryStartRangeSubscription(args, request, state);

    if (unsubscribe == undefined) {
      subscriptions.push(plan.fallbackSubscription);
      continue;
    }

    rangeTopics.add(request.topic);
    unsubscribes.push(unsubscribe);
    subscriptions.push(plan.subscription);
  }

  return {
    rangeTopics,
    subscriptions,
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
  args: StartPlotRangeSubscriptionsArgs & { subscribeMessageRange: SubscribeMessageRange },
  request: PlotRangeRequestPlan,
  state: RangeSubscriptionState,
): (() => void) | undefined {
  let iteratorGeneration = 0;
  try {
    return args.subscribeMessageRange({
      topic: request.topic,
      payload: request.payload,
      receiveLiveData: false,
      skipUserScripts: true,
      onNewRangeIterator: async (iterator) => {
        const currentIteratorGeneration = ++iteratorGeneration;
        state.latestIteratorByTopic.set(request.topic, currentIteratorGeneration);
        try {
          for await (const batch of iterator) {
            if (
              state.cancelled ||
              !state.rangeTopics.has(request.topic) ||
              state.latestIteratorByTopic.get(request.topic) !== currentIteratorGeneration
            ) {
              return;
            }
            if (batch.length === 0) {
              await args.onRangeBatch(request.topic, batch, args.generation);
              continue;
            }
            for (let offset = 0; offset < batch.length; offset += MAX_RANGE_INGEST_BATCH_SIZE) {
              if (state.latestIteratorByTopic.get(request.topic) !== currentIteratorGeneration) {
                return;
              }
              // Awaiting each bounded slice lets the Dataset worker control stream backpressure.
              await args.onRangeBatch(
                request.topic,
                batch.slice(offset, offset + MAX_RANGE_INGEST_BATCH_SIZE),
                args.generation,
              );
            }
          }
        } catch (error) {
          if (!state.cancelled) {
            args.onError?.(error);
          }
        }
      },
    });
  } catch {
    // A synchronous range setup failure has the same compatibility semantics as unsupported.
    return undefined;
  }
}
