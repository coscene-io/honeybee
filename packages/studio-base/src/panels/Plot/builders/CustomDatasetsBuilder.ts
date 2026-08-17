// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as Comlink from "@coscene-io/comlink";

import { ComlinkWrap, transferTypedArrays } from "@foxglove/den/worker";
import Logger from "@foxglove/log";
import { MessagePath } from "@foxglove/message-path";
import { Immutable, MessageEvent, Time } from "@foxglove/studio";
import { simpleGetMessagePathDataItems } from "@foxglove/studio-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { PlayerState } from "@foxglove/studio-base/players/types";
import { Bounds1D, extendBounds1D, unionBounds1D } from "@foxglove/studio-base/types/Bounds";

import { BlockTopicCursor } from "./BlockTopicCursor";
import { CustomDatasetsBuilderImpl, UpdateDataAction } from "./CustomDatasetsBuilderImpl";
import { encodeValueItems, ValueItem } from "./CustomValueStore";
import {
  CsvDataset,
  GetViewportDatasetsResult,
  IDatasetsBuilder,
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

type BuilderLifetime = {
  abortController: AbortController;
  destroyPromise?: Promise<void>;
  dispose: () => void;
  inFlight: Set<Promise<unknown>>;
};

// The held lifetime contains only worker resources and never points back to its builder.
const registry = new FinalizationRegistry<BuilderLifetime>((lifetime) => {
  void destroyLifetime(lifetime);
});

export class CustomDatasetsBuilder implements IDatasetsBuilder {
  #xParsedPath?: Immutable<MessagePath>;
  #xValuesCursor?: BlockTopicCursor;
  #datasetsBuilderRemote: Comlink.Remote<Comlink.RemoteObject<CustomDatasetsBuilderImpl>>;
  #pendingDispatch: Immutable<UpdateDataAction>[] = [];
  #remoteQueue: Promise<void> = Promise.resolve();
  #lastSeekTime = 0;
  #series: Immutable<CustomDatasetsSeriesItem[]> = [];
  #xCurrentBounds?: Bounds1D;
  #xFullBounds?: Bounds1D;
  #rangeGeneration = 0;
  #rangeTopics = new Set<string>();
  #currentOnlyTopics = new Set<string>();
  #lifetime: BuilderLifetime;
  #destroyed = false;

  public constructor({ handleWorkerError }: { handleWorkerError?: (event: Event) => void } = {}) {
    const worker = new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL("./CustomDatasetsBuilderImpl.worker", import.meta.url),
    );
    const { remote, dispose } =
      ComlinkWrap<Comlink.RemoteObject<CustomDatasetsBuilderImpl>>(worker);
    const lifetime = {
      abortController: new AbortController(),
      dispose,
      inFlight: new Set<Promise<unknown>>(),
    } satisfies BuilderLifetime;
    this.#lifetime = lifetime;
    this.#datasetsBuilderRemote = remote;

    worker.onerror = (event) => {
      log.error("[CustomDatasetsBuilder] Worker error:", event);
      handleWorkerError?.(event);
    };
    worker.onmessageerror = (event) => {
      log.error("[CustomDatasetsBuilder] Worker message error:", event);
      handleWorkerError?.(event);
    };
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
    if (didSeek) {
      if (this.#xParsedPath && !this.#rangeTopics.has(this.#xParsedPath.topicName)) {
        this.#pendingDispatch.push({ type: "reset-current-x" });
        this.#xCurrentBounds = undefined;
      }
      for (const series of this.#series) {
        if (series.config.enabled && !this.#rangeTopics.has(series.config.parsed.topicName)) {
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
        this.#pendingDispatch.push({ type: "append-current-x", items: encodeValueItems(items) });
        if (items.length > 0) {
          this.#xCurrentBounds = computeBounds(this.#xCurrentBounds, items);
        }
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
          this.#xFullBounds = undefined;
        }
        let messageEvents;
        while ((messageEvents = this.#xValuesCursor.next(blocks)) != undefined) {
          const items = readMessagePathItems(
            messageEvents,
            this.#xParsedPath,
            getMathFn(this.#xParsedPath),
          );
          this.#pendingDispatch.push({ type: "append-full-x", items: encodeValueItems(items) });
          if (items.length > 0) {
            this.#xFullBounds = computeBounds(this.#xFullBounds, items);
          }
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

    if (!this.#xCurrentBounds) {
      return this.#xFullBounds ?? { min: 0, max: 1 };
    }
    return this.#xFullBounds
      ? unionBounds1D(this.#xCurrentBounds, this.#xFullBounds)
      : this.#xCurrentBounds;
  }

  public setXPath(path: Immutable<MessagePath> | undefined): void {
    if (this.#destroyed || JSON.stringify(path) === JSON.stringify(this.#xParsedPath)) {
      return;
    }
    this.#xParsedPath = path;
    this.#xValuesCursor = path ? new BlockTopicCursor(path.topicName) : undefined;
    this.#xCurrentBounds = undefined;
    this.#xFullBounds = undefined;
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
    const previousTopics = new Set([...this.#rangeTopics, ...this.#currentOnlyTopics]);
    this.#rangeTopics = new Set(rangeTopics);
    this.#currentOnlyTopics = new Set(currentOnlyTopics);
    this.#rangeGeneration = generation;
    const resetAll = options.resetAll === true;

    const xTopic = this.#xParsedPath?.topicName;
    if (
      xTopic != undefined &&
      (resetAll ||
        previousTopics.has(xTopic) ||
        rangeTopics.has(xTopic) ||
        currentOnlyTopics.has(xTopic))
    ) {
      this.#pendingDispatch.push({ type: "reset-full-x" }, { type: "reset-current-x" });
      this.#xValuesCursor = new BlockTopicCursor(xTopic);
      this.#xFullBounds = undefined;
      this.#xCurrentBounds = undefined;
    }

    this.#series = this.#series.map((series) => {
      const topic = series.config.parsed.topicName;
      if (
        resetAll ||
        previousTopics.has(topic) ||
        rangeTopics.has(topic) ||
        currentOnlyTopics.has(topic)
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
    if (this.#xParsedPath?.topicName === topic) {
      const items = readMessagePathItems(
        topicEvents,
        this.#xParsedPath,
        getMathFn(this.#xParsedPath),
        "singleTopic",
      );
      if (items.length > 0) {
        appended = true;
        this.#xFullBounds = computeBounds(this.#xFullBounds, items);
        rangeDispatch.push({ type: "append-full-x", items: encodeValueItems(items) });
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
      const accepted = await this.#enqueueRemote(async () => {
        if (pendingDispatch.length > 0) {
          await this.#datasetsBuilderRemote.updateData(transferTypedArrays(pendingDispatch));
        }
        if (
          this.#lifetime.abortController.signal.aborted ||
          generation !== this.#rangeGeneration ||
          !this.#rangeTopics.has(topic)
        ) {
          return false;
        }
        if (rangeDispatch.length > 0) {
          await this.#datasetsBuilderRemote.updateData(transferTypedArrays(rangeDispatch));
        }
        return true;
      });
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
    let result;
    try {
      result = await this.#enqueueRemote(async () => {
        if (dispatch.length > 0) {
          await this.#datasetsBuilderRemote.updateData(transferTypedArrays(dispatch));
        }
        return await this.#datasetsBuilderRemote.getViewportDatasets(viewport);
      });
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
    return result;
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    if (this.#destroyed) {
      return [];
    }
    const dispatch = this.#takePendingDispatch();
    try {
      const data = await this.#enqueueRemote(async () => {
        if (dispatch.length > 0) {
          await this.#datasetsBuilderRemote.updateData(transferTypedArrays(dispatch));
        }
        return await this.#datasetsBuilderRemote.getCsvData();
      });
      return this.#lifetime.abortController.signal.aborted ? [] : data;
    } catch (error) {
      if (!this.#lifetime.abortController.signal.aborted) {
        throw error;
      }
      return [];
    }
  }

  public async getXRange(): Promise<Bounds1D | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    const dispatch = this.#takePendingDispatch();
    try {
      return await this.#enqueueRemote(async () => {
        if (dispatch.length > 0) {
          await this.#datasetsBuilderRemote.updateData(transferTypedArrays(dispatch));
        }
        return await this.#datasetsBuilderRemote.getXRange();
      });
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

  async #enqueueRemote<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#remoteQueue.then(operation);
    this.#remoteQueue = result.then(
      () => {},
      () => {},
    );
    return await trackOperation(this.#lifetime, result);
  }
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
  if (lifetime.destroyPromise) {
    await lifetime.destroyPromise;
    return;
  }
  lifetime.abortController.abort();
  lifetime.destroyPromise = (async () => {
    await Promise.allSettled([...lifetime.inFlight]);
    lifetime.dispose();
  })();
  await lifetime.destroyPromise;
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
