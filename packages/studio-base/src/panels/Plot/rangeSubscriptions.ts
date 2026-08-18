// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@foxglove/message-path";
import { stringifyMessagePath } from "@foxglove/studio-base/components/MessagePathSyntax/stringifyRosPath";
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
  /**
   * Identity of the history extracted from this topic (fields, series paths, timestamp methods,
   * x-axis participation). While the signature is unchanged an already-running range iterator can
   * keep its loaded history; a change requires replaying the topic.
   */
  signature: string;
}>;

export type PlotTopicSubscriptionPlan = Readonly<{
  /** Current-only subscription used while a range iterator supplies replay history. */
  subscription: SubscribePayload;
  /** Subscription to use when the range request is unsupported for this topic. */
  fallbackSubscription: SubscribePayload;
  rangeRequest?: PlotRangeRequestPlan;
}>;

export type RunningPlotRangeSubscriptions = Readonly<{
  /** Topics whose history was initially assigned to a range iterator. */
  rangeTopics: ReadonlySet<string>;
  /** Initial current subscriptions, including synchronous per-topic full-history fallbacks. */
  subscriptions: readonly SubscribePayload[];
  cancel: () => void;
}>;

export type PlotRangeSubscriptionUpdate = Readonly<{
  /** Topics currently owned by a live range iterator. */
  rangeTopics: ReadonlySet<string>;
  /** Current subscriptions for every planned topic, including per-topic fallbacks. */
  subscriptions: readonly SubscribePayload[];
}>;

type PlotRangeSubscriptionCallbacks = Readonly<{
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

export type CreatePlotRangeSubscriptionManagerArgs = Readonly<
  {
    /** False for live players and x-axis modes which do not use range history. */
    attemptRanges: boolean;
    subscribeMessageRange?: SubscribeMessageRange;
  } & PlotRangeSubscriptionCallbacks
>;

type StartPlotRangeSubscriptionsArgs = Readonly<
  {
    plans: readonly PlotTopicSubscriptionPlan[];
    /** False for live players and x-axis modes which do not use range history. */
    attemptRanges: boolean;
    subscribeMessageRange?: SubscribeMessageRange;
    /** Resolved after the Dataset builder has established ownership for this generation. */
    generation: Promise<number>;
  } & PlotRangeSubscriptionCallbacks
>;

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
  seriesKeys: string[];
  includesXAxis: boolean;
};

type TopicRun = {
  signature: string;
  mode: "range" | "fallback";
  stop?: () => void;
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

  const addPath = (
    value: string,
    options: { seriesIndex?: number; timestampMethod?: string; role?: "xAxis" },
  ): void => {
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
        seriesKeys: [],
        includesXAxis: false,
      };
      topics.set(subscription.topic, topicPlan);
    }

    for (const field of subscription.fields ?? []) {
      topicPlan.fields.add(field);
    }
    if (options.seriesIndex != undefined) {
      topicPlan.seriesIndices.push(options.seriesIndex);
    }
    // Same key formula as the coordinator's series keys: replayed history is extracted per
    // (timestamp method, filled path), so those are what a topic's history identity depends on.
    topicPlan.seriesKeys.push(
      options.role === "xAxis"
        ? `x:${stringifyMessagePath(resolved)}`
        : `${options.timestampMethod ?? ""}:${stringifyMessagePath(resolved)}`,
    );
    topicPlan.includesXAxis ||= options.role === "xAxis";
  };

  paths.forEach((path, index) => {
    if (!path.enabled || isReferenceLinePlotPathType(path)) {
      return;
    }
    addPath(path.value, { seriesIndex: index, timestampMethod: path.timestampMethod });
  });

  if (
    (xAxisMode === "custom" || xAxisMode === "currentCustom") &&
    xAxisPath != undefined &&
    ((xAxisPath as { enabled?: boolean }).enabled ?? true)
  ) {
    addPath(xAxisPath.value, { role: "xAxis" });
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
              signature: [
                [...fields].sort().join(","),
                [...topicPlan.seriesKeys].sort().join("|"),
                topicPlan.includesXAxis ? "x" : "",
              ].join(";"),
            },
          }
        : {}),
    };
  });
}

/**
 * Owns the per-topic range iterators for one history source (player + start time + builder).
 * `update` reconciles against a new subscription plan: topics whose history signature is unchanged
 * keep their running iterator and loaded history, only added/changed topics start (and changed or
 * removed topics stop). Per-topic fallback decisions survive unrelated plan updates.
 */
export class PlotRangeSubscriptionManager {
  #args: CreatePlotRangeSubscriptionManagerArgs;
  #plans: readonly PlotTopicSubscriptionPlan[] = [];
  #runs = new Map<string, TopicRun>();
  #cancelled = false;
  #fallbackQueue: Promise<void> = Promise.resolve();
  #latestIteratorByTopic = new Map<string, number>();
  // Iterator ids must be unique across topic restarts, not just within one subscription, so a
  // replaced iterator can never mistake the replacement's id for its own.
  #nextIteratorId = 1;
  #rangeTopics = new Set<string>();

  public constructor(args: CreatePlotRangeSubscriptionManagerArgs) {
    this.#args = args;
  }

  public update(
    plans: readonly PlotTopicSubscriptionPlan[],
    generation: Promise<number>,
  ): PlotRangeSubscriptionUpdate {
    if (this.#cancelled) {
      return { rangeTopics: new Set(), subscriptions: [] };
    }
    this.#plans = plans;

    const requestsByTopic = new Map<string, PlotRangeRequestPlan>();
    if (this.#args.attemptRanges && this.#args.subscribeMessageRange != undefined) {
      for (const plan of plans) {
        if (plan.rangeRequest != undefined) {
          requestsByTopic.set(plan.rangeRequest.topic, plan.rangeRequest);
        }
      }
    }

    for (const [topic, run] of [...this.#runs]) {
      if (requestsByTopic.get(topic)?.signature === run.signature) {
        continue;
      }
      // Removing the run before stopping makes any in-flight batch of the old iterator stale.
      this.#runs.delete(topic);
      this.#rangeTopics.delete(topic);
      this.#latestIteratorByTopic.delete(topic);
      try {
        run.stop?.();
      } catch {
        // Continue reconciling the other topic ranges.
      }
    }

    const subscribeMessageRange = this.#args.subscribeMessageRange;
    if (subscribeMessageRange != undefined) {
      for (const request of requestsByTopic.values()) {
        if (this.#runs.has(request.topic)) {
          continue;
        }
        const run: TopicRun = { signature: request.signature, mode: "fallback" };
        this.#runs.set(request.topic, run);
        const stop = this.#tryStartRangeSubscription(
          subscribeMessageRange,
          request,
          generation,
          run,
        );
        if (stop != undefined) {
          run.mode = "range";
          run.stop = stop;
          this.#rangeTopics.add(request.topic);
        }
      }
    }

    return {
      rangeTopics: new Set(this.#rangeTopics),
      subscriptions: this.#currentSubscriptions(),
    };
  }

  public cancel(): void {
    if (this.#cancelled) {
      return;
    }
    this.#cancelled = true;
    this.#latestIteratorByTopic.clear();
    this.#rangeTopics.clear();
    const runs = [...this.#runs.values()];
    this.#runs.clear();
    for (const run of runs) {
      try {
        run.stop?.();
      } catch {
        // Continue cancelling the other topic ranges during cleanup.
      }
    }
  }

  #currentSubscriptions(): SubscribePayload[] {
    return this.#plans.map((plan) => {
      const request = plan.rangeRequest;
      if (!this.#args.attemptRanges || request == undefined) {
        return plan.subscription;
      }
      const run = this.#runs.get(request.topic);
      return run?.mode === "range" ? plan.subscription : plan.fallbackSubscription;
    });
  }

  #isCurrentRangeIterator(topic: string, run: TopicRun, iteratorId: number): boolean {
    return (
      !this.#cancelled &&
      this.#runs.get(topic) === run &&
      this.#rangeTopics.has(topic) &&
      this.#latestIteratorByTopic.get(topic) === iteratorId
    );
  }

  /**
   * Starts the range iterator synchronously so an unsupported topic can fall back independently.
   * Iterator consumption is backpressured by `onRangeBatch`; stopping also makes already-resolved
   * iterator batches stale before asking the Player to unsubscribe.
   */
  #tryStartRangeSubscription(
    subscribeMessageRange: SubscribeMessageRange,
    request: PlotRangeRequestPlan,
    generationPromise: Promise<number>,
    run: TopicRun,
  ): (() => void) | undefined {
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
          const iteratorId = this.#nextIteratorId++;
          this.#latestIteratorByTopic.set(request.topic, iteratorId);
          let generation: number | undefined;
          try {
            generation = await generationPromise;
            if (!this.#isCurrentRangeIterator(request.topic, run, iteratorId)) {
              return;
            }
            await this.#args.onIteratorStart(request.topic, generation);
            if (!this.#isCurrentRangeIterator(request.topic, run, iteratorId)) {
              return;
            }

            for await (const batch of iterator) {
              if (!this.#isCurrentRangeIterator(request.topic, run, iteratorId)) {
                return;
              }
              if (batch.length === 0) {
                await this.#args.onRangeBatch(request.topic, batch, generation);
                continue;
              }
              for (let offset = 0; offset < batch.length; offset += MAX_RANGE_INGEST_BATCH_SIZE) {
                if (!this.#isCurrentRangeIterator(request.topic, run, iteratorId)) {
                  return;
                }
                // Awaiting each bounded slice lets the Dataset worker control stream backpressure.
                await this.#args.onRangeBatch(
                  request.topic,
                  batch.slice(offset, offset + MAX_RANGE_INGEST_BATCH_SIZE),
                  generation,
                );
              }
            }
          } catch (error) {
            if (this.#isCurrentRangeIterator(request.topic, run, iteratorId)) {
              stop();
              if (generation == undefined) {
                this.#args.onError?.(error);
              } else {
                await this.#handleAsyncFailure(request.topic, run, error, generation);
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

  async #handleAsyncFailure(
    topic: string,
    run: TopicRun,
    error: unknown,
    generation: number,
  ): Promise<void> {
    run.mode = "fallback";
    this.#rangeTopics.delete(topic);
    this.#latestIteratorByTopic.delete(topic);

    // Player iterators may fail concurrently. Serialize commits so a slower earlier fallback
    // cannot finish after a later fallback and restore that topic's stale partial subscription.
    const fallbackOperation = this.#fallbackQueue.then(async () => {
      if (this.#cancelled || this.#runs.get(topic) !== run) {
        // A later update replaced or removed this topic; its subscriptions were recomputed there.
        return;
      }
      let fallbackEstablished = false;
      try {
        fallbackEstablished =
          (await this.#args.onTopicFallback?.({
            topic,
            generation,
            rangeTopics: new Set(this.#rangeTopics),
            subscriptions: this.#currentSubscriptions(),
          })) === true;
      } catch (fallbackError) {
        this.#args.onError?.(fallbackError);
      }
      if (!fallbackEstablished) {
        this.#args.onError?.(error);
      }
    });
    this.#fallbackQueue = fallbackOperation.catch(() => undefined);
    await fallbackOperation;
  }
}

/**
 * One-shot convenience over {@link PlotRangeSubscriptionManager} for callers whose plans never
 * change during the manager's lifetime.
 */
export function startPlotRangeSubscriptions(
  args: StartPlotRangeSubscriptionsArgs,
): RunningPlotRangeSubscriptions {
  const manager = new PlotRangeSubscriptionManager({
    attemptRanges: args.attemptRanges,
    subscribeMessageRange: args.subscribeMessageRange,
    onIteratorStart: args.onIteratorStart,
    onRangeBatch: args.onRangeBatch,
    onTopicFallback: args.onTopicFallback,
    onError: args.onError,
  });
  const { rangeTopics, subscriptions } = manager.update(args.plans, args.generation);
  return {
    rangeTopics,
    subscriptions,
    cancel: () => {
      manager.cancel();
    },
  };
}
