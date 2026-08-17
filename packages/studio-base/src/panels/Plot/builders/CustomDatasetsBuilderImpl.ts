// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { allocatePointBudgets } from "@foxglove/den/collection";
import { compare } from "@foxglove/rostime";
import { Immutable, Time } from "@foxglove/studio";
import {
  downsampleScatter,
  MAX_POINTS,
} from "@foxglove/studio-base/components/TimeBasedChart/downsample";
import { Bounds1D } from "@foxglove/studio-base/types/Bounds";

import {
  CompactNumericStore,
  CompactStoreBlockMetadata,
  CompactValueStore,
  CUSTOM_VALUE_STORE_BLOCK_SIZE,
  decodeBatchTime,
  NumericItemBatch,
  ValueItemBatch,
} from "./CustomValueStore";
import {
  CsvDataChunk,
  CsvDataCursor,
  CsvDataset,
  CsvDatum,
  GetViewportDatasetsResult,
  normalizeCsvChunkSize,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type { Dataset } from "../ChartRenderer";
import { attachUnpackedDataAccessor, PackedDatasetWriter } from "../PackedDataset";
import { OriginalValue } from "../datum";

export type { ValueItem } from "./CustomValueStore";

type Series = {
  config: Immutable<SeriesItem>;
  current: CompactValueStore;
  full: CompactValueStore;
  /** Exact current-frame values, independent of draw reconciliation and deduplication. */
  legendCurrent: CompactValueStore;
  /** Bounded current-frame values for range-owned replay topics; never rendered. */
  playbackHead: CompactValueStore;
};

type ResetSeriesFullAction = { type: "reset-full"; series: SeriesConfigKey };
type ResetSeriesCurrentAction = { type: "reset-current"; series: SeriesConfigKey };
type ResetSeriesPlaybackHeadAction = { type: "reset-playback-head"; series: SeriesConfigKey };
type ResetCurrentXAction = { type: "reset-current-x" };
type ResetFullXAction = { type: "reset-full-x" };
type UpdateCurrentXAction = { type: "append-current-x"; items: NumericItemBatch };
type UpdateFullXAction = { type: "append-full-x"; items: NumericItemBatch };
type UpdateSeriesCurrentAction = {
  type: "append-current";
  series: SeriesConfigKey;
  items: ValueItemBatch;
};
type UpdateSeriesFullAction = {
  type: "append-full";
  series: SeriesConfigKey;
  items: ValueItemBatch;
};
type UpdateSeriesPlaybackHeadAction = {
  type: "append-playback-head";
  series: SeriesConfigKey;
  items: ValueItemBatch;
};
type UpdateSeriesConfigAction = { type: "update-series-config"; seriesItems: SeriesItem[] };

export type UpdateDataAction =
  | UpdateSeriesConfigAction
  | ResetSeriesFullAction
  | ResetSeriesCurrentAction
  | ResetSeriesPlaybackHeadAction
  | ResetCurrentXAction
  | ResetFullXAction
  | UpdateCurrentXAction
  | UpdateFullXAction
  | UpdateSeriesCurrentAction
  | UpdateSeriesFullAction
  | UpdateSeriesPlaybackHeadAction;

export type CustomDatasetStorageStats = {
  x: {
    currentLength: number;
    currentCapacity: number;
    peakCurrentCapacity: number;
    currentSideTableEntries: number;
    fullLength: number;
  };
  series: Record<
    string,
    {
      currentLength: number;
      currentCapacity: number;
      peakCurrentCapacity: number;
      currentSideTableEntries: number;
      fullLength: number;
    }
  >;
};

export type CustomDatasetQueryStats = {
  totalPoints: number;
  totalBlocks: number;
  metadataBlocksInspected: number;
  scannedBlocks: number;
  scannedPoints: number;
};

export type CustomLegendStorageStats = Record<
  string,
  {
    currentCapacity: number;
    currentLength: number;
    peakCurrentCapacity: number;
    playbackHeadCapacity: number;
    playbackHeadLength: number;
    peakPlaybackHeadCapacity: number;
  }
>;

const MAX_CURRENT_DATUMS_PER_SERIES = 50_000;
const RETAINED_CURRENT_DATUMS_PER_SERIES = 37_500;

type PairedSeriesPlan = {
  series: Series;
  fullCount: number;
  currentCount: number;
  count: number;
};

export class CustomDatasetsBuilderImpl {
  #xValues: { current: CompactNumericStore; full: CompactNumericStore } = {
    current: new CompactNumericStore(),
    full: new CompactNumericStore(),
  };
  #seriesByKey = new Map<SeriesConfigKey, Series>();
  #lastViewportQueryStats: CustomDatasetQueryStats = createQueryStats();
  readonly #onCurrentValuePointVisited?: () => void;

  public constructor(options: { onCurrentValuePointVisited?: () => void } = {}) {
    this.#onCurrentValuePointVisited = options.onCurrentValuePointVisited;
  }

  public updateData(actions: Immutable<UpdateDataAction[]>): void {
    const currentPlan = this.#buildCurrentPlan(actions);
    for (const action of actions) {
      this.#applyNonCurrentAction(action);
    }
    this.#xValues.current = materializeNumericCurrent(currentPlan.x);
    for (const [key, series] of this.#seriesByKey) {
      series.current = materializeValueCurrent(
        currentPlan.series.get(key) ?? emptyVirtualCurrent(),
      );
    }
  }

  public getViewportDatasets(
    viewport: Immutable<Viewport>,
    currentValuesAt?: Immutable<Time>,
  ): GetViewportDatasetsResult {
    const queryStats = createQueryStats();
    this.#lastViewportQueryStats = queryStats;
    const plans: PairedSeriesPlan[] = [];
    const pathsWithMismatchedDataLengths = new Set<string>();
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const fullCount = Math.min(series.full.length, this.#xValues.full.length);
      const currentCount = Math.min(series.current.length, this.#xValues.current.length);
      const plan = { series, fullCount, currentCount, count: fullCount + currentCount };
      plans.push(plan);
      queryStats.totalPoints += plan.count;
      queryStats.totalBlocks += countPlanBlocks(plan);
      if (
        series.full.length !== this.#xValues.full.length ||
        series.current.length !== this.#xValues.current.length
      ) {
        pathsWithMismatchedDataLengths.add(series.config.messagePath);
      }
    }

    const preparedPlans = plans.map((plan) => {
      const bounds = getPlanBounds(this.#xValues, plan);
      const downsampleViewport = {
        width: Math.max(1, viewport.size.width),
        height: Math.max(1, viewport.size.height),
        bounds: {
          x: resolveBounds(viewport.bounds.x, bounds.x),
          y: resolveBounds(viewport.bounds.y, bounds.y),
        },
      };
      const lineStats = plan.series.config.showLine
        ? getViewportLineStats(this.#xValues, plan, downsampleViewport.bounds.x, queryStats)
        : undefined;
      return {
        plan,
        downsampleViewport,
        lineStats,
        budgetWeight: lineStats?.count ?? plan.count,
      };
    });
    const budgets = allocatePointBudgets(
      preparedPlans.map(({ budgetWeight }) => budgetWeight),
      MAX_POINTS,
    );
    const datasets: Dataset[] = [];
    for (let planIndex = 0; planIndex < preparedPlans.length; planIndex++) {
      const { plan, downsampleViewport, lineStats, budgetWeight } = preparedPlans[planIndex]!;
      const budget = budgets[planIndex]!;
      const { series } = plan;

      let indices: number[];
      if (budgetWeight === 0 || budget === 0) {
        indices = [];
      } else if (series.config.showLine) {
        indices = selectViewportLineIndices(
          this.#xValues,
          plan,
          downsampleViewport.bounds.x,
          lineStats!,
          budget,
          queryStats,
        );
      } else if (plan.count <= budget) {
        indices = Array.from({ length: plan.count }, (_, index) => index);
      } else {
        indices = downsampleScatter(
          iterateViewportScatterPoints(
            this.#xValues,
            plan,
            downsampleViewport.bounds.x,
            queryStats,
          ),
          downsampleViewport,
        );
      }

      const writer = new PackedDatasetWriter(indices.length);
      for (let outputIndex = 0; outputIndex < indices.length; outputIndex++) {
        const point = getPlanPoint(this.#xValues, plan, indices[outputIndex]!);
        const x = point.xStore.getValue(point.storeIndex);
        const y = point.yStore.getValue(point.storeIndex);
        writer.set(outputIndex, x, y, point.yStore.getOriginalValue(point.storeIndex));
      }

      datasets[series.config.configIndex] = attachUnpackedDataAccessor({
        borderColor: series.config.color,
        showLine: series.config.showLine,
        fill: false,
        borderWidth: series.config.lineSize,
        pointRadius: series.config.lineSize * 1.2,
        pointHoverRadius: 3,
        pointBackgroundColor: series.config.showLine
          ? series.config.contrastColor
          : series.config.color,
        pointBorderColor: "transparent",
        packedData: writer.finish(),
      });
    }

    return {
      datasetsByConfigIndex: datasets,
      pathsWithMismatchedDataLengths,
      ...(currentValuesAt != undefined
        ? { currentValuesByConfigIndex: this.#getCurrentValues(currentValuesAt) }
        : {}),
    };
  }

  public getCsvData(): CsvDataset[] {
    return this.#getCsvPlans().map((plan) => {
      const data = new Array<CsvDatum>(plan.count);
      for (let index = 0; index < plan.count; index++) {
        data[index] = this.#getCsvDatum(plan, index);
      }
      return { label: plan.series.config.messagePath, data };
    });
  }

  /** Materializes at most 10k CSV datums and returns a serializable continuation cursor. */
  public getCsvDataChunk(cursor: CsvDataCursor | undefined, maxDatums: number): CsvDataChunk {
    const chunkSize = normalizeCsvChunkSize(maxDatums);
    const plans = this.#getCsvPlans();
    let seriesIndex = cursor?.seriesIndex ?? 0;
    let datumIndex = cursor?.datumIndex ?? 0;
    if (
      !Number.isSafeInteger(seriesIndex) ||
      !Number.isSafeInteger(datumIndex) ||
      seriesIndex < 0 ||
      datumIndex < 0 ||
      seriesIndex > plans.length ||
      (seriesIndex === plans.length && datumIndex !== 0)
    ) {
      throw new RangeError("Invalid CSV cursor");
    }

    const datasets: CsvDataset[] = [];
    let remaining = chunkSize;
    while (seriesIndex < plans.length && remaining > 0) {
      const plan = plans[seriesIndex]!;
      if (datumIndex > plan.count) {
        throw new RangeError("Invalid CSV cursor");
      }
      if (datumIndex === plan.count) {
        seriesIndex++;
        datumIndex = 0;
        continue;
      }

      const count = Math.min(remaining, plan.count - datumIndex);
      const data = new Array<CsvDatum>(count);
      for (let outputIndex = 0; outputIndex < count; outputIndex++) {
        data[outputIndex] = this.#getCsvDatum(plan, datumIndex + outputIndex);
      }
      datasets.push({ label: plan.series.config.messagePath, data });
      datumIndex += count;
      remaining -= count;
      if (datumIndex === plan.count) {
        seriesIndex++;
        datumIndex = 0;
      }
    }

    return {
      datasets,
      ...(seriesIndex < plans.length ? { nextCursor: { seriesIndex, datumIndex } } : {}),
    };
  }

  public getXRange(): Bounds1D {
    const full = this.#xValues.full.getBounds();
    const current = this.#xValues.current.getBounds();
    const min = Math.min(full.min, current.min);
    const max = Math.max(full.max, current.max);
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 1 };
  }

  /** Provides a direct assertion surface for physical current-buffer bounds. */
  public getStorageStats(): CustomDatasetStorageStats {
    const series: CustomDatasetStorageStats["series"] = {};
    for (const [key, value] of this.#seriesByKey) {
      series[key] = {
        currentLength: value.current.length,
        currentCapacity: value.current.capacity,
        peakCurrentCapacity: value.current.peakCapacity,
        currentSideTableEntries: value.current.sideTableEntryCount(),
        fullLength: value.full.length,
      };
    }
    return {
      x: {
        currentLength: this.#xValues.current.length,
        currentCapacity: this.#xValues.current.capacity,
        peakCurrentCapacity: this.#xValues.current.peakCapacity,
        currentSideTableEntries: this.#xValues.current.sideTableEntryCount(),
        fullLength: this.#xValues.full.length,
      },
      series,
    };
  }

  /** Assertion surface for the bounded, non-rendered legend accumulators. */
  public getLegendStorageStats(): CustomLegendStorageStats {
    const stats: CustomLegendStorageStats = {};
    for (const [key, value] of this.#seriesByKey) {
      stats[key] = {
        currentCapacity: value.legendCurrent.capacity,
        currentLength: value.legendCurrent.length,
        peakCurrentCapacity: value.legendCurrent.peakCapacity,
        playbackHeadCapacity: value.playbackHead.capacity,
        playbackHeadLength: value.playbackHead.length,
        peakPlaybackHeadCapacity: value.playbackHead.peakCapacity,
      };
    }
    return stats;
  }

  /** Deterministic probe for how much source storage the last viewport query inspected. */
  public getLastViewportQueryStats(): CustomDatasetQueryStats {
    return { ...this.#lastViewportQueryStats };
  }

  #getCsvPlans(): PairedSeriesPlan[] {
    const plans: PairedSeriesPlan[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const fullCount = Math.min(series.full.length, this.#xValues.full.length);
      const currentCount = Math.min(series.current.length, this.#xValues.current.length);
      plans.push({ series, fullCount, currentCount, count: fullCount + currentCount });
    }
    return plans;
  }

  #getCsvDatum(plan: PairedSeriesPlan, index: number): CsvDatum {
    const point = getPlanPoint(this.#xValues, plan, index);
    return {
      x: point.xStore.getValue(point.storeIndex),
      y: point.yStore.getValue(point.storeIndex),
      receiveTime: point.xStore.getReceiveTime(point.storeIndex),
      value: point.yStore.getOriginalValue(point.storeIndex),
    };
  }

  #applyNonCurrentAction(action: Immutable<UpdateDataAction>): void {
    switch (action.type) {
      case "reset-current-x":
      case "append-current-x":
        break;
      case "reset-current": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.legendCurrent = new CompactValueStore();
        }
        break;
      }
      case "append-current": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.legendCurrent = series.legendCurrent.appendBatchBoundedTail(
            action.items,
            MAX_CURRENT_DATUMS_PER_SERIES,
            RETAINED_CURRENT_DATUMS_PER_SERIES,
          );
        }
        break;
      }
      case "reset-playback-head": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.playbackHead = new CompactValueStore();
        }
        break;
      }
      case "append-playback-head": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        series.playbackHead = series.playbackHead.appendBatchBoundedTail(
          action.items,
          MAX_CURRENT_DATUMS_PER_SERIES,
          RETAINED_CURRENT_DATUMS_PER_SERIES,
        );
        break;
      }
      case "reset-full-x":
        this.#xValues.full = new CompactNumericStore();
        break;
      case "reset-full": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.full = new CompactValueStore();
        }
        break;
      }
      case "append-full-x": {
        this.#xValues.full.appendBatch(action.items);
        break;
      }
      case "append-full": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        series.full.appendBatch(action.items);
        const latestActionTime = getLatestBatchReceiveTime(action.items);
        if (latestActionTime != undefined) {
          series.legendCurrent = series.legendCurrent.retainAfterReceiveTime(latestActionTime);
        }
        break;
      }
      case "update-series-config":
        this.#updateSeriesConfigAction(action.seriesItems);
        break;
    }
  }

  #buildCurrentPlan(actions: Immutable<UpdateDataAction[]>): CurrentMaterializationPlan {
    let x = createVirtualCurrent<CompactNumericStore, NumericItemBatch>(this.#xValues.current);
    let xLastFullReceiveTime = getLastReceiveTime(this.#xValues.full);
    let series = new Map<SeriesConfigKey, VirtualCurrent<CompactValueStore, ValueItemBatch>>();
    let seriesLastFullReceiveTime = new Map<
      SeriesConfigKey,
      ReturnType<CompactValueStore["getReceiveTime"]> | undefined
    >();
    for (const [key, value] of this.#seriesByKey) {
      series.set(key, createVirtualCurrent<CompactValueStore, ValueItemBatch>(value.current));
      seriesLastFullReceiveTime.set(key, getLastReceiveTime(value.full));
    }

    for (const action of actions) {
      switch (action.type) {
        case "reset-current-x":
          x = emptyVirtualCurrent<CompactNumericStore, NumericItemBatch>();
          break;
        case "reset-full-x":
          xLastFullReceiveTime = undefined;
          break;
        case "append-current-x":
          appendVirtualBatch<CompactNumericStore, NumericItemBatch>(
            x,
            action.items,
            xLastFullReceiveTime,
          );
          break;
        case "append-full-x": {
          xLastFullReceiveTime = getLastBatchReceiveTime(action.items, xLastFullReceiveTime);
          if (xLastFullReceiveTime) {
            trimVirtualThroughReceiveTime(x, xLastFullReceiveTime);
          }
          break;
        }
        case "reset-current": {
          if (series.has(action.series)) {
            series.set(action.series, emptyVirtualCurrent<CompactValueStore, ValueItemBatch>());
          }
          break;
        }
        case "reset-full":
          if (series.has(action.series)) {
            seriesLastFullReceiveTime.set(action.series, undefined);
          }
          break;
        case "append-current": {
          const current = series.get(action.series);
          if (current) {
            appendVirtualBatch<CompactValueStore, ValueItemBatch>(
              current,
              action.items,
              seriesLastFullReceiveTime.get(action.series),
            );
          }
          break;
        }
        case "reset-playback-head":
        case "append-playback-head":
          break;
        case "append-full": {
          const current = series.get(action.series);
          if (!current) {
            break;
          }
          const lastReceiveTime = getLastBatchReceiveTime(
            action.items,
            seriesLastFullReceiveTime.get(action.series),
          );
          seriesLastFullReceiveTime.set(action.series, lastReceiveTime);
          if (lastReceiveTime) {
            trimVirtualThroughReceiveTime(current, lastReceiveTime);
          }
          break;
        }
        case "update-series-config": {
          const nextSeries = new Map<
            SeriesConfigKey,
            VirtualCurrent<CompactValueStore, ValueItemBatch>
          >();
          const nextLastFullReceiveTime = new Map<
            SeriesConfigKey,
            ReturnType<CompactValueStore["getReceiveTime"]> | undefined
          >();
          for (const config of action.seriesItems) {
            nextSeries.set(
              config.key,
              series.get(config.key) ?? emptyVirtualCurrent<CompactValueStore, ValueItemBatch>(),
            );
            nextLastFullReceiveTime.set(config.key, seriesLastFullReceiveTime.get(config.key));
          }
          series = nextSeries;
          seriesLastFullReceiveTime = nextLastFullReceiveTime;
          break;
        }
      }
    }

    let maximumLength = x.length;
    for (const current of series.values()) {
      maximumLength = Math.max(maximumLength, current.length);
    }
    if (maximumLength > MAX_CURRENT_DATUMS_PER_SERIES) {
      const globalDropCount = maximumLength - RETAINED_CURRENT_DATUMS_PER_SERIES;
      dropVirtualPrefix(x, globalDropCount);
      for (const current of series.values()) {
        dropVirtualPrefix(current, globalDropCount);
      }
    }
    return { x, series };
  }

  #updateSeriesConfigAction(seriesItems: Immutable<SeriesItem[]>): void {
    const newSeries = new Map<SeriesConfigKey, Series>();
    for (const config of seriesItems) {
      let existingSeries = this.#seriesByKey.get(config.key);
      existingSeries ??= {
        config,
        current: new CompactValueStore(),
        full: new CompactValueStore(),
        legendCurrent: new CompactValueStore(),
        playbackHead: new CompactValueStore(),
      };
      existingSeries.config = config;
      newSeries.set(config.key, existingSeries);
    }
    this.#seriesByKey = newSeries;
  }

  #getCurrentValues(currentValuesAt: Immutable<Time>): readonly (OriginalValue | undefined)[] {
    const values: Array<OriginalValue | undefined> = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      let candidate: CurrentValueCandidate | undefined;
      candidate = chooseLaterCandidate(
        candidate,
        getCurrentValueCandidate(series.full, currentValuesAt, 0, this.#onCurrentValuePointVisited),
      );
      candidate = chooseLaterCandidate(
        candidate,
        getCurrentValueCandidate(
          series.legendCurrent,
          currentValuesAt,
          1,
          this.#onCurrentValuePointVisited,
        ),
      );
      candidate = chooseLaterCandidate(
        candidate,
        getCurrentValueCandidate(
          series.playbackHead,
          currentValuesAt,
          2,
          this.#onCurrentValuePointVisited,
        ),
      );
      values[series.config.configIndex] = candidate?.value;
    }
    return values;
  }
}

type CurrentValueCandidate = {
  priority: number;
  time: Time;
  value: OriginalValue;
};

function getCurrentValueCandidate(
  store: CompactValueStore,
  currentValuesAt: Immutable<Time>,
  priority: number,
  onVisited?: () => void,
): CurrentValueCandidate | undefined {
  const index = store.findLatestIndexAtOrBefore(currentValuesAt, onVisited);
  if (index == undefined) {
    return undefined;
  }
  return {
    priority,
    time: store.getReceiveTime(index),
    value: store.getOriginalValue(index),
  };
}

function chooseLaterCandidate(
  current: CurrentValueCandidate | undefined,
  candidate: CurrentValueCandidate | undefined,
): CurrentValueCandidate | undefined {
  if (candidate == undefined) {
    return current;
  }
  if (current == undefined) {
    return candidate;
  }
  const timeComparison = compare(candidate.time, current.time);
  return timeComparison > 0 || (timeComparison === 0 && candidate.priority > current.priority)
    ? candidate
    : current;
}

type CurrentStore<T> = {
  length: number;
  getReceiveTime(index: number): ReturnType<CompactValueStore["getReceiveTime"]>;
  sliceFrom(start: number): T;
};

type VirtualStoreSource<S> = {
  kind: "store";
  store: S;
  start: number;
  length: number;
};

type VirtualBatchSource<B extends NumericItemBatch> = {
  kind: "batch";
  batch: Immutable<B>;
  minimumReceiveTimeExclusive: ReturnType<CompactValueStore["getReceiveTime"]> | undefined;
  /** Number of eligible batch items removed from the logical prefix. */
  eligibleOffset: number;
  /** Raw batch index of the first remaining eligible item. */
  rawIndex: number;
  length: number;
};

type VirtualCurrent<S, B extends NumericItemBatch> = {
  sources: Array<VirtualStoreSource<S> | VirtualBatchSource<B>>;
  length: number;
};

type CurrentMaterializationPlan = {
  x: VirtualCurrent<CompactNumericStore, NumericItemBatch>;
  series: Map<SeriesConfigKey, VirtualCurrent<CompactValueStore, ValueItemBatch>>;
};

function createVirtualCurrent<S extends CurrentStore<S>, B extends NumericItemBatch>(
  store: S,
): VirtualCurrent<S, B> {
  return {
    sources: store.length > 0 ? [{ kind: "store", store, start: 0, length: store.length }] : [],
    length: store.length,
  };
}

function emptyVirtualCurrent<S, B extends NumericItemBatch>(): VirtualCurrent<S, B> {
  return { sources: [], length: 0 };
}

function appendVirtualBatch<S, B extends NumericItemBatch>(
  current: VirtualCurrent<S, B>,
  batch: Immutable<B>,
  minimumReceiveTimeExclusive: ReturnType<CompactValueStore["getReceiveTime"]> | undefined,
): void {
  if (batch.receiveTimes.length !== batch.values.length) {
    throw new Error("Custom plot numeric batch columns have mismatched lengths");
  }
  const rawIndex = findNextEligibleBatchIndex(batch, minimumReceiveTimeExclusive, 0);
  if (rawIndex >= batch.values.length) {
    return;
  }
  // Full/current reconciliation has always removed only the covered prefix. Preserve the entire
  // suffix after the first newer item even when malformed input later moves backwards in receive
  // time, so batching an action through an intermediate viewport flush cannot change its result.
  const length = batch.values.length - rawIndex;
  current.sources.push({
    kind: "batch",
    batch,
    minimumReceiveTimeExclusive: undefined,
    eligibleOffset: rawIndex,
    rawIndex,
    length,
  });
  current.length += length;
}

function trimVirtualThroughReceiveTime<S extends CurrentStore<S>, B extends NumericItemBatch>(
  current: VirtualCurrent<S, B>,
  lastFullReceiveTime: ReturnType<CompactValueStore["getReceiveTime"]>,
): void {
  while (current.sources.length > 0) {
    const source = current.sources[0]!;
    if (source.kind === "store") {
      let dropped = 0;
      while (
        dropped < source.length &&
        compare(source.store.getReceiveTime(source.start + dropped), lastFullReceiveTime) <= 0
      ) {
        dropped++;
      }
      advanceVirtualSource(current, source, dropped);
      if (source.length > 0) {
        return;
      }
      continue;
    }

    let dropped = 0;
    let rawIndex = source.rawIndex;
    while (
      dropped < source.length &&
      compare(decodeBatchTime(source.batch, rawIndex), lastFullReceiveTime) <= 0
    ) {
      dropped++;
      rawIndex = findNextEligibleBatchIndex(
        source.batch,
        source.minimumReceiveTimeExclusive,
        rawIndex + 1,
      );
    }
    advanceVirtualSource(current, source, dropped);
    if (source.length > 0) {
      return;
    }
  }
}

function dropVirtualPrefix<S, B extends NumericItemBatch>(
  current: VirtualCurrent<S, B>,
  requestedDropCount: number,
): void {
  let remaining = Math.min(Math.max(0, requestedDropCount), current.length);
  while (remaining > 0) {
    const source = current.sources[0]!;
    const dropped = Math.min(remaining, source.length);
    advanceVirtualSource(current, source, dropped);
    remaining -= dropped;
  }
}

function advanceVirtualSource<S, B extends NumericItemBatch>(
  current: VirtualCurrent<S, B>,
  source: VirtualStoreSource<S> | VirtualBatchSource<B>,
  requestedCount: number,
): void {
  const count = Math.min(Math.max(0, requestedCount), source.length);
  if (count === 0) {
    return;
  }
  if (source.kind === "store") {
    source.start += count;
  } else {
    source.eligibleOffset += count;
    if (count === source.length) {
      source.rawIndex = source.batch.values.length;
    } else if (source.minimumReceiveTimeExclusive == undefined) {
      source.rawIndex += count;
    } else {
      for (let skipped = 0; skipped < count; skipped++) {
        source.rawIndex = findNextEligibleBatchIndex(
          source.batch,
          source.minimumReceiveTimeExclusive,
          source.rawIndex + 1,
        );
      }
    }
  }
  source.length -= count;
  current.length -= count;
  if (source.length === 0) {
    current.sources.shift();
  }
}

function findNextEligibleBatchIndex(
  batch: Immutable<NumericItemBatch>,
  minimumReceiveTimeExclusive: ReturnType<CompactValueStore["getReceiveTime"]> | undefined,
  start: number,
): number {
  if (minimumReceiveTimeExclusive == undefined) {
    return Math.min(Math.max(0, start), batch.values.length);
  }
  let index = Math.min(Math.max(0, start), batch.values.length);
  while (
    index < batch.values.length &&
    compare(decodeBatchTime(batch, index), minimumReceiveTimeExclusive) <= 0
  ) {
    index++;
  }
  return index;
}

function getLastBatchReceiveTime(
  batch: Immutable<NumericItemBatch>,
  fallback: ReturnType<CompactValueStore["getReceiveTime"]> | undefined,
) {
  if (batch.receiveTimes.length !== batch.values.length) {
    throw new Error("Custom plot numeric batch columns have mismatched lengths");
  }
  return batch.values.length > 0 ? decodeBatchTime(batch, batch.values.length - 1) : fallback;
}

function getLatestBatchReceiveTime(
  batch: Immutable<NumericItemBatch>,
): ReturnType<CompactValueStore["getReceiveTime"]> | undefined {
  let latest: ReturnType<CompactValueStore["getReceiveTime"]> | undefined;
  for (let index = 0; index < batch.values.length; index++) {
    const receiveTime = decodeBatchTime(batch, index);
    if (latest == undefined || compare(receiveTime, latest) > 0) {
      latest = receiveTime;
    }
  }
  return latest;
}

function materializeNumericCurrent(
  current: VirtualCurrent<CompactNumericStore, NumericItemBatch>,
): CompactNumericStore {
  let store = new CompactNumericStore();
  let sourceIndex = 0;
  const first = current.sources[0];
  if (first?.kind === "store") {
    store = first.store.sliceFrom(first.start);
    sourceIndex = 1;
  }
  for (; sourceIndex < current.sources.length; sourceIndex++) {
    const source = current.sources[sourceIndex]!;
    if (source.kind === "batch") {
      store.appendBatchTail(
        source.batch,
        source.minimumReceiveTimeExclusive,
        source.eligibleOffset,
        MAX_CURRENT_DATUMS_PER_SERIES,
      );
    }
  }
  return store;
}

function materializeValueCurrent(
  current: VirtualCurrent<CompactValueStore, ValueItemBatch>,
): CompactValueStore {
  let store = new CompactValueStore();
  let sourceIndex = 0;
  const first = current.sources[0];
  if (first?.kind === "store") {
    store = first.store.sliceFrom(first.start);
    sourceIndex = 1;
  }
  for (; sourceIndex < current.sources.length; sourceIndex++) {
    const source = current.sources[sourceIndex]!;
    if (source.kind === "batch") {
      store.appendBatchTail(
        source.batch,
        source.minimumReceiveTimeExclusive,
        source.eligibleOffset,
        MAX_CURRENT_DATUMS_PER_SERIES,
      );
    }
  }
  return store;
}

function getLastReceiveTime(store: {
  length: number;
  getReceiveTime(index: number): ReturnType<CompactValueStore["getReceiveTime"]>;
}) {
  return store.length > 0 ? store.getReceiveTime(store.length - 1) : undefined;
}

function getPlanPoint(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  index: number,
): { xStore: CompactNumericStore; yStore: CompactValueStore; storeIndex: number } {
  if (index < plan.fullCount) {
    return { xStore: xValues.full, yStore: plan.series.full, storeIndex: index };
  }
  return {
    xStore: xValues.current,
    yStore: plan.series.current,
    storeIndex: index - plan.fullCount,
  };
}

type PlanBlock = {
  start: number;
  end: number;
  storeStart: number;
  blockIndex: number;
  xStore: CompactNumericStore;
  yStore: CompactValueStore;
};

function createQueryStats(): CustomDatasetQueryStats {
  return {
    totalPoints: 0,
    totalBlocks: 0,
    metadataBlocksInspected: 0,
    scannedBlocks: 0,
    scannedPoints: 0,
  };
}

function countPlanBlocks(plan: PairedSeriesPlan): number {
  return (
    Math.ceil(plan.fullCount / CUSTOM_VALUE_STORE_BLOCK_SIZE) +
    Math.ceil(plan.currentCount / CUSTOM_VALUE_STORE_BLOCK_SIZE)
  );
}

function* iteratePlanBlocks(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
): Iterable<PlanBlock> {
  yield* iterateStoreBlocks(xValues.full, plan.series.full, plan.fullCount, 0);
  yield* iterateStoreBlocks(
    xValues.current,
    plan.series.current,
    plan.currentCount,
    plan.fullCount,
  );
}

function* iterateStoreBlocks(
  xStore: CompactNumericStore,
  yStore: CompactValueStore,
  count: number,
  planOffset: number,
): Iterable<PlanBlock> {
  for (let storeStart = 0; storeStart < count; storeStart += CUSTOM_VALUE_STORE_BLOCK_SIZE) {
    const blockIndex = Math.floor(storeStart / CUSTOM_VALUE_STORE_BLOCK_SIZE);
    yield {
      start: planOffset + storeStart,
      end: planOffset + Math.min(count, storeStart + CUSTOM_VALUE_STORE_BLOCK_SIZE),
      storeStart,
      blockIndex,
      xStore,
      yStore,
    };
  }
}

function* iterateViewportScatterPoints(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  xBounds: Immutable<Bounds1D>,
  queryStats: CustomDatasetQueryStats,
): Iterable<{ index: number; x: number; y: number }> {
  for (const block of iteratePlanBlocks(xValues, plan)) {
    queryStats.metadataBlocksInspected++;
    const metadata = block.xStore.getBlockMetadata(block.blockIndex);
    const storeEnd = block.storeStart + (block.end - block.start);
    if (
      metadata != undefined &&
      !finiteBoundsIntersect(metadata, xBounds) &&
      !metadataHasNonFiniteInRange(metadata, block.storeStart, storeEnd)
    ) {
      continue;
    }

    queryStats.scannedBlocks++;
    queryStats.scannedPoints += block.end - block.start;
    for (let index = block.start; index < block.end; index++) {
      const point = getPlanPoint(xValues, plan, index);
      yield {
        index,
        x: point.xStore.getValue(point.storeIndex),
        y: point.yStore.getValue(point.storeIndex),
      };
    }
  }
}

function getPlanBounds(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
): { x: Bounds1D; y: Bounds1D } {
  const fullX = xValues.full.getBounds(plan.fullCount);
  const currentX = xValues.current.getBounds(plan.currentCount);
  const fullY = plan.series.full.getBounds(plan.fullCount);
  const currentY = plan.series.current.getBounds(plan.currentCount);
  return {
    x: resolveBounds(undefined, {
      min: Math.min(fullX.min, currentX.min),
      max: Math.max(fullX.max, currentX.max),
    }),
    y: resolveBounds(undefined, {
      min: Math.min(fullY.min, currentY.min),
      max: Math.max(fullY.max, currentY.max),
    }),
  };
}

function resolveBounds(
  requested: Immutable<Partial<Bounds1D>> | undefined,
  fallback: Immutable<Bounds1D>,
): Bounds1D {
  let min = requested?.min;
  let max = requested?.max;
  if (min == undefined || !Number.isFinite(min)) {
    min = Number.isFinite(fallback.min) ? fallback.min : 0;
  }
  if (max == undefined || !Number.isFinite(max)) {
    max = Number.isFinite(fallback.max) ? fallback.max : min + 1;
  }
  if (max <= min) {
    const padding = Math.max(1, Math.abs(min) * 1e-9);
    min -= padding;
    max += padding;
  }
  return { min, max };
}

type ViewportLineStats = { count: number; hasDiscontinuity: boolean };

function getViewportLineStats(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  xBounds: Immutable<Bounds1D>,
  queryStats: CustomDatasetQueryStats,
): ViewportLineStats {
  let count = 0;
  let hasDiscontinuity = false;
  forEachViewportLineIndex(
    xValues,
    plan,
    xBounds,
    (index) => {
      count++;
      hasDiscontinuity ||= isPlanDiscontinuity(xValues, plan, index);
    },
    queryStats,
  );
  return { count, hasDiscontinuity };
}

function selectViewportLineIndices(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  xBounds: Immutable<Bounds1D>,
  stats: ViewportLineStats,
  budget: number,
  queryStats: CustomDatasetQueryStats,
): number[] {
  const { count: visibleCount, hasDiscontinuity } = stats;
  if (budget <= 0 || visibleCount <= 0) {
    return [];
  }
  if (visibleCount <= budget) {
    const indices: number[] = [];
    forEachViewportLineIndex(xValues, plan, xBounds, (index) => indices.push(index), queryStats);
    return preserveLineDiscontinuities(xValues, plan, indices, queryStats);
  }

  // A sampled finite pair can need one NaN sentinel between it. Reserving half the budget keeps
  // those sentinels within the same hard global limit.
  const samplingBudget = hasDiscontinuity ? Math.floor((budget + 1) / 2) : budget;
  const bucketCount = Math.max(1, Math.floor(samplingBudget / 6));
  const buckets = new Array<LineSampleBucket | undefined>(bucketCount);
  let visibleOrdinal = 0;
  forEachViewportLineIndex(
    xValues,
    plan,
    xBounds,
    (index) => {
      const point = getPlanPoint(xValues, plan, index);
      const x = point.xStore.getValue(point.storeIndex);
      const y = point.yStore.getValue(point.storeIndex);
      const bucketIndex = Math.min(
        bucketCount - 1,
        Math.floor((visibleOrdinal * bucketCount) / visibleCount),
      );
      let bucket = buckets[bucketIndex];
      if (!bucket) {
        bucket = {
          first: index,
          last: index,
          minX: index,
          maxX: index,
          minY: index,
          maxY: index,
          minXValue: x,
          maxXValue: x,
          minYValue: y,
          maxYValue: y,
        };
        buckets[bucketIndex] = bucket;
      } else {
        bucket.last = index;
        if (Number.isFinite(x) && (!Number.isFinite(bucket.minXValue) || x < bucket.minXValue)) {
          bucket.minX = index;
          bucket.minXValue = x;
        }
        if (Number.isFinite(x) && (!Number.isFinite(bucket.maxXValue) || x > bucket.maxXValue)) {
          bucket.maxX = index;
          bucket.maxXValue = x;
        }
        if (Number.isFinite(y) && (!Number.isFinite(bucket.minYValue) || y < bucket.minYValue)) {
          bucket.minY = index;
          bucket.minYValue = y;
        }
        if (Number.isFinite(y) && (!Number.isFinite(bucket.maxYValue) || y > bucket.maxYValue)) {
          bucket.maxY = index;
          bucket.maxYValue = y;
        }
      }
      visibleOrdinal++;
    },
    queryStats,
  );

  if (samplingBudget < 6) {
    const bucket = buckets[0];
    const indices = bucket ? selectSmallBudgetBucketIndices(bucket, samplingBudget) : [];
    return preserveLineDiscontinuities(xValues, plan, indices, queryStats);
  }

  const result: number[] = [];
  for (const bucket of buckets) {
    if (!bucket) {
      continue;
    }
    const bucketIndices = [
      bucket.first,
      bucket.last,
      bucket.minX,
      bucket.maxX,
      bucket.minY,
      bucket.maxY,
    ];
    bucketIndices.sort((left, right) => left - right);
    for (const index of bucketIndices) {
      if (result[result.length - 1] !== index) {
        result.push(index);
      }
    }
  }
  return preserveLineDiscontinuities(xValues, plan, result, queryStats);
}

type LineSampleBucket = {
  first: number;
  last: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minXValue: number;
  maxXValue: number;
  minYValue: number;
  maxYValue: number;
};

function selectSmallBudgetBucketIndices(bucket: LineSampleBucket, budget: number): number[] {
  const priority = [bucket.first, bucket.last, bucket.minX, bucket.maxX, bucket.minY, bucket.maxY];
  const selected = new Set<number>();
  for (const index of priority) {
    selected.add(index);
    if (selected.size === budget) {
      break;
    }
  }
  return [...selected].sort((left, right) => left - right);
}

function forEachViewportLineIndex(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  xBounds: Immutable<Bounds1D>,
  visit: (index: number) => void,
  queryStats: CustomDatasetQueryStats,
): void {
  let emittedAny = false;
  let lastEmittedWasDiscontinuity = false;
  let pendingDiscontinuity: number | undefined;
  for (const block of iteratePlanBlocks(xValues, plan)) {
    queryStats.metadataBlocksInspected++;
    if (!lineBlockNeedsScan(xValues, plan, block, xBounds)) {
      if (emittedAny && !lastEmittedWasDiscontinuity && pendingDiscontinuity == undefined) {
        pendingDiscontinuity = getBlockFirstDiscontinuity(block);
      }
      continue;
    }

    queryStats.scannedBlocks++;
    queryStats.scannedPoints += block.end - block.start;
    for (let index = block.start; index < block.end; index++) {
      const x = getPlanX(xValues, plan, index);
      const pointIsInside = Number.isFinite(x) && x >= xBounds.min && x <= xBounds.max;
      const leftSegmentIntersects =
        index > 0 && segmentIntersectsX(getPlanX(xValues, plan, index - 1), x, xBounds);
      const rightSegmentIntersects =
        index + 1 < plan.count &&
        segmentIntersectsX(x, getPlanX(xValues, plan, index + 1), xBounds);
      const isDiscontinuity = isPlanDiscontinuity(xValues, plan, index);
      if (pointIsInside || leftSegmentIntersects || rightSegmentIntersects) {
        if (pendingDiscontinuity != undefined && emittedAny && !lastEmittedWasDiscontinuity) {
          visit(pendingDiscontinuity);
        }
        visit(index);
        emittedAny = true;
        lastEmittedWasDiscontinuity = isDiscontinuity;
        pendingDiscontinuity = undefined;
      } else if (isDiscontinuity && emittedAny && !lastEmittedWasDiscontinuity) {
        pendingDiscontinuity ??= index;
      }
    }
  }
}

function lineBlockNeedsScan(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  block: PlanBlock,
  xBounds: Immutable<Bounds1D>,
): boolean {
  const metadata = block.xStore.getBlockMetadata(block.blockIndex);
  if (metadata == undefined || finiteBoundsIntersect(metadata, xBounds)) {
    return true;
  }
  return (
    (block.start > 0 &&
      segmentIntersectsX(
        getPlanX(xValues, plan, block.start - 1),
        getPlanX(xValues, plan, block.start),
        xBounds,
      )) ||
    (block.end < plan.count &&
      segmentIntersectsX(
        getPlanX(xValues, plan, block.end - 1),
        getPlanX(xValues, plan, block.end),
        xBounds,
      ))
  );
}

function finiteBoundsIntersect(
  metadata: Readonly<CompactStoreBlockMetadata>,
  bounds: Immutable<Bounds1D>,
): boolean {
  return metadata.finiteMax >= bounds.min && metadata.finiteMin <= bounds.max;
}

function metadataHasNonFiniteInRange(
  metadata: Readonly<CompactStoreBlockMetadata>,
  start: number,
  end: number,
): boolean {
  const index = metadata.firstNonFiniteIndex;
  return index != undefined && index >= start && index < end;
}

function getBlockFirstDiscontinuity(block: PlanBlock): number | undefined {
  const storeEnd = block.storeStart + (block.end - block.start);
  const xIndex = getMetadataFirstNonFiniteInRange(
    block.xStore.getBlockMetadata(block.blockIndex),
    block.storeStart,
    storeEnd,
  );
  const yIndex = getMetadataFirstNonFiniteInRange(
    block.yStore.getBlockMetadata(block.blockIndex),
    block.storeStart,
    storeEnd,
  );
  const storeIndex = minDefined(xIndex, yIndex);
  return storeIndex == undefined ? undefined : block.start + storeIndex - block.storeStart;
}

function getMetadataFirstNonFiniteInRange(
  metadata: Readonly<CompactStoreBlockMetadata> | undefined,
  start: number,
  end: number,
): number | undefined {
  const index = metadata?.firstNonFiniteIndex;
  return index != undefined && index >= start && index < end ? index : undefined;
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left == undefined) {
    return right;
  }
  if (right == undefined) {
    return left;
  }
  return Math.min(left, right);
}

function getPlanX(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  index: number,
): number {
  const point = getPlanPoint(xValues, plan, index);
  return point.xStore.getValue(point.storeIndex);
}

function segmentIntersectsX(left: number, right: number, bounds: Immutable<Bounds1D>): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.max(left, right) >= bounds.min && Math.min(left, right) <= bounds.max;
}

function isPlanDiscontinuity(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  index: number,
): boolean {
  const point = getPlanPoint(xValues, plan, index);
  return (
    !Number.isFinite(point.xStore.getValue(point.storeIndex)) ||
    !Number.isFinite(point.yStore.getValue(point.storeIndex))
  );
}

function preserveLineDiscontinuities(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  sampledIndices: readonly number[],
  queryStats: CustomDatasetQueryStats,
): number[] {
  if (sampledIndices.length < 2) {
    return [...sampledIndices];
  }
  const result = [sampledIndices[0]!];
  for (let sampledIndex = 1; sampledIndex < sampledIndices.length; sampledIndex++) {
    const previous = sampledIndices[sampledIndex - 1]!;
    const next = sampledIndices[sampledIndex]!;
    if (
      !isPlanDiscontinuity(xValues, plan, previous) &&
      !isPlanDiscontinuity(xValues, plan, next)
    ) {
      const discontinuity = findFirstPlanDiscontinuity(
        xValues,
        plan,
        previous + 1,
        next,
        queryStats,
      );
      if (discontinuity != undefined) {
        result.push(discontinuity);
      }
    }
    result.push(next);
  }
  return result;
}

function findFirstPlanDiscontinuity(
  xValues: { current: CompactNumericStore; full: CompactNumericStore },
  plan: PairedSeriesPlan,
  requestedStart: number,
  requestedEnd: number,
  queryStats: CustomDatasetQueryStats,
): number | undefined {
  const start = Math.min(Math.max(0, requestedStart), plan.count);
  const end = Math.min(Math.max(start, requestedEnd), plan.count);
  if (start >= end) {
    return undefined;
  }

  if (start < plan.fullCount) {
    const result = findFirstStoreDiscontinuity(
      xValues.full,
      plan.series.full,
      start,
      Math.min(end, plan.fullCount),
      0,
      queryStats,
    );
    if (result != undefined) {
      return result;
    }
  }
  if (end > plan.fullCount) {
    return findFirstStoreDiscontinuity(
      xValues.current,
      plan.series.current,
      Math.max(start, plan.fullCount) - plan.fullCount,
      end - plan.fullCount,
      plan.fullCount,
      queryStats,
    );
  }
  return undefined;
}

function findFirstStoreDiscontinuity(
  xStore: CompactNumericStore,
  yStore: CompactValueStore,
  start: number,
  end: number,
  planOffset: number,
  queryStats: CustomDatasetQueryStats,
): number | undefined {
  const firstBlock = Math.floor(start / CUSTOM_VALUE_STORE_BLOCK_SIZE);
  const lastBlock = Math.floor((end - 1) / CUSTOM_VALUE_STORE_BLOCK_SIZE);
  for (let blockIndex = firstBlock; blockIndex <= lastBlock; blockIndex++) {
    const blockStart = blockIndex * CUSTOM_VALUE_STORE_BLOCK_SIZE;
    const rangeStart = Math.max(start, blockStart);
    const rangeEnd = Math.min(end, blockStart + CUSTOM_VALUE_STORE_BLOCK_SIZE);
    queryStats.metadataBlocksInspected++;

    const xMetadata = getMetadataRangeFirstNonFinite(
      xStore.getBlockMetadata(blockIndex),
      rangeStart,
      rangeEnd,
    );
    const yMetadata = getMetadataRangeFirstNonFinite(
      yStore.getBlockMetadata(blockIndex),
      rangeStart,
      rangeEnd,
    );
    if (xMetadata.known && yMetadata.known) {
      const index = minDefined(xMetadata.index, yMetadata.index);
      if (index != undefined) {
        return planOffset + index;
      }
      continue;
    }

    queryStats.scannedBlocks++;
    queryStats.scannedPoints += rangeEnd - rangeStart;
    for (let index = rangeStart; index < rangeEnd; index++) {
      if (!Number.isFinite(xStore.getValue(index)) || !Number.isFinite(yStore.getValue(index))) {
        return planOffset + index;
      }
    }
  }
  return undefined;
}

function getMetadataRangeFirstNonFinite(
  metadata: Readonly<CompactStoreBlockMetadata> | undefined,
  start: number,
  end: number,
): { known: boolean; index: number | undefined } {
  if (metadata == undefined || metadata.end < end) {
    return { known: false, index: undefined };
  }
  const index = metadata.firstNonFiniteIndex;
  if (index == undefined || index >= end) {
    return { known: true, index: undefined };
  }
  if (index >= start) {
    return { known: true, index };
  }
  return { known: false, index: undefined };
}
