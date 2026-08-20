// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";

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
  CsvDataChunkCallback,
  CsvDataCursor,
  CsvDataset,
  GetViewportDatasetsResult,
  IDatasetsBuilder,
  MAX_CSV_DATUMS_PER_CHUNK,
  normalizeCsvChunkSize,
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
  abortPromise: Promise<never>;
  destroyPromise?: Promise<void>;
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
  #playerId?: string;

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
    let rejectAbort!: (error: Error) => void;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    void abortPromise.catch(() => undefined);
    abortController.signal.addEventListener(
      "abort",
      () => {
        rejectAbort(makeAbortError());
      },
      { once: true },
    );
    const lifetime = {
      abortController,
      abortPromise,
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
    const sourceChanged = this.#playerId != undefined && this.#playerId !== state.playerId;
    this.#playerId = state.playerId;
    const activeData = state.activeData;
    if (!activeData) {
      if (sourceChanged) {
        this.#resetForSourceChange();
      }
      return;
    }

    const didSeek = sourceChanged || activeData.lastSeekTime !== this.#lastSeekTime;
    this.#lastSeekTime = activeData.lastSeekTime;

    const msgEvents = activeData.messages;
    if (didSeek) {
      // Reset disabled series too: enabling one after a discontinuity must not reveal a stale
      // current frame. A source switch also clears full history immediately, before the range
      // ownership effect can issue its resetAll update.
      if (sourceChanged) {
        this.#resetForSourceChange();
      } else {
        for (const series of this.#series) {
          this.#pendingDispatch.push({
            type: "reset-playback-head",
            series: series.config.key,
          });
          if (!series.config.enabled || !this.#rangeTopics.has(series.config.parsed.topicName)) {
            this.#pendingDispatch.push({
              type: "reset-current",
              series: series.config.key,
            });
          }
        }
      }
    }

    if (msgEvents.length > 0) {
      for (const series of this.#series) {
        const mathFn = series.config.parsed.modifier
          ? mathFunctions[series.config.parsed.modifier]
          : undefined;

        const pathItems = readMessagePathItems(
          msgEvents,
          series.config.parsed,
          series.config.timestampMethod,
          activeData.startTime,
          mathFn,
        );

        this.#pendingDispatch.push({
          type: !series.config.enabled
            ? "append-legend"
            : this.#rangeTopics.has(series.config.parsed.topicName)
              ? "append-playback-head"
              : "append-current",
          series: series.config.key,
          items: pathItems,
        });
      }
    }

    return { min: 0, max: toSec(subtractTime(activeData.endTime, activeData.startTime)) };
  }

  #resetForSourceChange(): void {
    this.#series = this.#series.map((series) => {
      this.#pendingDispatch.push({
        type: "reset-playback-head",
        series: series.config.key,
      });
      this.#pendingDispatch.push(
        { type: "reset-full", series: series.config.key },
        { type: "reset-current", series: series.config.key },
      );
      return {
        config: series.config,
        blockCursor: new BlockTopicCursor(series.config.parsed.topicName),
      };
    });
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
   * Assigns history ownership for replay ranges and live current-only topics. Source resets and
   * ownership-mode transitions clear storage; unchanged live topics retain their bounded window,
   * while initial/replacement range iterators reset their own topic before replay.
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

    const previousRangeTopics = this.#rangeTopics;
    const previousCurrentOnlyTopics = this.#currentOnlyTopics;
    this.#rangeTopics = new Set(rangeTopics);
    this.#currentOnlyTopics = new Set(currentOnlyTopics);
    this.#rangeGeneration = generation;

    this.#series = this.#series.map((series) => {
      const topic = series.config.parsed.topicName;
      const ownershipChanged =
        getHistoryOwnership(topic, previousRangeTopics, previousCurrentOnlyTopics) !==
        getHistoryOwnership(topic, rangeTopics, currentOnlyTopics);
      if (options?.resetAll === true || ownershipChanged) {
        this.#pendingDispatch.push(
          { type: "reset-full", series: series.config.key },
          { type: "reset-current", series: series.config.key },
          { type: "reset-playback-head", series: series.config.key },
        );
        return {
          config: series.config,
          blockCursor: new BlockTopicCursor(topic),
        };
      }
      return series;
    });
  }

  /** Clear one topic before an initial or replacement range iterator replays it. */
  public async resetRangeTopic(topic: string, generation: number): Promise<boolean> {
    if (
      this.#destroyed ||
      this.#xAxisMode !== "timestamp" ||
      generation !== this.#rangeGeneration ||
      !this.#rangeTopics.has(topic)
    ) {
      return false;
    }
    return await this.#resetTopicStorage(topic, generation, "range");
  }

  /** Release one failed range topic so its full-preload block subscription can take ownership. */
  public async releaseRangeTopic(topic: string, generation: number): Promise<boolean> {
    if (
      this.#destroyed ||
      this.#xAxisMode !== "timestamp" ||
      generation !== this.#rangeGeneration ||
      !this.#rangeTopics.delete(topic)
    ) {
      return false;
    }
    return await this.#resetTopicStorage(topic, generation, "released");
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
    currentValuesAt?: Immutable<Time>,
  ): Promise<GetViewportDatasetsResult> {
    if (this.#destroyed) {
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }

    const dispatch = this.#takePendingDispatch();
    const lifetime = this.#lifetime;

    let response;
    try {
      response = await this.#enqueueRemote(
        async () =>
          await getViewportDatasets(lifetime.leasePromise, dispatch, viewport, currentValuesAt),
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
    response.datasets.forEach(restoreUnpackedDataAccessor);
    return {
      datasetsByConfigIndex: response.datasets,
      pathsWithMismatchedDataLengths: emptyPaths,
      ...("currentValuesByConfigIndex" in response
        ? { currentValuesByConfigIndex: response.currentValuesByConfigIndex }
        : {}),
    };
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

  public async forEachCsvDataChunk(
    callback: CsvDataChunkCallback,
    maxDatums = MAX_CSV_DATUMS_PER_CHUNK,
  ): Promise<boolean> {
    if (this.#destroyed) {
      return false;
    }
    const chunkSize = normalizeCsvChunkSize(maxDatums);
    const dispatch = this.#takePendingDispatch();
    const lifetime = this.#lifetime;
    try {
      return await this.#enqueueRemote(async () => {
        const { remote } = await lifetime.leasePromise;
        if (isLifetimeAborted(lifetime)) {
          return false;
        }
        if (dispatch.length > 0) {
          await remote.applyActions(dispatch);
        }

        let cursor: CsvDataCursor | undefined;
        do {
          if (isLifetimeAborted(lifetime)) {
            return false;
          }
          const chunk = await remote.getCsvDataChunk(cursor, chunkSize);
          if (isLifetimeAborted(lifetime)) {
            return false;
          }
          const datumCount = chunk.datasets.reduce(
            (total, dataset) => total + dataset.data.length,
            0,
          );
          if (datumCount > chunkSize) {
            throw new Error("Dataset worker returned an oversized CSV chunk");
          }
          if (datumCount === 0 && chunk.nextCursor != undefined) {
            throw new Error("Dataset worker returned a CSV cursor without making progress");
          }
          if (datumCount > 0 && (await callback(chunk.datasets)) === false) {
            return false;
          }
          if (isLifetimeAborted(lifetime)) {
            return false;
          }
          cursor = chunk.nextCursor;
        } while (cursor != undefined);
        return !lifetime.abortController.signal.aborted;
      });
    } catch (error) {
      if (!lifetime.abortController.signal.aborted) {
        throw error;
      }
      return false;
    }
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

  async #resetTopicStorage(
    topic: string,
    generation: number,
    expectedOwnership: "range" | "released",
  ): Promise<boolean> {
    this.#series = this.#series.map((series) => {
      if (series.config.parsed.topicName !== topic) {
        return series;
      }
      this.#pendingDispatch.push(
        { type: "reset-full", series: series.config.key },
        { type: "reset-current", series: series.config.key },
      );
      if (expectedOwnership === "released") {
        this.#pendingDispatch.push({
          type: "reset-playback-head",
          series: series.config.key,
        });
      }
      return {
        config: series.config,
        blockCursor: new BlockTopicCursor(topic),
      };
    });

    const dispatch = this.#takePendingDispatch();
    try {
      await this.#enqueueRemote(async () => {
        const { remote } = await this.#lifetime.leasePromise;
        if (dispatch.length > 0) {
          await remote.applyActions(dispatch);
        }
      });
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return false;
    }

    return (
      !this.#lifetime.abortController.signal.aborted &&
      generation === this.#rangeGeneration &&
      (expectedOwnership === "range" ? this.#rangeTopics.has(topic) : !this.#rangeTopics.has(topic))
    );
  }

  #takePendingDispatch(): Immutable<UpdateDataAction>[] {
    const dispatch = this.#pendingDispatch;
    this.#pendingDispatch = [];
    return dispatch;
  }

  async #enqueueRemote<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#remoteQueue.then(async () => {
      if (this.#lifetime.abortController.signal.aborted) {
        throw new Error("Timestamp Dataset worker session was destroyed");
      }
      return await operation();
    });
    this.#remoteQueue = result.then(
      () => {},
      () => {},
    );
    return await race([result, this.#lifetime.abortPromise]);
  }
}

async function getViewportDatasets(
  leasePromise: Promise<TimestampDatasetWorkerLease>,
  dispatch: Immutable<UpdateDataAction>[],
  viewport: Immutable<Viewport>,
  currentValuesAt?: Immutable<Time>,
) {
  const { remote } = await leasePromise;
  if (dispatch.length > 0) {
    await remote.applyActions(dispatch);
  }
  if (currentValuesAt == undefined) {
    return { datasets: await remote.getViewportDatasets(viewport) };
  }
  return await remote.getViewportDatasetsWithCurrentValues(viewport, currentValuesAt);
}

async function getCsvData(leasePromise: Promise<TimestampDatasetWorkerLease>) {
  const { remote } = await leasePromise;
  return await remote.getCsvData();
}

async function getXRange(leasePromise: Promise<TimestampDatasetWorkerLease>) {
  const { remote } = await leasePromise;
  return await remote.getXRange();
}

async function destroyLifetime(lifetime: BuilderLifetime): Promise<void> {
  if (lifetime.destroyPromise != undefined) {
    await lifetime.destroyPromise;
    return;
  }

  lifetime.abortController.abort();
  lifetime.destroyPromise = (async () => {
    const lease = await lifetime.leasePromise.catch(() => undefined);
    await lease?.release();
  })();
  await lifetime.destroyPromise;
}

function isLifetimeAborted(lifetime: BuilderLifetime): boolean {
  return lifetime.abortController.signal.aborted;
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
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

function getHistoryOwnership(
  topic: string,
  rangeTopics: ReadonlySet<string>,
  currentOnlyTopics: ReadonlySet<string>,
): "current" | "none" | "range" {
  return rangeTopics.has(topic) ? "range" : currentOnlyTopics.has(topic) ? "current" : "none";
}
