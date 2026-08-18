// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import { MessagePath } from "@foxglove/message-path";
import { toSec, subtract as subtractTime } from "@foxglove/rostime";
import { Immutable, MessageEvent, Time } from "@foxglove/studio";
import { simpleGetMessagePathDataItems } from "@foxglove/studio-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import {
  acquireTimestampDatasetsBuilder,
  TimestampDatasetWorkerLease,
} from "@foxglove/studio-base/panels/shared/DatasetWorkerPool";
import { MessageBlock, PlayerState } from "@foxglove/studio-base/players/types";
import { Bounds1D } from "@foxglove/studio-base/types/Bounds";
import { TimestampMethod, getTimestampForMessage } from "@foxglove/studio-base/util/time";

import { BlockTopicCursor } from "./BlockTopicCursor";
import {
  CsvDataset,
  GetViewportDatasetsResult,
  IDatasetsBuilder,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type { DataItem, UpdateDataAction } from "./TimestampDatasetsBuilderImpl";
import { restoreUnpackedDataAccessor } from "../PackedDataset";
import { getChartValue, isChartValue, toOwnedChartValue } from "../datum";
import { MathFunction, mathFunctions } from "../mathFunctions";

const log = Logger.getLogger(__filename);

type BuilderLifetime = {
  abortController: AbortController;
  destroyPromise?: Promise<void>;
  inFlight: Set<Promise<unknown>>;
  leasePromise: Promise<TimestampDatasetWorkerLease>;
};

// The held BuilderLifetime never points back to its builder, so registration does not prevent GC.
const registry = new FinalizationRegistry<BuilderLifetime>((lifetime) => {
  void destroyLifetime(lifetime);
});

const emptyPaths = new Set<string>();

type TimestampSeriesItem = {
  config: Immutable<SeriesItem>;
  blockCursor: BlockTopicCursor;
};

/**
 * TimestampDatasetsBuilder builds timeseries datasets.
 *
 * It supports full (preload) data and current frame data. The series datums are extracted from
 * input player states and sent to the worker. The worker accumulates the data and provides
 * downsampled data.
 */
export class TimestampDatasetsBuilder implements IDatasetsBuilder {
  #pendingDispatch: Immutable<UpdateDataAction>[] = [];

  /** Serializes action delivery so range batches cannot overtake viewport or block updates. */
  #remoteQueue: Promise<void> = Promise.resolve();

  #lastSeekTime = 0;

  #series: Immutable<TimestampSeriesItem[]> = [];

  #xAxisMode: "timestamp" | "partialTimestamp";

  #rangeGeneration = 0;
  #rangeTopics = new Set<string>();
  #currentOnlyTopics = new Set<string>();

  #lifetime: BuilderLifetime;
  #destroyed = false;

  public constructor(
    {
      handleWorkerError,
      xAxisMode,
    }: {
      handleWorkerError?: (event: Event) => void;
      xAxisMode: "timestamp" | "partialTimestamp";
    } = { xAxisMode: "timestamp" },
  ) {
    this.#xAxisMode = xAxisMode;
    const abortController = new AbortController();
    const lifetime = {
      abortController,
      inFlight: new Set<Promise<unknown>>(),
      leasePromise: acquireTimestampDatasetsBuilder({
        handleWorkerError: (event) => {
          log.error("[TimestampDatasetsBuilder] Worker error:", event);
          handleWorkerError?.(event);
        },
        signal: abortController.signal,
      }),
    } satisfies BuilderLifetime;
    this.#lifetime = lifetime;

    // Attach a rejection handler even when the panel is destroyed before its first remote call.
    void lifetime.leasePromise.catch((error: unknown) => {
      if (!lifetime.abortController.signal.aborted) {
        log.error("[TimestampDatasetsBuilder] Failed to create Dataset worker session", error);
      }
    });
    registry.register(this, lifetime, lifetime);
  }

  public destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#pendingDispatch = [];
    registry.unregister(this.#lifetime);
    void destroyLifetime(this.#lifetime);
  }

  public handlePlayerState(state: Immutable<PlayerState>): Bounds1D | undefined {
    if (this.#destroyed) {
      return;
    }
    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const didSeek = activeData.lastSeekTime !== this.#lastSeekTime;
    this.#lastSeekTime = activeData.lastSeekTime;

    const msgEvents = activeData.messages;
    if (msgEvents.length > 0) {
      for (const series of this.#series) {
        if (!series.config.enabled || this.#rangeTopics.has(series.config.parsed.topicName)) {
          continue;
        }
        const mathFn = series.config.parsed.modifier
          ? mathFunctions[series.config.parsed.modifier]
          : undefined;

        if (didSeek) {
          if (this.#xAxisMode === "partialTimestamp") {
            return;
          }
          this.#pendingDispatch.push({
            type: "reset-current",
            series: series.config.key,
          });
        }

        const pathItems = readMessagePathItems(
          msgEvents,
          series.config.parsed,
          series.config.timestampMethod,
          activeData.startTime,
          mathFn,
        );

        this.#pendingDispatch.push({
          type: "append-current",
          series: series.config.key,
          items: pathItems,
        });
      }
    }

    return { min: 0, max: toSec(subtractTime(activeData.endTime, activeData.startTime)) };
  }

  public async handleBlocks(
    startTime: Immutable<Time>,
    blocks: Immutable<(MessageBlock | undefined)[]>,
    progress: () => Promise<boolean>,
  ): Promise<void> {
    if (this.#destroyed) {
      return;
    }
    if (this.#xAxisMode === "partialTimestamp") {
      return;
    }

    // identify if series need resetting because of the blocks
    const seriesArr = this.#series.filter(
      (series) =>
        series.config.enabled &&
        !this.#rangeTopics.has(series.config.parsed.topicName) &&
        !this.#currentOnlyTopics.has(series.config.parsed.topicName),
    );

    for (const series of seriesArr) {
      if (series.blockCursor.nextWillReset(blocks)) {
        this.#pendingDispatch.push({
          type: "reset-full",
          series: series.config.key,
        });
      }
    }

    // We loop through the series and only process one next block and keep doing this until
    // there are no more updates. This processes the series "in parallel" so that all of them appear
    // to be loading blocks at the same time.
    let done = 0;
    do {
      done = 0;

      for (const series of seriesArr) {
        if (
          !series.config.enabled ||
          this.#rangeTopics.has(series.config.parsed.topicName) ||
          this.#currentOnlyTopics.has(series.config.parsed.topicName)
        ) {
          done += 1;
          continue;
        }
        const mathFn = series.config.parsed.modifier
          ? mathFunctions[series.config.parsed.modifier]
          : undefined;

        const messageEvents = series.blockCursor.next(blocks);
        if (!messageEvents) {
          done += 1;
          continue;
        }

        const pathItems = readMessagePathItems(
          messageEvents,
          series.config.parsed,
          series.config.timestampMethod,
          startTime,
          mathFn,
        );

        if (pathItems.length === 0) {
          continue;
        }

        this.#pendingDispatch.push({
          type: "append-full",
          series: series.config.key,
          items: pathItems,
        });

        const abort = await progress();
        if (abort || this.#lifetime.abortController.signal.aborted) {
          return;
        }
      }
    } while (done < seriesArr.length);
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    if (this.#destroyed) {
      return;
    }
    this.#series = series.map((item) => {
      const existing = this.#series.find((existingItem) => existingItem.config.key === item.key);
      return {
        config: item,
        blockCursor: existing?.blockCursor ?? new BlockTopicCursor(item.parsed.topicName),
      };
    });

    this.#pendingDispatch.push({
      type: "update-series-config",
      seriesItems: series,
    });
  }

  /**
   * Assigns history ownership for replay ranges and live current-only topics. Every generation
   * starts protected topics with empty storage; topics leaving either mode get fresh block cursors
   * for legacy preload fallback.
   */
  public setHistoryTopics(
    rangeTopics: ReadonlySet<string>,
    currentOnlyTopics: ReadonlySet<string>,
    generation: number,
    options?: { resetAll?: boolean },
  ): void {
    if (this.#destroyed || this.#xAxisMode !== "timestamp") {
      return;
    }

    const previousTopics = new Set([...this.#rangeTopics, ...this.#currentOnlyTopics]);
    this.#rangeTopics = new Set(rangeTopics);
    this.#currentOnlyTopics = new Set(currentOnlyTopics);
    this.#rangeGeneration = generation;

    this.#series = this.#series.map((series) => {
      const topic = series.config.parsed.topicName;
      const wasHistoryProtected = previousTopics.has(topic);
      const isHistoryProtected = rangeTopics.has(topic) || currentOnlyTopics.has(topic);
      if (options?.resetAll === true || wasHistoryProtected || isHistoryProtected) {
        this.#pendingDispatch.push(
          { type: "reset-full", series: series.config.key },
          { type: "reset-current", series: series.config.key },
        );
        return {
          config: series.config,
          blockCursor: new BlockTopicCursor(topic),
        };
      }
      return series;
    });
  }

  /** Extracts and applies one bounded Player range batch before accepting another batch. */
  public async appendRangeMessageBatch(
    topic: string,
    events: Immutable<readonly MessageEvent[]>,
    startTime: Immutable<Time>,
    generation: number,
  ): Promise<boolean> {
    if (this.#destroyed || generation !== this.#rangeGeneration || !this.#rangeTopics.has(topic)) {
      return false;
    }

    let appended = false;
    for (const series of this.#series) {
      if (
        !series.config.enabled ||
        series.config.parsed.topicName !== topic ||
        !this.#rangeTopics.has(topic)
      ) {
        continue;
      }
      const mathFn = series.config.parsed.modifier
        ? mathFunctions[series.config.parsed.modifier]
        : undefined;
      const items = readMessagePathItems(
        events,
        series.config.parsed,
        series.config.timestampMethod,
        startTime,
        mathFn,
      );
      if (items.length === 0) {
        continue;
      }
      appended = true;
      this.#pendingDispatch.push({
        type: "append-full",
        series: series.config.key,
        items,
      });
    }

    const dispatch = this.#takePendingDispatch();
    if (dispatch.length > 0) {
      try {
        await this.#enqueueRemote(async () => {
          const { remote } = await this.#lifetime.leasePromise;
          await remote.applyActions(dispatch);
        });
      } catch (error) {
        if (!this.#lifetime.abortController.signal.aborted) {
          throw error;
        }
        return false;
      }
    }

    return (
      appended &&
      !this.#lifetime.abortController.signal.aborted &&
      generation === this.#rangeGeneration &&
      this.#rangeTopics.has(topic)
    );
  }

  public async getViewportDatasets(
    viewport: Immutable<Viewport>,
  ): Promise<GetViewportDatasetsResult> {
    if (this.#destroyed) {
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }

    const dispatch = this.#takePendingDispatch();
    const lifetime = this.#lifetime;

    let datasets;
    try {
      datasets = await this.#enqueueRemote(
        async () => await getViewportDatasets(lifetime.leasePromise, dispatch, viewport),
      );
    } catch (error) {
      if (!lifetime.abortController.signal.aborted) {
        throw error;
      }
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }
    if (lifetime.abortController.signal.aborted) {
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }
    datasets.forEach(restoreUnpackedDataAccessor);
    return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths: emptyPaths };
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    if (this.#destroyed) {
      return [];
    }
    const lifetime = this.#lifetime;
    let data;
    try {
      data = await this.#enqueueRemote(async () => await getCsvData(lifetime.leasePromise));
    } catch (error) {
      if (!lifetime.abortController.signal.aborted) {
        throw error;
      }
      return [];
    }
    return lifetime.abortController.signal.aborted ? [] : data;
  }

  public async getXRange(): Promise<Bounds1D | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    const lifetime = this.#lifetime;
    let range;
    try {
      range = await this.#enqueueRemote(async () => await getXRange(lifetime.leasePromise));
    } catch (error) {
      if (!lifetime.abortController.signal.aborted) {
        throw error;
      }
      return undefined;
    }
    return lifetime.abortController.signal.aborted ? undefined : range;
  }

  #takePendingDispatch(): Immutable<UpdateDataAction>[] {
    const dispatch = this.#pendingDispatch;
    this.#pendingDispatch = [];
    return dispatch;
  }

  async #enqueueRemote<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#remoteQueue.then(operation);
    this.#remoteQueue = result.then(
      () => {},
      () => {},
    );
    return await trackOperation(this.#lifetime, result);
  }
}

async function getViewportDatasets(
  leasePromise: Promise<TimestampDatasetWorkerLease>,
  dispatch: Immutable<UpdateDataAction>[],
  viewport: Immutable<Viewport>,
) {
  const { remote } = await leasePromise;
  if (dispatch.length > 0) {
    await remote.applyActions(dispatch);
  }
  return await remote.getViewportDatasets(viewport);
}

async function getCsvData(leasePromise: Promise<TimestampDatasetWorkerLease>) {
  const { remote } = await leasePromise;
  return await remote.getCsvData();
}

async function getXRange(leasePromise: Promise<TimestampDatasetWorkerLease>) {
  const { remote } = await leasePromise;
  return await remote.getXRange();
}

async function trackOperation<T>(lifetime: BuilderLifetime, operation: Promise<T>): Promise<T> {
  lifetime.inFlight.add(operation);
  void operation.then(
    () => {
      lifetime.inFlight.delete(operation);
    },
    () => {
      lifetime.inFlight.delete(operation);
    },
  );
  return await operation;
}

async function destroyLifetime(lifetime: BuilderLifetime): Promise<void> {
  if (lifetime.destroyPromise != undefined) {
    await lifetime.destroyPromise;
    return;
  }

  lifetime.abortController.abort();
  lifetime.destroyPromise = (async () => {
    await Promise.allSettled([...lifetime.inFlight]);
    const lease = await lifetime.leasePromise.catch(() => undefined);
    await lease?.release();
  })();
  await lifetime.destroyPromise;
}

function readMessagePathItems(
  events: Immutable<MessageEvent[]>,
  path: Immutable<MessagePath>,
  timestampMethod: TimestampMethod,
  startTime: Immutable<Time>,
  mathFunction?: MathFunction,
): DataItem[] {
  const out = [];
  for (const event of events) {
    if (event.topic !== path.topicName) {
      continue;
    }

    const items = simpleGetMessagePathDataItems(event, path);
    for (const item of items) {
      if (!isChartValue(item)) {
        continue;
      }
      const chartValue = getChartValue(item);
      if (chartValue == undefined) {
        continue;
      }

      const headerStamp = getTimestampForMessage(event.message);
      const timestamp = timestampMethod === "receiveTime" ? event.receiveTime : headerStamp;
      if (!timestamp) {
        continue;
      }

      const xValue = toSec(subtractTime(timestamp, startTime));
      const mathModified = mathFunction ? mathFunction(chartValue) : chartValue;
      out.push({
        x: xValue,
        y: mathModified,
        receiveTime: event.receiveTime,
        headerStamp,
        value: mathFunction ? mathModified : toOwnedChartValue(item),
      });
    }
  }

  return out;
}
