// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import type { BasePlotPath, PlotPath, PlotXAxisVal } from "./config";
import {
  planPlotSubscriptions,
  PlotRangeSubscriptionManager,
  startPlotRangeSubscriptions,
} from "./rangeSubscriptions";

function path(value: string, options: Partial<PlotPath> = {}): PlotPath {
  return {
    enabled: true,
    timestampMethod: "receiveTime",
    value,
    ...options,
  };
}

function plan(paths: PlotPath[], xAxisMode: PlotXAxisVal = "timestamp") {
  return planPlotSubscriptions({ paths, xAxisMode, globalVariables: {} });
}

type OnNewRangeIterator = Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"];

describe("planPlotSubscriptions", () => {
  it("groups timestamp series by topic and unions fields in stable order", () => {
    expect(
      plan([
        path("/beta.value"),
        path("/alpha{vehicle.id==1}.speed"),
        path("/beta{source==2}.temperature"),
        path("/alpha.position"),
      ]),
    ).toEqual([
      {
        subscription: {
          topic: "/beta",
          fields: ["header", "value", "temperature", "source"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/beta",
          fields: ["header", "value", "temperature", "source"],
          preloadType: "full",
        },
        rangeRequest: {
          topic: "/beta",
          payload: { fields: ["header", "value", "temperature", "source"] },
          seriesIndices: [0, 2],
          signature: expect.any(String),
        },
      },
      {
        subscription: {
          topic: "/alpha",
          fields: ["header", "speed", "vehicle", "position"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/alpha",
          fields: ["header", "speed", "vehicle", "position"],
          preloadType: "full",
        },
        rangeRequest: {
          topic: "/alpha",
          payload: { fields: ["header", "speed", "vehicle", "position"] },
          seriesIndices: [1, 3],
          signature: expect.any(String),
        },
      },
    ]);
  });

  it("omits disabled, reference, invalid, and property-less paths", () => {
    expect(
      plan([
        path("/disabled.value", { enabled: false }),
        path("42"),
        path("not a path"),
        path("/topic-only"),
        path("/valid.value"),
      ]),
    ).toEqual([
      {
        subscription: {
          topic: "/valid",
          fields: ["header", "value"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/valid",
          fields: ["header", "value"],
          preloadType: "full",
        },
        rangeRequest: {
          topic: "/valid",
          payload: { fields: ["header", "value"] },
          seriesIndices: [4],
          signature: expect.any(String),
        },
      },
    ]);
  });

  it("accepts global variables in filters and retains their required fields", () => {
    expect(
      planPlotSubscriptions({
        paths: [path("/vehicles{id==$selected}.speed")],
        xAxisMode: "timestamp",
        globalVariables: { selected: 7 },
      })[0]?.rangeRequest,
    ).toEqual({
      topic: "/vehicles",
      payload: { fields: ["header", "speed", "id"] },
      seriesIndices: [0],
      signature: expect.any(String),
    });
  });

  it.each<PlotXAxisVal>(["partialTimestamp", "index", "currentCustom"])(
    "does not plan history ranges in %s mode",
    (xAxisMode) => {
      expect(plan([path("/topic.value")], xAxisMode)[0]?.rangeRequest).toBeUndefined();
    },
  );

  it("groups custom x and y fields by topic and plans per-topic ranges", () => {
    expect(
      planPlotSubscriptions({
        paths: [
          path("/topic.y"),
          path("/y-only.value"),
          path("/ignored.value", { enabled: false }),
        ],
        xAxisMode: "custom",
        xAxisPath: { enabled: true, value: "/topic{xFilter==1}.x" },
        globalVariables: {},
      }),
    ).toEqual([
      {
        subscription: {
          topic: "/topic",
          fields: ["header", "y", "x", "xFilter"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/topic",
          fields: ["header", "y", "x", "xFilter"],
          preloadType: "full",
        },
        rangeRequest: {
          topic: "/topic",
          payload: { fields: ["header", "y", "x", "xFilter"] },
          seriesIndices: [0],
          includesXAxis: true,
          signature: expect.any(String),
        },
      },
      {
        subscription: {
          topic: "/y-only",
          fields: ["header", "value"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/y-only",
          fields: ["header", "value"],
          preloadType: "full",
        },
        rangeRequest: {
          topic: "/y-only",
          payload: { fields: ["header", "value"] },
          seriesIndices: [1],
          signature: expect.any(String),
        },
      },
    ]);
  });

  it("keeps legacy custom x-axis paths without an enabled flag", () => {
    expect(
      planPlotSubscriptions({
        paths: [path("/topic.y")],
        xAxisMode: "custom",
        xAxisPath: { value: "/topic.x" } as BasePlotPath,
        globalVariables: {},
      })[0]?.subscription.fields,
    ).toEqual(["header", "y", "x"]);
  });

  it("uses partial subscriptions for latest-value modes", () => {
    expect(plan([path("/topic.value")], "partialTimestamp")[0]).toEqual({
      subscription: {
        topic: "/topic",
        fields: ["header", "value"],
        preloadType: "partial",
      },
      fallbackSubscription: {
        topic: "/topic",
        fields: ["header", "value"],
        preloadType: "partial",
      },
    });
  });

  it("does not infer script topics from their names", () => {
    expect(plan([path("/arbitrary-derived-output.value")])[0]?.rangeRequest?.topic).toBe(
      "/arbitrary-derived-output",
    );
  });

  it("does not add a disabled custom x-axis path", () => {
    expect(
      planPlotSubscriptions({
        paths: [path("/topic.y")],
        xAxisMode: "custom",
        xAxisPath: { enabled: false, value: "/x-axis.value" },
        globalVariables: {},
      }).map(({ subscription }) => subscription.topic),
    ).toEqual(["/topic"]);
  });
});

describe("startPlotRangeSubscriptions", () => {
  const plans = plan([path("/supported.value"), path("/fallback.value")]);
  const onIteratorStart = async (): Promise<void> => undefined;

  it("waits for ownership configuration, then resets before consuming the first batch", async () => {
    let markConfigured!: (generation: number) => void;
    const configured = new Promise<number>((resolve) => {
      markConfigured = resolve;
    });
    const order: string[] = [];
    const onRangeBatch = jest.fn(async () => {
      order.push("batch");
    });
    const resetTopic = jest.fn(async () => {
      order.push("reset");
    });
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn(({ topic, onNewRangeIterator }) => {
      if (topic === "/fallback") {
        return undefined;
      }
      void onNewRangeIterator(
        (async function* () {
          yield [
            {
              topic,
              schemaName: "schema",
              receiveTime: { sec: 1, nsec: 0 },
              message: { value: 1 },
              sizeInBytes: 1,
            },
          ];
        })(),
      );
      return unsubscribe;
    });

    const running = startPlotRangeSubscriptions({
      plans,
      attemptRanges: true,
      subscribeMessageRange,
      generation: configured,
      onIteratorStart: resetTopic,
      onRangeBatch,
    });
    // Plot configures ownership synchronously after range setup, then releases iterator work.
    order.push("configure");
    markConfigured(7);

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(subscribeMessageRange.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        topic: "/supported",
        payload: { fields: ["header", "value"] },
        receiveLiveData: false,
        skipUserScripts: true,
      }),
    );
    expect(running.rangeTopics).toEqual(new Set(["/supported"]));
    expect(running.subscriptions).toEqual([plans[0]!.subscription, plans[1]!.fallbackSubscription]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(resetTopic).toHaveBeenCalledWith("/supported", 7);
    expect(onRangeBatch).toHaveBeenCalledWith("/supported", expect.any(Array), 7);
    expect(order).toEqual(["configure", "reset", "batch"]);

    running.cancel();
    running.cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses bounded current subscriptions without starting ranges for live playback", () => {
    const subscribeMessageRange = jest.fn();
    const running = startPlotRangeSubscriptions({
      plans,
      attemptRanges: false,
      subscribeMessageRange,
      generation: Promise.resolve(1),
      onIteratorStart,
      onRangeBatch: async () => {},
    });

    expect(subscribeMessageRange).not.toHaveBeenCalled();
    expect(running.rangeTopics).toEqual(new Set());
    expect(running.subscriptions).toEqual(plans.map((item) => item.subscription));
  });

  it("falls back only the topic whose range setup throws synchronously", () => {
    const running = startPlotRangeSubscriptions({
      plans,
      attemptRanges: true,
      generation: Promise.resolve(1),
      subscribeMessageRange: (options) => {
        if (options.topic === "/fallback") {
          throw new Error("unsupported topic");
        }
        return () => undefined;
      },
      onIteratorStart,
      onRangeBatch: async () => undefined,
    });

    expect(running.rangeTopics).toEqual(new Set(["/supported"]));
    expect(running.subscriptions).toEqual([plans[0]!.subscription, plans[1]!.fallbackSubscription]);
    running.cancel();
  });

  it("stops stale iterator batches before unsubscribing", async () => {
    let releaseSecondBatch!: () => void;
    const secondBatchReady = new Promise<void>((resolve) => {
      releaseSecondBatch = resolve;
    });
    const onRangeBatch = jest.fn(async () => {});
    const unsubscribe = jest.fn();
    const running = startPlotRangeSubscriptions({
      plans: [plans[0]!],
      attemptRanges: true,
      generation: Promise.resolve(9),
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield [];
            await secondBatchReady;
            yield [];
          })(),
        );
        return unsubscribe;
      },
      onIteratorStart,
      onRangeBatch,
    });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(onRangeBatch).toHaveBeenCalledTimes(1);
    running.cancel();
    releaseSecondBatch();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(onRangeBatch).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not pull another iterator batch until Dataset ingestion settles", async () => {
    let releaseFirstBatch!: () => void;
    const firstBatchPending = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    const onRangeBatch = jest
      .fn<Promise<void>, []>()
      .mockImplementationOnce(async () => {
        await firstBatchPending;
      })
      .mockResolvedValue(undefined);

    startPlotRangeSubscriptions({
      plans: [plans[0]!],
      attemptRanges: true,
      generation: Promise.resolve(2),
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield [];
            yield [];
          })(),
        );
        return () => {};
      },
      onIteratorStart,
      onRangeBatch,
    });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(onRangeBatch).toHaveBeenCalledTimes(1);
    releaseFirstBatch();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(onRangeBatch).toHaveBeenCalledTimes(2);
  });

  it("resets every replacement iterator and consumes only the latest replay", async () => {
    let onNewRangeIterator: OnNewRangeIterator | undefined;
    const starts: string[] = [];
    const batches: number[] = [];
    let releaseOld!: () => void;
    const oldBlocked = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const running = startPlotRangeSubscriptions({
      plans: [plans[0]!],
      attemptRanges: true,
      generation: Promise.resolve(4),
      subscribeMessageRange: (options) => {
        onNewRangeIterator = options.onNewRangeIterator;
        return () => undefined;
      },
      onIteratorStart: async (topic) => {
        starts.push(topic);
      },
      onRangeBatch: async (_topic, batch) => {
        batches.push((batch[0]?.message as { value: number }).value);
      },
    });

    const oldConsumption = onNewRangeIterator!(
      (async function* () {
        await oldBlocked;
        yield [
          {
            topic: "/supported",
            schemaName: "schema",
            receiveTime: { sec: 1, nsec: 0 },
            message: { value: 1 },
            sizeInBytes: 1,
          },
        ];
      })(),
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const latestConsumption = onNewRangeIterator!(
      (async function* () {
        yield [
          {
            topic: "/supported",
            schemaName: "schema",
            receiveTime: { sec: 2, nsec: 0 },
            message: { value: 2 },
            sizeInBytes: 1,
          },
        ];
      })(),
    );
    await latestConsumption;
    releaseOld();
    await oldConsumption;

    expect(starts).toEqual(["/supported", "/supported"]);
    expect(batches).toEqual([2]);
    running.cancel();
  });

  it("bounds oversized Player batches before Dataset extraction", async () => {
    const message = {
      topic: "/supported",
      schemaName: "schema",
      receiveTime: { sec: 1, nsec: 0 },
      message: { value: 1 },
      sizeInBytes: 1,
    };
    const batchLengths: number[] = [];
    const onRangeBatch = async (
      _topic: string,
      batch: readonly unknown[],
      _generation: number,
    ): Promise<void> => {
      batchLengths.push(batch.length);
    };
    startPlotRangeSubscriptions({
      plans: [plans[0]!],
      attemptRanges: true,
      generation: Promise.resolve(3),
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield new Array(10_001).fill(message);
          })(),
        );
        return () => {};
      },
      onIteratorStart,
      onRangeBatch,
    });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(batchLengths).toEqual([10_000, 1]);
  });

  it("contains asynchronous range failures and reports them", async () => {
    const error = new Error("worker failed");
    const onError = jest.fn();
    startPlotRangeSubscriptions({
      plans: [plans[0]!],
      attemptRanges: true,
      generation: Promise.resolve(1),
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield [];
          })(),
        );
        return () => {};
      },
      onIteratorStart,
      onRangeBatch: async () => {
        throw error;
      },
      onError,
    });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("switches only an asynchronously failed topic to its full fallback", async () => {
    const callbacks = new Map<string, OnNewRangeIterator>();
    const unsubscribes = new Map([
      ["/supported", jest.fn()],
      ["/fallback", jest.fn()],
    ]);
    const onError = jest.fn();
    const onTopicFallback = jest.fn(async () => true);
    const running = startPlotRangeSubscriptions({
      plans,
      attemptRanges: true,
      generation: Promise.resolve(12),
      subscribeMessageRange: (options) => {
        callbacks.set(options.topic, options.onNewRangeIterator);
        return unsubscribes.get(options.topic)!;
      },
      onIteratorStart,
      onRangeBatch: async () => undefined,
      onTopicFallback,
      onError,
    });

    await callbacks.get("/supported")!(
      (async function* () {
        await Promise.reject(new Error("range read failed"));
        yield [];
      })(),
    );

    expect(onTopicFallback).toHaveBeenCalledWith({
      topic: "/supported",
      generation: 12,
      rangeTopics: new Set(["/fallback"]),
      subscriptions: [plans[0]!.fallbackSubscription, plans[1]!.subscription],
    });
    // Dynamic fallback state is sent through the callback; the returned plan remains a snapshot
    // of synchronous setup.
    expect(running.rangeTopics).toEqual(new Set(["/supported", "/fallback"]));
    expect(running.subscriptions).toEqual(plans.map((plan) => plan.subscription));
    expect(unsubscribes.get("/supported")).toHaveBeenCalledTimes(1);
    expect(unsubscribes.get("/fallback")).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    running.cancel();
  });

  it("serializes concurrent fallback commits so inverse completion cannot restore partial", async () => {
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
    const running = startPlotRangeSubscriptions({
      plans,
      attemptRanges: true,
      generation: Promise.resolve(21),
      subscribeMessageRange: (options) => {
        callbacks.set(options.topic, options.onNewRangeIterator);
        return () => undefined;
      },
      onIteratorStart,
      onRangeBatch: async () => undefined,
      onTopicFallback: async ({ subscriptions, topic }) => {
        if (topic === "/supported") {
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

    const firstFailure = callbacks.get("/supported")!(
      (async function* () {
        await Promise.reject(new Error("slow fallback"));
        yield [];
      })(),
    );
    await firstFallbackStartedPromise;
    const secondFailure = callbacks.get("/fallback")!(
      (async function* () {
        await Promise.reject(new Error("fast fallback"));
        yield [];
      })(),
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(commits).toEqual([]);
    releaseFirstFallback();
    await Promise.all([firstFailure, secondFailure]);
    expect(commits).toEqual([
      { topic: "/supported", preloadTypes: ["full", "partial"] },
      { topic: "/fallback", preloadTypes: ["full", "full"] },
    ]);
    running.cancel();
  });
});

describe("plan history signatures", () => {
  const signatureOf = (
    plans: ReturnType<typeof plan>,
    topic: string,
  ): string | undefined =>
    plans.find((item) => item.subscription.topic === topic)?.rangeRequest?.signature;

  it("changes only for topics whose extracted history changes", () => {
    const before = plan([path("/a.value"), path("/b.value")]);
    const after = plan([path("/a.value"), path("/b.value"), path("/b.other")]);
    expect(signatureOf(after, "/a")).toBe(signatureOf(before, "/a"));
    expect(signatureOf(after, "/b")).not.toBe(signatureOf(before, "/b"));
  });

  it("is stable across series index shifts", () => {
    const before = plan([path("/a.value")]);
    const after = plan([path("/new.value"), path("/a.value")]);
    expect(signatureOf(after, "/a")).toBe(signatureOf(before, "/a"));
  });

  it("changes when a series timestamp method changes", () => {
    const before = plan([path("/a.value")]);
    const after = plan([path("/a.value", { timestampMethod: "headerStamp" })]);
    expect(signatureOf(after, "/a")).not.toBe(signatureOf(before, "/a"));
  });
});

describe("PlotRangeSubscriptionManager", () => {
  const noop = async (): Promise<void> => undefined;

  function makeManager(overrides: Partial<ConstructorParameters<typeof PlotRangeSubscriptionManager>[0]> = {}) {
    const unsubscribesByTopic = new Map<string, jest.Mock[]>();
    const iteratorCallbacks = new Map<string, OnNewRangeIterator>();
    const subscribeMessageRange = jest.fn(
      ({ topic, onNewRangeIterator }: Parameters<SubscribeMessageRange>[0]) => {
        const unsubscribe = jest.fn();
        const existing = unsubscribesByTopic.get(topic) ?? [];
        unsubscribesByTopic.set(topic, [...existing, unsubscribe]);
        iteratorCallbacks.set(topic, onNewRangeIterator);
        return unsubscribe;
      },
    );
    const manager = new PlotRangeSubscriptionManager({
      attemptRanges: true,
      subscribeMessageRange,
      onIteratorStart: noop,
      onRangeBatch: noop,
      ...overrides,
    });
    return { manager, subscribeMessageRange, unsubscribesByTopic, iteratorCallbacks };
  }

  it("keeps unchanged topic iterators when a plan adds a topic", () => {
    const { manager, subscribeMessageRange, unsubscribesByTopic } = makeManager();

    manager.update(plan([path("/a.value")]), Promise.resolve(1));
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);

    const plans = plan([path("/a.value"), path("/b.value")]);
    const updated = manager.update(plans, Promise.resolve(1));

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(subscribeMessageRange.mock.calls[1]?.[0]?.topic).toBe("/b");
    expect(unsubscribesByTopic.get("/a")![0]).not.toHaveBeenCalled();
    expect(updated.rangeTopics).toEqual(new Set(["/a", "/b"]));
    expect(updated.subscriptions).toEqual(plans.map((item) => item.subscription));

    manager.cancel();
    expect(unsubscribesByTopic.get("/a")![0]).toHaveBeenCalledTimes(1);
    expect(unsubscribesByTopic.get("/b")![0]).toHaveBeenCalledTimes(1);
  });

  it("restarts only topics whose signature changed and stops removed topics", () => {
    const { manager, subscribeMessageRange, unsubscribesByTopic } = makeManager();

    manager.update(plan([path("/a.value"), path("/b.value")]), Promise.resolve(1));
    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);

    manager.update(plan([path("/a.value"), path("/b.other")]), Promise.resolve(1));
    expect(subscribeMessageRange).toHaveBeenCalledTimes(3);
    expect(subscribeMessageRange.mock.calls[2]?.[0]?.topic).toBe("/b");
    expect(unsubscribesByTopic.get("/a")).toHaveLength(1);
    expect(unsubscribesByTopic.get("/a")![0]).not.toHaveBeenCalled();
    expect(unsubscribesByTopic.get("/b")![0]).toHaveBeenCalledTimes(1);

    const removed = manager.update(plan([path("/a.value")]), Promise.resolve(1));
    expect(unsubscribesByTopic.get("/b")![1]).toHaveBeenCalledTimes(1);
    expect(removed.rangeTopics).toEqual(new Set(["/a"]));

    manager.cancel();
  });

  it("keeps an async fallback decision across unrelated plan updates", async () => {
    const { manager, subscribeMessageRange, iteratorCallbacks } = makeManager({
      onTopicFallback: async () => true,
    });

    const initialPlans = plan([path("/a.value"), path("/b.value")]);
    manager.update(initialPlans, Promise.resolve(1));
    await iteratorCallbacks.get("/b")!(
      (async function* () {
        await Promise.reject(new Error("range failed"));
        yield [];
      })(),
    );

    const plans = plan([path("/a.value"), path("/b.value"), path("/c.value")]);
    const updated = manager.update(plans, Promise.resolve(1));

    // /b keeps its fallback; only /c starts a new range.
    expect(subscribeMessageRange.mock.calls.map((call) => call[0].topic)).toEqual([
      "/a",
      "/b",
      "/c",
    ]);
    expect(updated.rangeTopics).toEqual(new Set(["/a", "/c"]));
    expect(updated.subscriptions).toEqual([
      plans[0]!.subscription,
      plans[1]!.fallbackSubscription,
      plans[2]!.subscription,
    ]);

    manager.cancel();
  });

  it("retries the range when a fallback topic's signature changes", async () => {
    const { manager, subscribeMessageRange, iteratorCallbacks } = makeManager({
      onTopicFallback: async () => true,
    });

    manager.update(plan([path("/b.value")]), Promise.resolve(1));
    await iteratorCallbacks.get("/b")!(
      (async function* () {
        await Promise.reject(new Error("range failed"));
        yield [];
      })(),
    );

    const plans = plan([path("/b.other")]);
    const updated = manager.update(plans, Promise.resolve(1));

    expect(subscribeMessageRange.mock.calls.map((call) => call[0].topic)).toEqual(["/b", "/b"]);
    expect(updated.rangeTopics).toEqual(new Set(["/b"]));
    expect(updated.subscriptions).toEqual([plans[0]!.subscription]);

    manager.cancel();
  });
});
