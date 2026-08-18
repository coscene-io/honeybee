// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePath, MessagePathPart, parseMessagePath } from "@foxglove/message-path";
import { Immutable } from "@foxglove/studio";
import { fillInGlobalVariablesInPath } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import type { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import type { SubscribeMessageRange, SubscribePayload } from "@foxglove/studio-base/players/types";

import type { StateTransitionPath } from "./types";

export type StateTransitionsTopicPlan = Readonly<{
  topic: string;
  currentSubscription: SubscribePayload;
  fallbackSubscription: SubscribePayload;
  rangePayload: Readonly<Pick<SubscribePayload, "fields">>;
}>;

export type RunningStateTransitionsRangeSubscriptions = Readonly<{
  /** Topics whose replay history was initially assigned to a range iterator. */
  rangeTopics: ReadonlySet<string>;
  /** Initial current subscriptions, including synchronous per-topic full-history fallbacks. */
  subscriptions: readonly SubscribePayload[];
  cancel: () => void;
}>;

type StartStateTransitionsRangeSubscriptionsArgs = Readonly<{
  plans: readonly StateTransitionsTopicPlan[];
  attemptRanges: boolean;
  subscribeMessageRange?: SubscribeMessageRange;
  /** Resolved after the coordinator has reset storage and established the range generation. */
  generation: Promise<number>;
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

type RangeSubscriptionState = {
  cancelled: boolean;
  fallbackQueue: Promise<void>;
  latestIteratorByTopic: Map<string, number>;
  rangeTopics: Set<string>;
};

type MutableTopicPlan = {
  topic: string;
  fields: Set<string>;
};

type NamePart = Immutable<Extract<MessagePathPart, { type: "name" }>>;

const MAX_RANGE_INGEST_BATCH_SIZE = 10_000;

function isNamePart(part: Immutable<MessagePathPart>): part is NamePart {
  return part.type === "name";
}

function requiredFields(
  path: Immutable<MessagePath>,
  options: { includeHeader: boolean },
): string[] | undefined {
  const firstField = path.messagePath.find(isNamePart);
  if (firstField == undefined || firstField.name.length === 0) {
    return undefined;
  }

  const fields = new Set<string>();
  if (options.includeHeader) {
    fields.add("header");
  }
  fields.add(firstField.name);
  for (const part of path.messagePath) {
    if (part.type !== "filter") {
      break;
    }
    const field = part.path[0];
    if (field != undefined) {
      fields.add(field);
    }
  }
  return [...fields];
}

/** Group enabled state paths by topic and union all fields required to decode each range batch. */
export function planStateTransitionsSubscriptions(args: {
  paths: readonly Readonly<StateTransitionPath>[];
  globalVariables: GlobalVariables;
}): readonly StateTransitionsTopicPlan[] {
  const topics = new Map<string, MutableTopicPlan>();
  for (const path of args.paths) {
    if (path.enabled === false) {
      continue;
    }
    const parsed = parseMessagePath(path.value);
    if (parsed == undefined) {
      continue;
    }
    const resolved = fillInGlobalVariablesInPath(parsed, args.globalVariables);
    const fields = requiredFields(resolved, {
      includeHeader: path.timestampMethod === "headerStamp",
    });
    if (fields == undefined) {
      continue;
    }

    let topicPlan = topics.get(resolved.topicName);
    if (topicPlan == undefined) {
      topicPlan = { topic: resolved.topicName, fields: new Set<string>() };
      topics.set(resolved.topicName, topicPlan);
    }
    for (const field of fields) {
      topicPlan.fields.add(field);
    }
  }

  return [...topics.values()].map((topicPlan) => {
    const fields = [...topicPlan.fields];
    return {
      topic: topicPlan.topic,
      currentSubscription: {
        topic: topicPlan.topic,
        fields: [...fields],
        preloadType: "partial",
      },
      fallbackSubscription: {
        topic: topicPlan.topic,
        fields: [...fields],
        preloadType: "full",
      },
      rangePayload: { fields: [...fields] },
    };
  });
}

/**
 * Starts per-topic range subscriptions synchronously so unsupported Players can fall back without
 * failing the whole panel. Iterator consumption is latest-wins and backpressured through bounded
 * batches. Every replacement iterator resets only its topic before replaying from the beginning.
 * An asynchronously failed iterator releases only its topic through `onTopicFallback`.
 */
export function startStateTransitionsRangeSubscriptions(
  args: StartStateTransitionsRangeSubscriptionsArgs,
): RunningStateTransitionsRangeSubscriptions {
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
    const subscribeMessageRange = args.subscribeMessageRange;
    if (!args.attemptRanges || subscribeMessageRange == undefined) {
      subscriptions.push(args.attemptRanges ? plan.fallbackSubscription : plan.currentSubscription);
      continue;
    }

    const unsubscribe = tryStartRangeSubscription(
      args,
      subscribeMessageRange,
      plan,
      state,
      async (error, generation) => {
        state.rangeTopics.delete(plan.topic);
        state.latestIteratorByTopic.delete(plan.topic);
        subscriptions[planIndex] = plan.fallbackSubscription;

        // Player iterators may fail concurrently. Serialize commits so a slower earlier fallback
        // cannot finish after a later fallback and restore that topic's stale partial subscription.
        const fallbackOperation = state.fallbackQueue.then(async () => {
          let fallbackEstablished = false;
          try {
            fallbackEstablished =
              (await args.onTopicFallback?.({
                topic: plan.topic,
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
    rangeTopics.add(plan.topic);
    subscriptions.push(plan.currentSubscription);
    unsubscribes.push(unsubscribe);
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
          // Continue cancelling other topic ranges when one Player cleanup fails.
        }
      }
    },
  };
}

function tryStartRangeSubscription(
  args: StartStateTransitionsRangeSubscriptionsArgs,
  subscribeMessageRange: SubscribeMessageRange,
  plan: StateTransitionsTopicPlan,
  state: RangeSubscriptionState,
  onAsyncFailure: (error: unknown, generation: number) => Promise<void>,
): (() => void) | undefined {
  let iteratorId = 0;
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
      topic: plan.topic,
      payload: plan.rangePayload,
      receiveLiveData: false,
      skipUserScripts: true,
      onNewRangeIterator: async (iterator) => {
        const currentIteratorId = ++iteratorId;
        state.latestIteratorByTopic.set(plan.topic, currentIteratorId);
        let generation: number | undefined;
        try {
          generation = await args.generation;
          if (!isCurrentRangeIterator(state, plan.topic, currentIteratorId)) {
            return;
          }

          await args.onIteratorStart(plan.topic, generation);
          if (!isCurrentRangeIterator(state, plan.topic, currentIteratorId)) {
            return;
          }

          for await (const batch of iterator) {
            if (!isCurrentRangeIterator(state, plan.topic, currentIteratorId)) {
              return;
            }
            for (let offset = 0; offset < batch.length; offset += MAX_RANGE_INGEST_BATCH_SIZE) {
              if (!isCurrentRangeIterator(state, plan.topic, currentIteratorId)) {
                return;
              }
              await args.onRangeBatch(
                plan.topic,
                batch.slice(offset, offset + MAX_RANGE_INGEST_BATCH_SIZE),
                generation,
              );
            }
          }
        } catch (error) {
          if (isCurrentRangeIterator(state, plan.topic, currentIteratorId)) {
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
    // Synchronous setup failures mean this Player/topic does not support range subscriptions.
    return undefined;
  }
}

function isCurrentRangeIterator(
  state: RangeSubscriptionState,
  topic: string,
  iteratorId: number,
): boolean {
  return (
    !state.cancelled &&
    state.rangeTopics.has(topic) &&
    state.latestIteratorByTopic.get(topic) === iteratorId
  );
}
