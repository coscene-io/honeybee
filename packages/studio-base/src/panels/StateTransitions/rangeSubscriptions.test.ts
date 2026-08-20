// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessageEvent } from "@foxglove/studio";
import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import {
  planStateTransitionsSubscriptions,
  startStateTransitionsRangeSubscriptions,
  StateTransitionsRangeSubscriptionManager,
} from "./rangeSubscriptions";
import type { StateTransitionPath } from "./types";

function path(value: string, options: Partial<StateTransitionPath> = {}): StateTransitionPath {
  return {
    enabled: true,
    timestampMethod: "receiveTime",
    value,
    ...options,
  };
}

describe("planStateTransitionsSubscriptions", () => {
  it("groups topics and unions value, filter, and header fields in stable order", () => {
    expect(
      planStateTransitionsSubscriptions({
        paths: [
          path("/vehicle{source==1}.mode"),
          path("/other.state"),
          path("/vehicle.status", { timestampMethod: "headerStamp" }),
        ],
        globalVariables: {},
      }),
    ).toEqual([
      {
        topic: "/vehicle",
        currentSubscription: {
          topic: "/vehicle",
          fields: ["mode", "source", "header", "status"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/vehicle",
          fields: ["mode", "source", "header", "status"],
          preloadType: "full",
        },
        rangePayload: { fields: ["mode", "source", "header", "status"] },
        signature:
          "header,mode,source,status;headerStamp:/vehicle.status|receiveTime:/vehicle{source==1}.mode",
      },
      {
        topic: "/other",
        currentSubscription: {
          topic: "/other",
          fields: ["state"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/other",
          fields: ["state"],
          preloadType: "full",
        },
        rangePayload: { fields: ["state"] },
        signature: "state;receiveTime:/other.state",
      },
    ]);
  });

  it("omits disabled, invalid, and property-less paths", () => {
    expect(
      planStateTransitionsSubscriptions({
        paths: [
          path("/disabled.value", { enabled: false }),
          path("not a path"),
          path("/topic-only"),
          path("/valid.value"),
        ],
        globalVariables: {},
      }).map((plan) => plan.topic),
    ).toEqual(["/valid"]);
  });

  it("resolves global variables and includes their filter fields", () => {
    expect(
      planStateTransitionsSubscriptions({
        paths: [path("/vehicles{id==$selected}.state")],
        globalVariables: { selected: 3 },
      })[0]?.rangePayload.fields,
    ).toEqual(["state", "id"]);
  });
});

type OnNewRangeIterator = Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"];

function message(id: number, topic = "/state"): MessageEvent {
  return {
    topic,
    schemaName: "test",
    receiveTime: { sec: id, nsec: 0 },
    message: { id },
    sizeInBytes: 1,
  };
}

function statePlan() {
  return planStateTransitionsSubscriptions({
    paths: [path("/state.value")],
    globalVariables: {},
  })[0]!;
}

function twoTopicPlans() {
  return planStateTransitionsSubscriptions({
    paths: [path("/state.value"), path("/other.value")],
    globalVariables: {},
  });
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("startStateTransitionsRangeSubscriptions", () => {
  it("falls back per topic when range setup throws synchronously", () => {
    const subscribeMessageRange: SubscribeMessageRange = () => {
      throw new Error("unsupported");
    };
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange,
      generation: Promise.resolve(1),
      onIteratorStart: async () => undefined,
      onRangeBatch: async () => undefined,
    });

    expect(running.rangeTopics).toEqual(new Set());
    expect(running.subscriptions).toEqual([statePlan().fallbackSubscription]);
  });

  it("requests finite history and backpressures bounded 10k slices", async () => {
    let onNewRangeIterator: OnNewRangeIterator | undefined;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((options) => {
      onNewRangeIterator = options.onNewRangeIterator;
      expect(options.receiveLiveData).toBe(false);
      expect(options.skipUserScripts).toBe(true);
      return () => undefined;
    });
    let releaseFirst!: () => void;
    const firstSliceBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sliceSizes: number[] = [];
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange,
      generation: Promise.resolve(3),
      onIteratorStart: async () => undefined,
      onRangeBatch: async (_topic, batch) => {
        sliceSizes.push(batch.length);
        if (sliceSizes.length === 1) {
          await firstSliceBlocked;
        }
      },
    });
    const batch = Array.from({ length: 25_001 }, (_, index) => message(index));
    const consume = onNewRangeIterator!(
      (async function* () {
        yield batch;
      })(),
    );

    await flushMicrotasks();
    expect(sliceSizes).toEqual([10_000]);
    releaseFirst();
    await consume;
    expect(sliceSizes).toEqual([10_000, 10_000, 5_001]);
    running.cancel();
  });

  it("resets replacement iterators and consumes only the latest replay", async () => {
    let onNewRangeIterator: OnNewRangeIterator | undefined;
    const subscribeMessageRange: SubscribeMessageRange = (options) => {
      onNewRangeIterator = options.onNewRangeIterator;
      return () => undefined;
    };
    let releaseOld!: () => void;
    const oldBlocked = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const starts: number[] = [];
    const batches: number[] = [];
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange,
      generation: Promise.resolve(5),
      onIteratorStart: async (_topic, generation) => {
        starts.push(generation);
      },
      onRangeBatch: async (_topic, batch) => {
        batches.push((batch[0]?.message as { id: number }).id);
      },
    });

    const oldConsume = onNewRangeIterator!(
      (async function* () {
        await oldBlocked;
        yield [message(1)];
      })(),
    );
    await flushMicrotasks();
    const newConsume = onNewRangeIterator!(
      (async function* () {
        yield [message(2)];
      })(),
    );
    await newConsume;
    releaseOld();
    await oldConsume;

    expect(starts).toEqual([5, 5]);
    expect(batches).toEqual([2]);
    running.cancel();
  });

  it("switches only the asynchronously failed topic to its full fallback", async () => {
    const plans = twoTopicPlans();
    const callbacks = new Map<string, OnNewRangeIterator>();
    const unsubscribes = new Map([
      ["/state", jest.fn()],
      ["/other", jest.fn()],
    ]);
    const batches: string[] = [];
    const onError = jest.fn();
    const onTopicFallback = jest.fn(async () => true);
    const running = startStateTransitionsRangeSubscriptions({
      plans,
      attemptRanges: true,
      subscribeMessageRange: (options) => {
        callbacks.set(options.topic, options.onNewRangeIterator);
        return unsubscribes.get(options.topic)!;
      },
      generation: Promise.resolve(12),
      onIteratorStart: async () => undefined,
      onRangeBatch: async (topic) => {
        batches.push(topic);
      },
      onTopicFallback,
      onError,
    });

    await callbacks.get("/state")!(
      (async function* () {
        await Promise.reject(new Error("range read failed"));
        yield [];
      })(),
    );
    // The surviving topic keeps streaming after the other topic's fallback committed.
    await callbacks.get("/other")!(
      (async function* () {
        yield [message(1, "/other")];
      })(),
    );

    expect(onTopicFallback).toHaveBeenCalledWith({
      topic: "/state",
      generation: 12,
      rangeTopics: new Set(["/other"]),
      subscriptions: [plans[0]!.fallbackSubscription, plans[1]!.currentSubscription],
    });
    expect(batches).toEqual(["/other"]);
    // Dynamic fallback state is sent through the callback; the returned plan remains a snapshot
    // of synchronous setup.
    expect(running.rangeTopics).toEqual(new Set(["/state", "/other"]));
    expect(running.subscriptions).toEqual(plans.map((plan) => plan.currentSubscription));
    expect(unsubscribes.get("/state")).toHaveBeenCalledTimes(1);
    expect(unsubscribes.get("/other")).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    running.cancel();
  });

  it("serializes concurrent fallback commits so inverse completion cannot restore partial", async () => {
    const plans = twoTopicPlans();
    const callbacks = new Map<string, OnNewRangeIterator>();
    let releaseFirstFallback!: () => void;
    let firstFallbackStarted!: () => void;
    const firstFallbackPending = new Promise<void>((resolve) => {
      releaseFirstFallback = resolve;
    });
    const firstFallbackStartedPromise = new Promise<void>((resolve) => {
      firstFallbackStarted = resolve;
    });
    const commits: { topic: string; preloadTypes: (string | undefined)[] }[] = [];
    const running = startStateTransitionsRangeSubscriptions({
      plans,
      attemptRanges: true,
      subscribeMessageRange: (options) => {
        callbacks.set(options.topic, options.onNewRangeIterator);
        return () => undefined;
      },
      generation: Promise.resolve(21),
      onIteratorStart: async () => undefined,
      onRangeBatch: async () => undefined,
      onTopicFallback: async ({ subscriptions, topic }) => {
        if (topic === "/state") {
          firstFallbackStarted();
          await firstFallbackPending;
        }
        commits.push({
          topic,
          preloadTypes: subscriptions.map((subscription) => subscription.preloadType),
        });
        return true;
      },
    });

    const firstFailure = callbacks.get("/state")!(
      (async function* () {
        await Promise.reject(new Error("slow fallback"));
        yield [];
      })(),
    );
    await firstFallbackStartedPromise;
    const secondFailure = callbacks.get("/other")!(
      (async function* () {
        await Promise.reject(new Error("fast fallback"));
        yield [];
      })(),
    );
    await flushMicrotasks();

    expect(commits).toEqual([]);
    releaseFirstFallback();
    await Promise.all([firstFailure, secondFailure]);
    expect(commits).toEqual([
      { topic: "/state", preloadTypes: ["full", "partial"] },
      { topic: "/other", preloadTypes: ["full", "full"] },
    ]);
    running.cancel();
  });

  it("surfaces the original error when the fallback cannot be established", async () => {
    const error = new Error("range read failed");
    const onError = jest.fn();
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            await Promise.reject(error);
            yield [];
          })(),
        );
        return () => undefined;
      },
      generation: Promise.resolve(1),
      onIteratorStart: async () => undefined,
      onRangeBatch: async () => undefined,
      onTopicFallback: async () => false,
      onError,
    });

    await flushMicrotasks();
    expect(onError).toHaveBeenCalledWith(error);
    running.cancel();
  });
});

describe("StateTransitionsRangeSubscriptionManager", () => {
  it("keeps unchanged topic iterators while adding a sibling topic", () => {
    const plans = twoTopicPlans();
    const unsubscribes = new Map([
      ["/state", jest.fn()],
      ["/other", jest.fn()],
    ]);
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((options) => unsubscribes.get(options.topic)!);
    const manager = new StateTransitionsRangeSubscriptionManager({
      attemptRanges: true,
      subscribeMessageRange,
      onIteratorStart: async () => undefined,
      onRangeBatch: async () => undefined,
    });

    manager.update([plans[0]!], Promise.resolve(1));
    const updated = manager.update(plans, Promise.resolve(1));

    expect(subscribeMessageRange.mock.calls.map(([options]) => options.topic)).toEqual([
      "/state",
      "/other",
    ]);
    expect(unsubscribes.get("/state")).not.toHaveBeenCalled();
    expect(updated.rangeTopics).toEqual(new Set(["/state", "/other"]));
    manager.cancel();
  });

  it("exposes reconciled subscriptions to a fallback that finishes after plans change", async () => {
    const plans = twoTopicPlans();
    let onNewRangeIterator: OnNewRangeIterator | undefined;
    let fallbackStarted!: () => void;
    let releaseFallback!: () => void;
    const started = new Promise<void>((resolve) => {
      fallbackStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseFallback = resolve;
    });
    let committedSubscriptions: readonly { topic: string; preloadType?: string }[] = [];
    const manager = new StateTransitionsRangeSubscriptionManager({
      attemptRanges: true,
      subscribeMessageRange: (options) => {
        if (options.topic === "/state") {
          onNewRangeIterator = options.onNewRangeIterator;
        }
        return () => undefined;
      },
      onIteratorStart: async () => undefined,
      onRangeBatch: async () => undefined,
      onTopicFallback: async () => {
        fallbackStarted();
        await blocked;
        committedSubscriptions = manager.getSubscriptions();
        return true;
      },
    });

    manager.update([plans[0]!], Promise.resolve(1));
    const failure = onNewRangeIterator!(
      (async function* () {
        await Promise.reject(new Error("range read failed"));
        yield [];
      })(),
    );
    await started;
    manager.update(plans, Promise.resolve(1));
    releaseFallback();
    await failure;

    expect(committedSubscriptions).toEqual([
      plans[0]!.fallbackSubscription,
      plans[1]!.currentSubscription,
    ]);
    manager.cancel();
  });
});
