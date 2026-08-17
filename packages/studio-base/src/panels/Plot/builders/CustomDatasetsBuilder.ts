// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import race from "race-as-promised";

import { transferTypedArrays } from "@foxglove/den/worker";
import Logger from "@foxglove/log";
import { MessagePath } from "@foxglove/message-path";
import { Immutable, MessageEvent, Time } from "@foxglove/studio";
import { simpleGetMessagePathDataItems } from "@foxglove/studio-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import {
  acquireCustomDatasetsBuilder,
  CustomDatasetWorkerLease,
} from "@foxglove/studio-base/panels/shared/DatasetWorkerPool";
import { PlayerState } from "@foxglove/studio-base/players/types";
import { Bounds1D, extendBounds1D, unionBounds1D } from "@foxglove/studio-base/types/Bounds";

import { BlockTopicCursor } from "./BlockTopicCursor";
import { UpdateDataAction } from "./CustomDatasetsBuilderImpl";
import { encodeNumericItems, encodeValueItems, ValueItem } from "./CustomValueStore";
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
import { restoreUnpackedDataAccessor } from "../PackedDataset";
import { getChartValue, isChartValue } from "../datum";
import { MathFunction, mathFunctions } from "../mathFunctions";

export type { ValueItem } from "./CustomValueStore";

const log = Logger.getLogger(__filename);
const emptyPaths = new Set<string>();

type CustomDatasetsSeriesItem = {
  config: Immutable<SeriesItem>;
  blockCursor: BlockTopicCursor;
};

type XBoundsMutation =
  | { bounds: Bounds1D; revision: number; store: "current" | "full"; type: "append" }
  | { revision: number; store: "current" | "full" | "both"; type: "reset" };

type BuilderLifetime = {
  abortController: AbortController;
  abortPromise: Promise<never>;
  destroyPromise?: Promise<void>;
  fail: (error: Error) => boolean;
  failure?: Error;
  failurePromise: Promise<never>;
  leasePromise: Promise<CustomDatasetWorkerLease>;
  physicalFailure: boolean;
  releasePromise?: Promise<void>;
  reportError: (error: Error) => void;
};

// The held lifetime contains only worker resources and never points back to its builder.
const registry = new FinalizationRegistry<BuilderLifetime>((lifetime) => {
  void destroyLifetime(lifetime).catch((error: unknown) => {
    log.error("[CustomDatasetsBuilder] Failed to finalize worker session", error);
  });
});

type AcquireWorker = typeof acquireCustomDatasetsBuilder;

export class CustomDatasetsBuilder implements IDatasetsBuilder {
  #xParsedPath?: Immutable<MessagePath>;
  #xValuesCursor?: BlockTopicCursor;
  #pendingDispatch: Immutable<UpdateDataAction>[] = [];
  #remoteQueue: Promise<void> = Promise.resolve();
  #lastSeekTime = 0;
  #series: Immutable<CustomDatasetsSeriesItem[]> = [];
  #xBoundsRevision = 0;
  #xBoundsMutations: XBoundsMutation[] = [];
  #xSynchronizedBounds?: Bounds1D;
  #xCurrentBounds?: Bounds1D;
  #xFullBounds?: Bounds1D;
  #rangeGeneration = 0;
  #rangeTopics = new Set<string>();
  #currentOnlyTopics = new Set<string>();
  #lifetime: BuilderLifetime;
  #destroyed = false;

  public constructor({
    acquireWorker = acquireCustomDatasetsBuilder,
    handleWorkerError,
  }: {
    /** Intended for focused lifecycle tests. */
    acquireWorker?: AcquireWorker;
    handleWorkerError?: (event: Event) => void;
  } = {}) {
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

    let rejectFailure!: (error: Error) => void;
    const failurePromise = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject;
    });
    void failurePromise.catch(() => undefined);

    const lifetime: BuilderLifetime = {
      abortController,
      abortPromise,
      fail: (error) => {
        if (lifetime.failure != undefined) {
          return false;
        }
        lifetime.failure = error;
        rejectFailure(error);
        return true;
      },
      failurePromise,
      leasePromise: undefined as unknown as Promise<CustomDatasetWorkerLease>,
      physicalFailure: false,
      reportError: (error) => {
        log.error("[CustomDatasetsBuilder] Dataset worker session failed", error);
        try {
          handleWorkerError?.(makeErrorEvent(error));
        } catch (handlerError) {
          log.error("[CustomDatasetsBuilder] Worker error handler failed", handlerError);
        }
      },
    };
    lifetime.leasePromise = acquireWorker({
      handleWorkerError: (event) => {
        lifetime.physicalFailure = true;
        const error = new Error("Custom Dataset worker failed", { cause: event });
        const isFirstFailure = lifetime.fail(error);
        log.error("[CustomDatasetsBuilder] Worker error:", event);
        if (isFirstFailure) {
          try {
            handleWorkerError?.(event);
          } catch (handlerError) {
            log.error("[CustomDatasetsBuilder] Worker error handler failed", handlerError);
          }
        }
      },
      signal: abortController.signal,
    });
    this.#lifetime = lifetime;

    void lifetime.leasePromise.catch((error: unknown) => {
      if (isLifetimeAborted(lifetime)) {
        return;
      }
      const normalized = normalizeError(error, "Failed to create Dataset worker session");
      if (lifetime.fail(normalized)) {
        lifetime.reportError(normalized);
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
    void destroyLifetime(this.#lifetime).catch((error: unknown) => {
      log.error("[CustomDatasetsBuilder] Failed to destroy worker session", error);
    });
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
    if (didSeek) {
      if (this.#xParsedPath && !this.#rangeTopics.has(this.#xParsedPath.topicName)) {
        this.#pendingDispatch.push({ type: "reset-current-x" });
        this.#recordXReset("current");
      }
      for (const series of this.#series) {
        if (!this.#rangeTopics.has(series.config.parsed.topicName)) {
          this.#pendingDispatch.push({ type: "reset-current", series: series.config.key });
        }
      }
    }

    const msgEvents = activeData.messages;
    if (msgEvents.length > 0) {
      if (this.#xParsedPath && !this.#rangeTopics.has(this.#xParsedPath.topicName)) {
        const items = readMessagePathItems(
          msgEvents,
          this.#xParsedPath,
          getMathFn(this.#xParsedPath),
        );
        this.#pendingDispatch.push({ type: "append-current-x", items: encodeNumericItems(items) });
        this.#recordXAppend("current", items);
      }

      for (const series of this.#series) {
        if (!series.config.enabled || this.#rangeTopics.has(series.config.parsed.topicName)) {
          continue;
        }
        const items = readMessagePathItems(
          msgEvents,
          series.config.parsed,
          getMathFn(series.config.parsed),
        );
        this.#pendingDispatch.push({
          type: "append-current",
          series: series.config.key,
          items: encodeValueItems(items),
        });
      }
    }

    const blocks = state.progress.messageCache?.blocks;
    if (blocks) {
      const xTopic = this.#xParsedPath?.topicName;
      if (
        this.#xValuesCursor &&
        this.#xParsedPath &&
        xTopic != undefined &&
        !this.#rangeTopics.has(xTopic) &&
        !this.#currentOnlyTopics.has(xTopic)
      ) {
        if (this.#xValuesCursor.nextWillReset(blocks)) {
          this.#pendingDispatch.push({ type: "reset-full-x" });
          this.#recordXReset("full");
        }
        let messageEvents;
        while ((messageEvents = this.#xValuesCursor.next(blocks)) != undefined) {
          const items = readMessagePathItems(
            messageEvents,
            this.#xParsedPath,
            getMathFn(this.#xParsedPath),
          );
          this.#pendingDispatch.push({ type: "append-full-x", items: encodeNumericItems(items) });
          this.#recordXAppend("full", items);
        }
      }

      for (const series of this.#series) {
        const topic = series.config.parsed.topicName;
        if (
          !series.config.enabled ||
          this.#rangeTopics.has(topic) ||
          this.#currentOnlyTopics.has(topic)
        ) {
          continue;
        }
        if (series.blockCursor.nextWillReset(blocks)) {
          this.#pendingDispatch.push({ type: "reset-full", series: series.config.key });
        }
        let messageEvents;
        while ((messageEvents = series.blockCursor.next(blocks)) != undefined) {
          const items = readMessagePathItems(
            messageEvents,
            series.config.parsed,
            getMathFn(series.config.parsed),
          );
          this.#pendingDispatch.push({
            type: "append-full",
            series: series.config.key,
            items: encodeValueItems(items),
          });
        }
      }
    }

    return combineBounds(this.#xSynchronizedBounds, this.#xFullBounds, this.#xCurrentBounds);
  }

  public setXPath(path: Immutable<MessagePath> | undefined): void {
    if (this.#destroyed || JSON.stringify(path) === JSON.stringify(this.#xParsedPath)) {
      return;
    }
    this.#xParsedPath = path;
    this.#xValuesCursor = path ? new BlockTopicCursor(path.topicName) : undefined;
    this.#recordXReset("both");
    this.#pendingDispatch.push({ type: "reset-current-x" }, { type: "reset-full-x" });
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    if (this.#destroyed) {
      return;
    }
    this.#series = series.map((item) => {
      const existing = this.#series.find((existingItem) => existingItem.config.key === item.key);
      return {
        config: item,
        blockCursor:
          existing?.config.parsed.topicName === item.parsed.topicName
            ? existing.blockCursor
            : new BlockTopicCursor(item.parsed.topicName),
      };
    });
    this.#pendingDispatch.push({ type: "update-series-config", seriesItems: series });
  }

  /** Assigns replay-range and live current-only ownership for each source topic. */
  public setHistoryTopics(
    rangeTopics: ReadonlySet<string>,
    currentOnlyTopics: ReadonlySet<string>,
    generation: number,
    options: { resetAll?: boolean } = {},
  ): void {
    if (this.#destroyed) {
      return;
    }
    const previousRangeTopics = this.#rangeTopics;
    const previousCurrentOnlyTopics = this.#currentOnlyTopics;
    this.#rangeTopics = new Set(rangeTopics);
    this.#currentOnlyTopics = new Set(currentOnlyTopics);
    this.#rangeGeneration = generation;
    const resetAll = options.resetAll === true;

    const xTopic = this.#xParsedPath?.topicName;
    if (
      xTopic != undefined &&
      (resetAll ||
        getHistoryOwnership(xTopic, previousRangeTopics, previousCurrentOnlyTopics) !==
          getHistoryOwnership(xTopic, rangeTopics, currentOnlyTopics))
    ) {
      this.#pendingDispatch.push({ type: "reset-full-x" }, { type: "reset-current-x" });
      this.#xValuesCursor = new BlockTopicCursor(xTopic);
      this.#recordXReset("both");
    }

    this.#series = this.#series.map((series) => {
      const topic = series.config.parsed.topicName;
      if (
        resetAll ||
        getHistoryOwnership(topic, previousRangeTopics, previousCurrentOnlyTopics) !==
          getHistoryOwnership(topic, rangeTopics, currentOnlyTopics)
      ) {
        this.#pendingDispatch.push(
          { type: "reset-full", series: series.config.key },
          { type: "reset-current", series: series.config.key },
        );
        return { config: series.config, blockCursor: new BlockTopicCursor(topic) };
      }
      return series;
    });
  }

  /** Clears one replacement iterator's topic without disturbing other active range topics. */
  public async resetRangeTopic(topic: string, generation: number): Promise<boolean> {
    if (this.#destroyed || generation !== this.#rangeGeneration || !this.#rangeTopics.has(topic)) {
      return false;
    }

    const ownershipDispatch = this.#takePendingDispatch();
    try {
      return await this.#enqueueRemote(async (remote) => {
        if (ownershipDispatch.length > 0) {
          await remote.updateData(transferTypedArrays(ownershipDispatch));
        }
        if (
          generation !== this.#rangeGeneration ||
          !this.#rangeTopics.has(topic) ||
          this.#lifetime.abortController.signal.aborted
        ) {
          return false;
        }

        const resets = this.#getTopicResetActions(topic);
        if (resets.length > 0) {
          await remote.updateData(transferTypedArrays(resets));
        }
        if (this.#xParsedPath?.topicName === topic) {
          this.#recordXReset("both");
          const xBoundsRevision = this.#xBoundsRevision;
          const range = await remote.getXRange();
          this.#synchronizeXRange(range, xBoundsRevision);
        }
        return generation === this.#rangeGeneration && this.#rangeTopics.has(topic);
      });
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return false;
    }
  }

  /** Releases only a failed range topic so legacy full-history fallback can take ownership. */
  public async releaseRangeTopic(topic: string, generation: number): Promise<boolean> {
    if (this.#destroyed || generation !== this.#rangeGeneration || !this.#rangeTopics.has(topic)) {
      return false;
    }

    const ownershipDispatch = this.#takePendingDispatch();
    try {
      return await this.#enqueueRemote(async (remote) => {
        if (ownershipDispatch.length > 0) {
          await remote.updateData(transferTypedArrays(ownershipDispatch));
        }
        if (
          generation !== this.#rangeGeneration ||
          !this.#rangeTopics.has(topic) ||
          this.#lifetime.abortController.signal.aborted
        ) {
          return false;
        }

        this.#rangeTopics.delete(topic);
        const resets = this.#getTopicResetActions(topic);
        let xBoundsRevision: number | undefined;
        if (this.#xParsedPath?.topicName === topic) {
          this.#xValuesCursor = new BlockTopicCursor(topic);
          this.#recordXReset("both");
          // Player updates can arrive while the reset RPC is in flight. Only the reset itself is
          // flushed here; preserve every later bounds mutation until its pending action is sent.
          xBoundsRevision = this.#xBoundsRevision;
        }
        this.#series = this.#series.map((series) =>
          series.config.parsed.topicName === topic
            ? { config: series.config, blockCursor: new BlockTopicCursor(topic) }
            : series,
        );
        if (resets.length > 0) {
          await remote.updateData(transferTypedArrays(resets));
        }
        if (xBoundsRevision != undefined) {
          const range = await remote.getXRange();
          this.#synchronizeXRange(range, xBoundsRevision);
        }
        return generation === this.#rangeGeneration && !this.#rangeTopics.has(topic);
      });
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return false;
    }
  }

  /** Extracts x and every matching y path, then waits until the worker has stored the batch. */
  public async appendRangeMessageBatch(
    topic: string,
    events: Immutable<readonly MessageEvent[]>,
    _startTime: Immutable<Time>,
    generation: number,
  ): Promise<boolean> {
    if (this.#destroyed || generation !== this.#rangeGeneration || !this.#rangeTopics.has(topic)) {
      return false;
    }
    const pendingDispatch = this.#takePendingDispatch();
    const rangeDispatch: Immutable<UpdateDataAction>[] = [];
    const topicEvents = events.filter((event) => event.topic === topic);
    let appended = false;
    let appendedXBounds: Bounds1D | undefined;
    if (this.#xParsedPath?.topicName === topic) {
      const items = readMessagePathItems(
        topicEvents,
        this.#xParsedPath,
        getMathFn(this.#xParsedPath),
        "singleTopic",
      );
      if (items.length > 0) {
        appended = true;
        appendedXBounds = computeBounds(undefined, items);
        rangeDispatch.push({ type: "append-full-x", items: encodeNumericItems(items) });
      }
    }
    for (const series of this.#series) {
      if (!series.config.enabled || series.config.parsed.topicName !== topic) {
        continue;
      }
      const items = readMessagePathItems(
        topicEvents,
        series.config.parsed,
        getMathFn(series.config.parsed),
        "singleTopic",
      );
      if (items.length > 0) {
        appended = true;
        rangeDispatch.push({
          type: "append-full",
          series: series.config.key,
          items: encodeValueItems(items),
        });
      }
    }

    try {
      const accepted = await this.#enqueueRemote(async (remote) => {
        if (pendingDispatch.length > 0) {
          await remote.updateData(transferTypedArrays(pendingDispatch));
        }
        if (
          this.#lifetime.abortController.signal.aborted ||
          generation !== this.#rangeGeneration ||
          !this.#rangeTopics.has(topic)
        ) {
          return false;
        }
        if (rangeDispatch.length > 0) {
          await remote.updateData(transferTypedArrays(rangeDispatch));
        }
        return true;
      });
      if (accepted && appendedXBounds != undefined && generation === this.#rangeGeneration) {
        this.#recordXAppendBounds("full", appendedXBounds);
      }
      return accepted && appended && generation === this.#rangeGeneration;
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return false;
    }
  }

  public async getViewportDatasets(
    viewport: Immutable<Viewport>,
  ): Promise<GetViewportDatasetsResult> {
    if (this.#destroyed) {
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }
    const dispatch = this.#takePendingDispatch();
    const xBoundsRevision = this.#xBoundsRevision;
    let result: GetViewportDatasetsResult;
    try {
      const response = await this.#enqueueRemote(async (remote) => {
        if (dispatch.length > 0) {
          await remote.updateData(transferTypedArrays(dispatch));
        }
        const datasets = await remote.getViewportDatasets(viewport);
        const xRange = await remote.getXRange();
        return { datasets, xRange };
      });
      result = response.datasets;
      this.#synchronizeXRange(response.xRange, xBoundsRevision);
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }
    if (this.#lifetime.abortController.signal.aborted) {
      return { datasetsByConfigIndex: [], pathsWithMismatchedDataLengths: emptyPaths };
    }
    result.datasetsByConfigIndex.forEach((dataset) => {
      if (dataset) {
        restoreUnpackedDataAccessor(dataset);
      }
    });
    result.datasetRange = combineBounds(
      this.#xSynchronizedBounds,
      this.#xFullBounds,
      this.#xCurrentBounds,
    );
    return result;
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    if (this.#destroyed) {
      return [];
    }
    const dispatch = this.#takePendingDispatch();
    const xBoundsRevision = this.#xBoundsRevision;
    try {
      const response = await this.#enqueueRemote(async (remote) => {
        if (dispatch.length > 0) {
          await remote.updateData(transferTypedArrays(dispatch));
        }
        const data = await remote.getCsvData();
        const xRange = await remote.getXRange();
        return { data, xRange };
      });
      this.#synchronizeXRange(response.xRange, xBoundsRevision);
      return this.#lifetime.abortController.signal.aborted ? [] : response.data;
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return [];
    }
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
    const xBoundsRevision = this.#xBoundsRevision;
    let callbackFailure: { error: unknown } | undefined;
    let response: { completed: boolean; xRange: Bounds1D };
    try {
      response = await this.#enqueueRemote(async (remote) => {
        if (dispatch.length > 0) {
          await remote.updateData(transferTypedArrays(dispatch));
        }

        let completed = true;
        let cursor: CsvDataCursor | undefined;
        do {
          if (isLifetimeAborted(this.#lifetime)) {
            completed = false;
            break;
          }
          const chunk = await remote.getCsvDataChunk(cursor, chunkSize);
          if (isLifetimeAborted(this.#lifetime)) {
            completed = false;
            break;
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
          if (datumCount > 0) {
            try {
              if ((await callback(chunk.datasets)) === false) {
                completed = false;
                break;
              }
            } catch (error) {
              callbackFailure = { error };
              completed = false;
              break;
            }
          }
          cursor = chunk.nextCursor;
        } while (cursor != undefined);

        const xRange = await remote.getXRange();
        return { completed, xRange };
      });
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return false;
    }
    this.#synchronizeXRange(response.xRange, xBoundsRevision);
    if (callbackFailure != undefined) {
      throw callbackFailure.error;
    }
    return !this.#lifetime.abortController.signal.aborted && response.completed;
  }

  public async getXRange(): Promise<Bounds1D | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    const dispatch = this.#takePendingDispatch();
    const xBoundsRevision = this.#xBoundsRevision;
    try {
      const range = await this.#enqueueRemote(async (remote) => {
        if (dispatch.length > 0) {
          await remote.updateData(transferTypedArrays(dispatch));
        }
        return await remote.getXRange();
      });
      this.#synchronizeXRange(range, xBoundsRevision);
      return combineBounds(this.#xSynchronizedBounds, this.#xFullBounds, this.#xCurrentBounds);
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return undefined;
    }
  }

  #takePendingDispatch(): Immutable<UpdateDataAction>[] {
    const dispatch = this.#pendingDispatch;
    this.#pendingDispatch = [];
    return dispatch;
  }

  #getTopicResetActions(topic: string): Immutable<UpdateDataAction>[] {
    const resets: Immutable<UpdateDataAction>[] = [];
    if (this.#xParsedPath?.topicName === topic) {
      resets.push({ type: "reset-full-x" }, { type: "reset-current-x" });
    }
    for (const series of this.#series) {
      if (series.config.parsed.topicName === topic) {
        resets.push(
          { type: "reset-full", series: series.config.key },
          { type: "reset-current", series: series.config.key },
        );
      }
    }
    return resets;
  }

  #synchronizeXRange(range: Immutable<Bounds1D>, flushedRevision: number): void {
    this.#xSynchronizedBounds = { ...range };
    this.#xBoundsMutations = this.#xBoundsMutations.filter(
      (mutation) => mutation.revision > flushedRevision,
    );
    this.#xFullBounds = undefined;
    this.#xCurrentBounds = undefined;
    for (const mutation of this.#xBoundsMutations) {
      this.#applyXBoundsMutation(mutation);
    }
  }

  #recordXAppend(store: "current" | "full", items: Immutable<ValueItem[]>): void {
    const bounds = computeBounds(undefined, items);
    if (bounds != undefined) {
      this.#recordXAppendBounds(store, bounds);
    }
  }

  #recordXAppendBounds(store: "current" | "full", bounds: Bounds1D): void {
    const mutation = {
      bounds,
      revision: ++this.#xBoundsRevision,
      store,
      type: "append",
    } satisfies XBoundsMutation;
    this.#xBoundsMutations.push(mutation);
    this.#applyXBoundsMutation(mutation);
  }

  #recordXReset(store: "current" | "full" | "both"): void {
    const mutation = {
      revision: ++this.#xBoundsRevision,
      store,
      type: "reset",
    } satisfies XBoundsMutation;
    this.#xBoundsMutations.push(mutation);
    this.#applyXBoundsMutation(mutation);
  }

  #applyXBoundsMutation(mutation: XBoundsMutation): void {
    if (mutation.type === "reset") {
      if (mutation.store === "both") {
        this.#xSynchronizedBounds = undefined;
        this.#xFullBounds = undefined;
        this.#xCurrentBounds = undefined;
      } else if (mutation.store === "full") {
        this.#xFullBounds = undefined;
      } else {
        this.#xCurrentBounds = undefined;
      }
      return;
    }

    if (mutation.store === "full") {
      this.#xFullBounds = this.#xFullBounds
        ? unionBounds1D(this.#xFullBounds, mutation.bounds)
        : { ...mutation.bounds };
    } else {
      this.#xCurrentBounds = this.#xCurrentBounds
        ? unionBounds1D(this.#xCurrentBounds, mutation.bounds)
        : { ...mutation.bounds };
    }
  }

  async #enqueueRemote<T>(
    operation: (remote: CustomDatasetWorkerLease["remote"]) => Promise<T>,
  ): Promise<T> {
    const lifetime = this.#lifetime;
    if (lifetime.abortController.signal.aborted) {
      throw makeAbortError();
    }
    const existingFailure = lifetime.failure;
    if (existingFailure != undefined) {
      throw existingFailure;
    }

    const result = this.#remoteQueue.then(async () => {
      if (lifetime.abortController.signal.aborted) {
        throw makeAbortError();
      }
      const queuedFailure = lifetime.failure;
      if (queuedFailure != undefined) {
        throw queuedFailure;
      }
      return await runRemote(lifetime, async () => {
        const { remote } = await lifetime.leasePromise;
        return await operation(remote);
      });
    });
    this.#remoteQueue = result.then(
      () => {},
      () => {},
    );
    try {
      return await result;
    } catch (error) {
      if (isLifetimeAborted(lifetime)) {
        throw makeAbortError();
      }
      const failure = lifetime.failure;
      if (failure != undefined) {
        throw failure;
      }
      const normalized = normalizeError(error, "Custom Dataset worker operation failed");
      if (lifetime.fail(normalized)) {
        lifetime.reportError(normalized);
      }
      void releaseLifetime(lifetime, { broken: lifetime.physicalFailure }).catch(
        (releaseError: unknown) => {
          log.error("[CustomDatasetsBuilder] Failed to release failed session", releaseError);
        },
      );
      throw normalized;
    }
  }
}

async function runRemote<T>(lifetime: BuilderLifetime, operation: () => Promise<T>): Promise<T> {
  const operationPromise = Promise.resolve().then(operation);
  return await race([operationPromise, lifetime.failurePromise, lifetime.abortPromise]);
}

async function destroyLifetime(lifetime: BuilderLifetime): Promise<void> {
  if (lifetime.destroyPromise != undefined) {
    await lifetime.destroyPromise;
    return;
  }
  lifetime.abortController.abort();
  // Do not wait for a hung application RPC. Releasing this child endpoint leaves healthy
  // co-tenants on the same physical worker untouched; a real Worker error retires the host.
  lifetime.destroyPromise = releaseLifetime(lifetime, { broken: lifetime.physicalFailure });
  await lifetime.destroyPromise;
}

async function releaseLifetime(
  lifetime: BuilderLifetime,
  options: { broken: boolean },
): Promise<void> {
  lifetime.releasePromise ??= (async () => {
    const lease = await lifetime.leasePromise.catch(() => undefined);
    await lease?.release(options);
  })();
  await lifetime.releasePromise;
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isLifetimeAborted(lifetime: BuilderLifetime): boolean {
  return lifetime.abortController.signal.aborted;
}

function makeErrorEvent(error: Error): Event {
  if (typeof ErrorEvent !== "undefined") {
    return new ErrorEvent("error", { error, message: error.message });
  }
  return new Event("error");
}

function normalizeError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
}

function readMessagePathItems(
  events: Immutable<readonly MessageEvent[]>,
  path: Immutable<MessagePath>,
  mathFunction?: MathFunction,
  eventScope: "allTopics" | "singleTopic" = "allTopics",
): ValueItem[] {
  const out: ValueItem[] = [];
  for (const event of events) {
    if (eventScope === "allTopics" && event.topic !== path.topicName) {
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
      const mathModified = mathFunction ? mathFunction(chartValue) : chartValue;
      out.push({
        value: mathModified,
        originalValue: mathFunction ? mathModified : item,
        receiveTime: event.receiveTime,
      });
    }
  }
  return out;
}

function getMathFn(path: Immutable<MessagePath>): MathFunction | undefined {
  return path.modifier ? mathFunctions[path.modifier] : undefined;
}

function getHistoryOwnership(
  topic: string,
  rangeTopics: ReadonlySet<string>,
  currentOnlyTopics: ReadonlySet<string>,
): "current" | "none" | "range" {
  return rangeTopics.has(topic) ? "range" : currentOnlyTopics.has(topic) ? "current" : "none";
}

function computeBounds(
  currentBounds: Immutable<Bounds1D> | undefined,
  items: Immutable<ValueItem[]>,
): Bounds1D | undefined {
  const itemBounds: Bounds1D = { min: Infinity, max: -Infinity };
  for (const item of items) {
    if (Number.isFinite(item.value)) {
      extendBounds1D(itemBounds, item.value);
    }
  }
  if (!Number.isFinite(itemBounds.min) || !Number.isFinite(itemBounds.max)) {
    return currentBounds ? { ...currentBounds } : undefined;
  }
  return currentBounds ? unionBounds1D(currentBounds, itemBounds) : itemBounds;
}

function combineBounds(...bounds: (Immutable<Bounds1D> | undefined)[]): Bounds1D {
  let combined: Bounds1D | undefined;
  for (const item of bounds) {
    if (item != undefined) {
      combined = combined ? unionBounds1D(combined, item) : { ...item };
    }
  }
  return combined ?? { min: 0, max: 1 };
}
