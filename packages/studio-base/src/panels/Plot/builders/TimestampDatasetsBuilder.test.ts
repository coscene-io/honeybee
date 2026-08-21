// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";
import * as _ from "lodash-es";

import { unwrap } from "@foxglove/den/monads";
import { makeComlinkWorkerMock } from "@foxglove/den/testing";
import { parseMessagePath } from "@foxglove/message-path";
import { MessageEvent } from "@foxglove/studio";
import {
  MessageBlock,
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@foxglove/studio-base/players/types";

import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { TimestampDatasetsBuilder } from "./TimestampDatasetsBuilder";
import { TimestampDatasetsBuilderImpl } from "./TimestampDatasetsBuilderImpl";
import { PlotPath } from "../config";

let createTimestampDatasetsBuilderImpl: () => object = () => new TimestampDatasetsBuilderImpl();

Object.defineProperty(global, "Worker", {
  writable: true,
  value: makeComlinkWorkerMock(() => ({
    async createTimestampDatasetsBuilder() {
      return Comlink.proxy(createTimestampDatasetsBuilderImpl());
    },
  })),
});

const builders: TimestampDatasetsBuilder[] = [];

function createBuilder(): TimestampDatasetsBuilder {
  const builder = new TimestampDatasetsBuilder();
  builders.push(builder);
  return builder;
}

afterEach(async () => {
  for (const builder of builders.splice(0)) {
    builder.destroy();
  }
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  createTimestampDatasetsBuilderImpl = () => new TimestampDatasetsBuilderImpl();
});

function groupByTopic(events: MessageEvent[]): Record<string, MessageEvent[]> {
  return _.groupBy(events, (item) => item.topic);
}

function buildSeriesItems(
  paths: (Partial<PlotPath> & { key?: string; value: string })[],
): SeriesItem[] {
  return paths.map((item, idx) => {
    const parsed = unwrap(parseMessagePath(item.value));
    const key = (item.key ?? String(idx)) as SeriesConfigKey;

    return {
      configIndex: idx,
      parsed,
      color: "red",
      contrastColor: "blue",
      enabled: item.enabled ?? true,
      timestampMethod: item.timestampMethod ?? "receiveTime",
      key,
      lineSize: 1,
      messagePath: item.value,
      showLine: item.showLine ?? true,
    } satisfies SeriesItem;
  });
}

function buildPlayerState(
  activeDataOverride?: Partial<PlayerStateActiveData>,
  blocks?: readonly (MessageBlock | undefined)[],
): PlayerState {
  return {
    activeData: {
      messages: [],
      currentTime: { sec: 0, nsec: 0 },
      endTime: { sec: 0, nsec: 0 },
      lastSeekTime: 1,
      topics: [],
      speed: 1,
      isPlaying: false,
      repeatEnabled: false,
      topicStats: new Map(),
      startTime: { sec: 0, nsec: 0 },
      datatypes: new Map(),
      totalBytesReceived: 0,
      ...activeDataOverride,
    },
    capabilities: [],
    presence: PlayerPresence.PRESENT,
    profile: undefined,
    playerId: "1",
    progress: {
      fullyLoadedFractionRanges: [],
      messageCache: {
        blocks: blocks ?? [],
        startTime: { sec: 0, nsec: 0 },
      },
    },
  };
}

describe("TimestampDatasetsBuilder", () => {
  it("releases its child worker session without waiting for a hung request", async () => {
    let requestStarted!: () => void;
    const requestStartedPromise = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const hungRequest = new Promise<never>(() => {});
    const finalized = jest.fn();
    createTimestampDatasetsBuilderImpl = () => ({
      [Comlink.finalizer]: finalized,
      async getXRange() {
        requestStarted();
        return await hungRequest;
      },
    });
    const builder = createBuilder();
    const rangePromise = builder.getXRange();
    await requestStartedPromise;

    builder.destroy();
    await expect(rangePromise).resolves.toBeUndefined();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(finalized).toHaveBeenCalledTimes(1);
  });

  it.each(["viewport", "CSV"] as const)(
    "settles a hung %s request when destroyed",
    async (requestKind) => {
      let requestStarted!: () => void;
      const requestStartedPromise = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      const hungRequest = new Promise<never>(() => {});
      createTimestampDatasetsBuilderImpl = () => ({
        async getCsvDataChunk() {
          requestStarted();
          return await hungRequest;
        },
        async getViewportDatasets() {
          requestStarted();
          return await hungRequest;
        },
      });
      const builder = createBuilder();
      const requestPromise =
        requestKind === "viewport"
          ? builder.getViewportDatasets({ bounds: {}, size: { width: 100, height: 100 } })
          : builder.forEachCsvDataChunk(async () => true);
      await requestStartedPromise;

      builder.destroy();

      if (requestKind === "viewport") {
        await expect(requestPromise).resolves.toEqual({
          datasetsByConfigIndex: [],
          pathsWithMismatchedDataLengths: new Set(),
        });
      } else {
        await expect(requestPromise).resolves.toBe(false);
      }
    },
  );

  it("does not start a queued worker RPC after destruction", async () => {
    let finishFirstRequest!: () => void;
    let firstRequestStarted!: () => void;
    const finishFirstRequestPromise = new Promise<void>((resolve) => {
      finishFirstRequest = resolve;
    });
    const firstRequestStartedPromise = new Promise<void>((resolve) => {
      firstRequestStarted = resolve;
    });
    const getXRange = jest.fn(async () => {
      firstRequestStarted();
      await finishFirstRequestPromise;
      return { min: 0, max: 1 };
    });
    createTimestampDatasetsBuilderImpl = () => ({ getXRange });
    const builder = createBuilder();
    const firstRange = builder.getXRange();
    await firstRequestStartedPromise;
    const queuedRange = builder.getXRange();

    builder.destroy();
    finishFirstRequest();

    await expect(firstRange).resolves.toBeUndefined();
    await expect(queuedRange).resolves.toBeUndefined();
    expect(getXRange).toHaveBeenCalledTimes(1);
  });

  it("flushes pending updates and stops the CSV cursor after callback cancellation", async () => {
    const callOrder: string[] = [];
    const applyActions = jest.fn(async () => {
      callOrder.push("apply");
    });
    const getCsvDataChunk = jest.fn(async () => {
      callOrder.push("chunk");
      return {
        datasets: [
          {
            label: "/foo.val",
            data: [
              { x: 0, y: 1, receiveTime: { sec: 0, nsec: 0 }, value: 1 },
              { x: 1, y: 2, receiveTime: { sec: 1, nsec: 0 }, value: 2 },
            ],
          },
        ],
        nextCursor: { seriesIndex: 0, datumIndex: 2 },
      };
    });
    createTimestampDatasetsBuilderImpl = () => ({ applyActions, getCsvDataChunk });
    const builder = createBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
    const callback = jest.fn(async () => false);

    await expect(builder.forEachCsvDataChunk(callback, 50_000)).resolves.toBe(false);

    expect(callOrder).toEqual(["apply", "chunk"]);
    expect(applyActions).toHaveBeenCalledTimes(1);
    expect(getCsvDataChunk).toHaveBeenCalledTimes(1);
    expect(getCsvDataChunk).toHaveBeenCalledWith(undefined, 10_000);
    expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({ label: "/foo.val", data: expect.any(Array) }),
    ]);
  });

  it("keeps worker updates from interleaving with a CSV cursor operation", async () => {
    let finishCallback!: () => void;
    let callbackStarted!: () => void;
    const finishCallbackPromise = new Promise<void>((resolve) => {
      finishCallback = resolve;
    });
    const callbackStartedPromise = new Promise<void>((resolve) => {
      callbackStarted = resolve;
    });
    const getXRange = jest.fn(async () => ({ min: 0, max: 1 }));
    createTimestampDatasetsBuilderImpl = () => ({
      async getCsvDataChunk() {
        return {
          datasets: [
            {
              label: "/foo.val",
              data: [{ x: 0, y: 1, receiveTime: { sec: 0, nsec: 0 }, value: 1 }],
            },
          ],
        };
      },
      getXRange,
    });
    const builder = createBuilder();
    const exportPromise = builder.forEachCsvDataChunk(async () => {
      callbackStarted();
      await finishCallbackPromise;
      return false;
    });
    await callbackStartedPromise;

    const rangePromise = builder.getXRange();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(getXRange).not.toHaveBeenCalled();

    finishCallback();
    await exportPromise;
    await expect(rangePromise).resolves.toEqual({ min: 0, max: 1 });
    expect(getXRange).toHaveBeenCalledTimes(1);
  });

  it("should process current messages into a dataset", async () => {
    const builder = createBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0.5, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1.5,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2.5,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
      ],
    });
  });

  it("should create a discontinuity between current and full", async () => {
    const builder = createBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );

    const block = {
      sizeInBytes: 0,
      messagesByTopic: groupByTopic([
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 0,
          },
        },
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0.5, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 1,
          },
        },
      ]),
    };

    const playerState = buildPlayerState(
      {
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1.5,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2.5,
            },
          },
        ],
      },
      [block],
    );

    builder.handlePlayerState(playerState);
    await builder.handleBlocks(
      unwrap(playerState.activeData?.startTime),
      unwrap(playerState.progress.messageCache?.blocks),
      async () => await Promise.resolve(false),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: NaN, y: NaN, value: NaN },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
      ],
    });
  });

  it("computes derivative inside and outside of viewport", async () => {
    const builder = createBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val.@derivative",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0.5, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1.5,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2.5,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0.5, y: 2, value: 2 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {
          x: { min: 0.2 },
        },
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0.5, y: 2, value: 2 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {
          x: { min: 0.75 },
        },
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0.5, y: 2, value: 2 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {
          x: { min: 1.2 },
        },
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });
  });

  it("should cull current messages after threshold is reached", async () => {
    const builder = createBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
          showLine: false,
        },
      ]),
    );

    const messages = new Array(60_000).fill(1).map((_val, idx) => {
      return {
        topic: "/foo",
        schemaName: "foo",
        receiveTime: { sec: idx, nsec: 0 },
        sizeInBytes: 0,
        message: {
          val: idx,
        },
      };
    });

    // first batch of messages is under the limit
    {
      builder.handlePlayerState(
        buildPlayerState({
          messages: messages.slice(0, 40_000),
        }),
      );

      const result = await builder.getViewportDatasets({
        size: { width: 100_000, height: 100_000 },
        bounds: {},
      });

      expect(result.datasetsByConfigIndex[0]!.data.length).toEqual(40_000);
      expect(result.datasetsByConfigIndex[0]!.data[0]).toEqual({ x: 0, y: 0, value: 0 });
      expect(result.datasetsByConfigIndex[0]!.data[39_999]).toEqual({
        x: 39_999,
        y: 39_999,
        value: 39_999,
      });
    }

    // Next batch goes over the limit so some of the previous will be culled
    {
      builder.handlePlayerState(
        buildPlayerState({
          messages: messages.slice(40_000, 60_000),
        }),
      );

      const result = await builder.getViewportDatasets({
        size: { width: 100_000, height: 100_000 },
        bounds: {},
      });

      expect(result.datasetsByConfigIndex[0]!.data.length).toEqual(37500);
      expect(result.datasetsByConfigIndex[0]!.data[0]).toEqual({
        x: 22_500,
        y: 22_500,
        value: 22_500,
      });
      expect(result.datasetsByConfigIndex[0]!.data[37_499]).toEqual({
        x: 59_999,
        y: 59_999,
        value: 59_999,
      });
    }
  });

  it("keeps range-backed replay history separate from blocks and current messages", async () => {
    const builder = createBuilder();
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );
    builder.setHistoryTopics(new Set(["/foo"]), new Set(), 4);

    const blockMessage: MessageEvent = {
      topic: "/foo",
      schemaName: "foo",
      receiveTime: { sec: 1, nsec: 0 },
      sizeInBytes: 0,
      message: { val: 10 },
    };
    await builder.handleBlocks(
      { sec: 0, nsec: 0 },
      [{ sizeInBytes: 0, messagesByTopic: groupByTopic([blockMessage]) }],
      async () => false,
    );
    builder.handlePlayerState(
      buildPlayerState({
        messages: [{ ...blockMessage, receiveTime: { sec: 2, nsec: 0 }, message: { val: 20 } }],
      }),
    );

    await expect(
      builder.appendRangeMessageBatch(
        "/foo",
        [{ ...blockMessage, receiveTime: { sec: 3, nsec: 0 }, message: { val: 30 } }],
        { sec: 0, nsec: 0 },
        3,
      ),
    ).resolves.toBe(false);
    await expect(
      builder.appendRangeMessageBatch(
        "/foo",
        [{ ...blockMessage, receiveTime: { sec: 4, nsec: 0 }, message: { val: 40 } }],
        { sec: 0, nsec: 0 },
        4,
      ),
    ).resolves.toBe(true);

    const result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]).toEqual(
      expect.objectContaining({ data: [{ x: 4, y: 40, value: 40 }] }),
    );
  });

  it("keeps a quiet range playback head across iterator replacement and clears it on fallback", async () => {
    const builder = createBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val", timestampMethod: "receiveTime" }]));
    builder.setHistoryTopics(new Set(["/foo"]), new Set(), 6);
    const viewport = { size: { width: 100, height: 100 }, bounds: {} };
    const currentTime = { sec: 4, nsec: 0 };
    const makeMessage = (val: number): MessageEvent => ({
      topic: "/foo",
      schemaName: "foo",
      receiveTime: currentTime,
      sizeInBytes: 0,
      message: { val },
    });

    builder.handlePlayerState(
      buildPlayerState({ currentTime, messages: [makeMessage(40)], lastSeekTime: 1 }),
    );
    let result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([40]);

    await expect(builder.resetRangeTopic("/foo", 6)).resolves.toBe(true);
    result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.currentValuesByConfigIndex).toEqual([40]);

    await expect(builder.releaseRangeTopic("/foo", 6)).resolves.toBe(true);
    builder.handlePlayerState(
      buildPlayerState({ currentTime, messages: [makeMessage(400)], lastSeekTime: 1 }),
    );
    result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.currentValuesByConfigIndex).toEqual([400]);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([{ x: 4, y: 400, value: 400 }]);
  });

  it("clears full and current legend storage when the player changes without a new seek", async () => {
    const builder = createBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val", timestampMethod: "receiveTime" }]));
    builder.setHistoryTopics(new Set(["/foo"]), new Set(), 9);
    const viewport = { size: { width: 100, height: 100 }, bounds: {} };
    const currentTime = { sec: 2, nsec: 0 };
    const event: MessageEvent = {
      topic: "/foo",
      schemaName: "foo",
      receiveTime: currentTime,
      sizeInBytes: 0,
      message: { val: 20 },
    };

    builder.handlePlayerState(
      buildPlayerState({ currentTime, lastSeekTime: 1, messages: [event] }),
    );
    await builder.appendRangeMessageBatch("/foo", [event], { sec: 0, nsec: 0 }, 9);
    await expect(builder.getViewportDatasets(viewport, currentTime)).resolves.toEqual(
      expect.objectContaining({ currentValuesByConfigIndex: [20] }),
    );

    builder.handlePlayerState({ ...buildPlayerState(), activeData: undefined, playerId: "2" });
    let result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);

    builder.handlePlayerState({
      ...buildPlayerState({ currentTime, lastSeekTime: 1, messages: [] }),
      playerId: "2",
    });
    result = await builder.getViewportDatasets(viewport, currentTime);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);
  });

  it("resets replacement history and releases only the failed range topic", async () => {
    const builder = createBuilder();
    builder.setSeries(
      buildSeriesItems([
        { value: "/foo.val", timestampMethod: "receiveTime" },
        { value: "/bar.val", timestampMethod: "receiveTime" },
      ]),
    );
    builder.setHistoryTopics(new Set(["/foo", "/bar"]), new Set(), 8);
    const message = (topic: string, sec: number, val: number): MessageEvent => ({
      topic,
      schemaName: "schema",
      receiveTime: { sec, nsec: 0 },
      sizeInBytes: 0,
      message: { val },
    });

    await builder.appendRangeMessageBatch("/foo", [message("/foo", 1, 10)], { sec: 0, nsec: 0 }, 8);
    await builder.appendRangeMessageBatch("/bar", [message("/bar", 2, 20)], { sec: 0, nsec: 0 }, 8);
    await expect(builder.resetRangeTopic("/foo", 8)).resolves.toBe(true);
    await builder.appendRangeMessageBatch("/foo", [message("/foo", 3, 30)], { sec: 0, nsec: 0 }, 8);

    let result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]).toEqual(
      expect.objectContaining({ data: [{ x: 3, y: 30, value: 30 }] }),
    );
    expect(result.datasetsByConfigIndex[1]).toEqual(
      expect.objectContaining({ data: [{ x: 2, y: 20, value: 20 }] }),
    );

    await expect(builder.releaseRangeTopic("/foo", 8)).resolves.toBe(true);
    await builder.handleBlocks(
      { sec: 0, nsec: 0 },
      [
        {
          sizeInBytes: 0,
          messagesByTopic: groupByTopic([message("/foo", 4, 40), message("/bar", 5, 50)]),
        },
      ],
      async () => false,
    );
    result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]).toEqual(
      expect.objectContaining({ data: [{ x: 4, y: 40, value: 40 }] }),
    );
    expect(result.datasetsByConfigIndex[1]).toEqual(
      expect.objectContaining({ data: [{ x: 2, y: 20, value: 20 }] }),
    );
  });

  it("uses only bounded current-frame storage for live timestamp topics", async () => {
    const builder = createBuilder();
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );
    builder.setHistoryTopics(new Set(), new Set(["/foo"]), 5);

    const blockMessage: MessageEvent = {
      topic: "/foo",
      schemaName: "foo",
      receiveTime: { sec: 1, nsec: 0 },
      sizeInBytes: 0,
      message: { val: 10 },
    };
    await builder.handleBlocks(
      { sec: 0, nsec: 0 },
      [{ sizeInBytes: 0, messagesByTopic: groupByTopic([blockMessage]) }],
      async () => false,
    );
    builder.handlePlayerState(
      buildPlayerState({
        messages: [{ ...blockMessage, receiveTime: { sec: 2, nsec: 0 }, message: { val: 20 } }],
      }),
    );

    const result = await builder.getViewportDatasets({
      size: { width: 1_000, height: 1_000 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]).toEqual(
      expect.objectContaining({ data: [{ x: 2, y: 20, value: 20 }] }),
    );
  });

  it("preserves an unchanged live topic when another current-only topic is added", async () => {
    const builder = createBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/a.val" }]));
    builder.setHistoryTopics(new Set(), new Set(["/a"]), 1);
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/a",
            schemaName: "a",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 10 },
          },
        ],
      }),
    );
    await builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} });

    builder.setSeries(buildSeriesItems([{ value: "/a.val" }, { value: "/b.val" }]));
    builder.setHistoryTopics(new Set(), new Set(["/a", "/b"]), 2);

    const result = await builder.getViewportDatasets({
      size: { width: 100, height: 100 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([{ x: 1, y: 10, value: 10 }]);
  });

  it("clears fallback block and current history when the Player source changes", async () => {
    const builder = createBuilder();
    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 10 },
          },
        ],
      }),
    );
    await builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} });

    // A new Player may reuse the same lastSeekTime, so source identity must reset storage directly.
    builder.setHistoryTopics(new Set(), new Set(), 6, { resetAll: true });
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 20 },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets({
      size: { width: 100, height: 100 },
      bounds: {},
    });
    expect(result.datasetsByConfigIndex[0]).toEqual(
      expect.objectContaining({ data: [{ x: 2, y: 20, value: 20 }] }),
    );
  });

  it("supports toggling series enabled state", async () => {
    const builder = createBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 0, y: 1, value: 1 }],
        }),
        expect.objectContaining({
          data: [{ x: 0, y: 2, value: 2 }],
        }),
      ],
    });

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: false,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        expect.objectContaining({
          data: [{ x: 0, y: 2, value: 2 }],
        }),
      ],
    });
  });

  it("clears disabled current data on seek before the series is re-enabled", async () => {
    const builder = createBuilder();
    const enabledSeries = buildSeriesItems([{ enabled: true, value: "/foo.val" }]);
    builder.setSeries(enabledSeries);
    builder.handlePlayerState(
      buildPlayerState({
        lastSeekTime: 1,
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 10 },
          },
        ],
      }),
    );
    await builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} });

    builder.setSeries(buildSeriesItems([{ enabled: false, value: "/foo.val" }]));
    builder.handlePlayerState(buildPlayerState({ lastSeekTime: 2, messages: [] }));
    builder.setSeries(enabledSeries);

    await expect(
      builder.getViewportDatasets({ size: { width: 100, height: 100 }, bounds: {} }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [expect.objectContaining({ data: [] })],
    });
  });

  it("clears a disabled range-series legend on seek", async () => {
    const builder = createBuilder();
    const enabledSeries = buildSeriesItems([{ enabled: true, value: "/foo.val" }]);
    builder.setSeries(buildSeriesItems([{ enabled: false, value: "/foo.val" }]));
    builder.setHistoryTopics(new Set(["/foo"]), new Set(), 1);
    builder.handlePlayerState(
      buildPlayerState({
        lastSeekTime: 1,
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 10 },
          },
        ],
      }),
    );
    await builder.getViewportDatasets(
      { size: { width: 100, height: 100 }, bounds: {} },
      { sec: 1, nsec: 0 },
    );

    builder.handlePlayerState(buildPlayerState({ lastSeekTime: 2, messages: [] }));
    builder.setSeries(enabledSeries);

    const result = await builder.getViewportDatasets(
      { size: { width: 100, height: 100 }, bounds: {} },
      { sec: 2, nsec: 0 },
    );
    expect(result.currentValuesByConfigIndex).toEqual([undefined]);
  });

  it("keeps disabled-series legend values current without appending rendered data", async () => {
    const builder = createBuilder();
    const enabledSeries = buildSeriesItems([{ enabled: true, value: "/foo.val" }]);
    builder.setSeries(enabledSeries);
    builder.setSeries(buildSeriesItems([{ enabled: false, value: "/foo.val" }]));
    builder.handlePlayerState(
      buildPlayerState({
        currentTime: { sec: 2, nsec: 0 },
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 20 },
          },
        ],
      }),
    );
    builder.setSeries(enabledSeries);

    const result = await builder.getViewportDatasets(
      { size: { width: 100, height: 100 }, bounds: {} },
      { sec: 2, nsec: 0 },
    );
    expect(result.currentValuesByConfigIndex).toEqual([20]);
    expect(result.datasetsByConfigIndex[0]?.data).toEqual([]);
  });

  it("leaves gaps in datasetsByConfigIndex for missing series", async () => {
    const builder = createBuilder();

    builder.setSeries([
      {
        configIndex: 3,
        parsed: parseMessagePath("/foo.val")!,
        color: "red",
        contrastColor: "blue",
        enabled: true,
        timestampMethod: "receiveTime",
        key: "x" as SeriesConfigKey,
        lineSize: 1,
        messagePath: "/foo.val",
        showLine: true,
      },
    ]);

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          data: [{ x: 0, y: 1, value: 1 }],
        }),
      ],
    });
  });
});
