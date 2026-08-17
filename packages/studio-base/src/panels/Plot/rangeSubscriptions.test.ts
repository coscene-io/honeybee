// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { BasePlotPath, PlotPath, PlotXAxisVal } from "./config";
import { planPlotSubscriptions, startPlotRangeSubscriptions } from "./rangeSubscriptions";

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
    });
  });

  it.each<PlotXAxisVal>(["partialTimestamp", "index", "custom", "currentCustom"])(
    "does not plan timestamp ranges in %s mode",
    (xAxisMode) => {
      expect(plan([path("/topic.value")], xAxisMode)[0]?.rangeRequest).toBeUndefined();
    },
  );

  it("keeps preload behavior and includes the custom x-axis path", () => {
    expect(
      planPlotSubscriptions({
        paths: [path("/topic.y"), path("/ignored.value", { enabled: false })],
        xAxisMode: "custom",
        xAxisPath: { enabled: true, value: "/topic{xFilter==1}.x" },
        globalVariables: {},
      }),
    ).toEqual([
      {
        subscription: {
          topic: "/topic",
          fields: ["header", "y", "x", "xFilter"],
          preloadType: "full",
        },
        fallbackSubscription: {
          topic: "/topic",
          fields: ["header", "y", "x", "xFilter"],
          preloadType: "full",
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

  it("uses one grouped range per supported replay topic and falls back per topic", async () => {
    let configured = false;
    let configuredBeforeFirstBatch = false;
    const onRangeBatch = jest.fn(async () => {
      configuredBeforeFirstBatch = configured;
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
      generation: 7,
      onRangeBatch,
    });
    // Plot configures the Timestamp builder immediately after this synchronous setup returns.
    configured = true;

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
    expect(onRangeBatch).toHaveBeenCalledWith("/supported", expect.any(Array), 7);
    expect(configuredBeforeFirstBatch).toBe(true);

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
      generation: 1,
      onRangeBatch: async () => {},
    });

    expect(subscribeMessageRange).not.toHaveBeenCalled();
    expect(running.rangeTopics).toEqual(new Set());
    expect(running.subscriptions).toEqual(plans.map((item) => item.subscription));
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
      generation: 9,
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
      generation: 2,
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield [];
            yield [];
          })(),
        );
        return () => {};
      },
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
      generation: 3,
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield new Array(10_001).fill(message);
          })(),
        );
        return () => {};
      },
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
      generation: 1,
      subscribeMessageRange: ({ onNewRangeIterator }) => {
        void onNewRangeIterator(
          (async function* () {
            yield [];
          })(),
        );
        return () => {};
      },
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
});
