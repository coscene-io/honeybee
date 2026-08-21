// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePath, MessagePathPart, parseMessagePath } from "@foxglove/message-path";
import { Immutable } from "@foxglove/studio";
import { stringifyMessagePath } from "@foxglove/studio-base/components/MessagePathSyntax/stringifyRosPath";
import { fillInGlobalVariablesInPath } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import type { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import type { SubscribeMessageRange, SubscribePayload } from "@foxglove/studio-base/players/types";

import type { StateTransitionPath } from "./types";

export type StateTransitionsTopicPlan = Readonly<{
  topic: string;
  currentSubscription: SubscribePayload;
  fallbackSubscription: SubscribePayload;
  rangePayload: Readonly<Pick<SubscribePayload, "fields">>;
  /** Fields and decoded series identities whose history is stored for this topic. */
  signature: string;
}>;

export type RunningStateTransitionsRangeSubscriptions = Readonly<{
  /** Topics whose replay history was initially assigned to a range iterator. */
  rangeTopics: ReadonlySet<string>;
  /** Initial current subscriptions, including synchronous per-topic full-history fallbacks. */
  subscriptions: readonly SubscribePayload[];
  cancel: () => void;
}>;

export type StateTransitionsRangeSubscriptionUpdate = Readonly<{
  rangeTopics: ReadonlySet<string>;
  subscriptions: readonly SubscribePayload[];
}>;

type StateTransitionsRangeSubscriptionCallbacks = Readonly<{
  onIteratorStart: (topic: string, generation: number) => Promise<void>;
  onRangeBatch: (
    topic: string,
    batch: readonly import("@foxglove/studio").MessageEvent[],
    generation: number,
  ) => Promise<void>;
  onTopicFallback?: (args: {
    topic: string;
    generation: number;
    rangeTopics: ReadonlySet<string>;
    subscriptions: readonly SubscribePayload[];
  }) => Promise<boolean>;
  onError?: (error: unknown) => void;
}>;

export type CreateStateTransitionsRangeSubscriptionManagerArgs = Readonly<
  {
    attemptRanges: boolean;
    subscribeMessageRange?: SubscribeMessageRange;
  } & StateTransitionsRangeSubscriptionCallbacks
>;

type StartStateTransitionsRangeSubscriptionsArgs = Readonly<
  {
    plans: readonly StateTransitionsTopicPlan[];
    attemptRanges: boolean;
    subscribeMessageRange?: SubscribeMessageRange;
    /** Resolved after the coordinator has reset storage and established the range generation. */
    generation: Promise<number>;
  } & StateTransitionsRangeSubscriptionCallbacks
>;

type MutableTopicPlan = {
  topic: string;
  fields: Set<string>;
  seriesKeys: string[];
};

type TopicRun = {
  signature: string;
  mode: "range" | "fallback";
  stop?: () => void;
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
      topicPlan = { topic: resolved.topicName, fields: new Set<string>(), seriesKeys: [] };
      topics.set(resolved.topicName, topicPlan);
    }
    for (const field of fields) {
      topicPlan.fields.add(field);
    }
    topicPlan.seriesKeys.push(`${path.timestampMethod}:${stringifyMessagePath(resolved)}`);
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
      signature: [[...fields].sort().join(","), [...topicPlan.seriesKeys].sort().join("|")].join(
        ";",
      ),
    };
  });
}

/** Reconciles per-topic range iterators while retaining unchanged topic history. */
export class StateTransitionsRangeSubscriptionManager {
  #args: CreateStateTransitionsRangeSubscriptionManagerArgs;
  #plans: readonly StateTransitionsTopicPlan[] = [];
  #runs = new Map<string, TopicRun>();
  #cancelled = false;
  #fallbackQueue: Promise<void> = Promise.resolve();
  #latestIteratorByTopic = new Map<string, number>();
  #nextIteratorId = 1;
  #rangeTopics = new Set<string>();

  public constructor(args: CreateStateTransitionsRangeSubscriptionManagerArgs) {
    this.#args = args;
  }

  public update(
    plans: readonly StateTransitionsTopicPlan[],
    generation: Promise<number>,
  ): StateTransitionsRangeSubscriptionUpdate {
    if (this.#cancelled) {
      return { rangeTopics: new Set(), subscriptions: [] };
    }
    this.#plans = plans;
    const plansByTopic = new Map<string, StateTransitionsTopicPlan>();
    if (this.#args.attemptRanges && this.#args.subscribeMessageRange != undefined) {
      for (const plan of plans) {
        plansByTopic.set(plan.topic, plan);
      }
    }

    for (const [topic, run] of [...this.#runs]) {
      if (plansByTopic.get(topic)?.signature === run.signature) {
        continue;
      }
      this.#runs.delete(topic);
      this.#rangeTopics.delete(topic);
      this.#latestIteratorByTopic.delete(topic);
      try {
        run.stop?.();
      } catch {
        // Continue reconciling the remaining topics.
      }
    }

    const subscribeMessageRange = this.#args.subscribeMessageRange;
    if (subscribeMessageRange != undefined) {
      for (const plan of plansByTopic.values()) {
        if (this.#runs.has(plan.topic)) {
          continue;
        }
        const run: TopicRun = { signature: plan.signature, mode: "fallback" };
        this.#runs.set(plan.topic, run);
        const stop = this.#tryStartRangeSubscription(subscribeMessageRange, plan, generation, run);
        if (stop != undefined) {
          run.mode = "range";
          run.stop = stop;
          this.#rangeTopics.add(plan.topic);
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
        // Continue cancelling other topic ranges during cleanup.
      }
    }
  }

  public getSubscriptions(): readonly SubscribePayload[] {
    return this.#currentSubscriptions();
  }

  #currentSubscriptions(): SubscribePayload[] {
    return this.#plans.map((plan) => {
      if (!this.#args.attemptRanges) {
        return plan.currentSubscription;
      }
      return this.#runs.get(plan.topic)?.mode === "range"
        ? plan.currentSubscription
        : plan.fallbackSubscription;
    });
  }

  #isCurrentIterator(topic: string, run: TopicRun, iteratorId: number): boolean {
    return (
      !this.#cancelled &&
      this.#runs.get(topic) === run &&
      this.#rangeTopics.has(topic) &&
      this.#latestIteratorByTopic.get(topic) === iteratorId
    );
  }

  #tryStartRangeSubscription(
    subscribeMessageRange: SubscribeMessageRange,
    plan: StateTransitionsTopicPlan,
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
        // A failed Player cleanup must not prevent fallback.
      }
    };
    try {
      const subscription = subscribeMessageRange({
        topic: plan.topic,
        payload: plan.rangePayload,
        receiveLiveData: false,
        skipUserScripts: true,
        onNewRangeIterator: async (iterator) => {
          if (this.#cancelled || this.#runs.get(plan.topic) !== run) {
            return;
          }
          const iteratorId = this.#nextIteratorId++;
          this.#latestIteratorByTopic.set(plan.topic, iteratorId);
          let generation: number | undefined;
          try {
            generation = await generationPromise;
            if (!this.#isCurrentIterator(plan.topic, run, iteratorId)) {
              return;
            }
            await this.#args.onIteratorStart(plan.topic, generation);
            if (!this.#isCurrentIterator(plan.topic, run, iteratorId)) {
              return;
            }
            for await (const batch of iterator) {
              if (!this.#isCurrentIterator(plan.topic, run, iteratorId)) {
                return;
              }
              if (batch.length === 0) {
                await this.#args.onRangeBatch(plan.topic, batch, generation);
                continue;
              }
              for (let offset = 0; offset < batch.length; offset += MAX_RANGE_INGEST_BATCH_SIZE) {
                if (!this.#isCurrentIterator(plan.topic, run, iteratorId)) {
                  return;
                }
                await this.#args.onRangeBatch(
                  plan.topic,
                  batch.slice(offset, offset + MAX_RANGE_INGEST_BATCH_SIZE),
                  generation,
                );
              }
            }
          } catch (error) {
            if (this.#isCurrentIterator(plan.topic, run, iteratorId)) {
              stop();
              if (generation == undefined) {
                this.#args.onError?.(error);
              } else {
                await this.#handleAsyncFailure(plan.topic, run, error, generation);
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
    const fallbackOperation = this.#fallbackQueue.then(async () => {
      if (this.#cancelled || this.#runs.get(topic) !== run) {
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

/** One-shot convenience for callers whose plans do not change. */
export function startStateTransitionsRangeSubscriptions(
  args: StartStateTransitionsRangeSubscriptionsArgs,
): RunningStateTransitionsRangeSubscriptions {
  const manager = new StateTransitionsRangeSubscriptionManager({
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
