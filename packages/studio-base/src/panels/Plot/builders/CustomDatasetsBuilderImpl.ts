// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { allocatePointBudgets } from "@foxglove/den/collection";
import { compare } from "@foxglove/rostime";
import { Immutable } from "@foxglove/studio";
import {
  downsampleScatter,
  MAX_POINTS,
} from "@foxglove/studio-base/components/TimeBasedChart/downsample";
import { Bounds1D } from "@foxglove/studio-base/types/Bounds";

import { CompactValueStore, ValueItemBatch } from "./CustomValueStore";
import {
  CsvDataset,
  GetViewportDatasetsResult,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type { Dataset } from "../ChartRenderer";
import { attachUnpackedDataAccessor, PackedDatasetWriter } from "../PackedDataset";
import { Datum } from "../datum";

export type { ValueItem } from "./CustomValueStore";

type Series = {
  config: Immutable<SeriesItem>;
  current: CompactValueStore;
  full: CompactValueStore;
};

type ResetSeriesFullAction = { type: "reset-full"; series: SeriesConfigKey };
type ResetSeriesCurrentAction = { type: "reset-current"; series: SeriesConfigKey };
type ResetCurrentXAction = { type: "reset-current-x" };
type ResetFullXAction = { type: "reset-full-x" };
type UpdateCurrentXAction = { type: "append-current-x"; items: ValueItemBatch };
type UpdateFullXAction = { type: "append-full-x"; items: ValueItemBatch };
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
type UpdateSeriesConfigAction = { type: "update-series-config"; seriesItems: SeriesItem[] };

export type UpdateDataAction =
  | UpdateSeriesConfigAction
  | ResetSeriesFullAction
  | ResetSeriesCurrentAction
  | ResetCurrentXAction
  | ResetFullXAction
  | UpdateCurrentXAction
  | UpdateFullXAction
  | UpdateSeriesCurrentAction
  | UpdateSeriesFullAction;

export type CustomDatasetStorageStats = {
  x: { currentLength: number; currentCapacity: number; fullLength: number };
  series: Record<
    string,
    {
      currentLength: number;
      currentCapacity: number;
      currentSideTableEntries: number;
      fullLength: number;
    }
  >;
};

const MAX_CURRENT_DATUMS_PER_SERIES = 50_000;
const RETAINED_CURRENT_DATUMS_PER_SERIES = 37_500;

type PairedSeriesPlan = {
  series: Series;
  fullCount: number;
  currentCount: number;
  count: number;
};

export class CustomDatasetsBuilderImpl {
  #xValues: { current: CompactValueStore; full: CompactValueStore } = {
    current: new CompactValueStore(),
    full: new CompactValueStore(),
  };
  #seriesByKey = new Map<SeriesConfigKey, Series>();

  public updateData(actions: Immutable<UpdateDataAction[]>): void {
    for (const action of actions) {
      this.#applyAction(action);
    }
    this.#capCurrentStoresTogether();
  }

  public getViewportDatasets(viewport: Immutable<Viewport>): GetViewportDatasetsResult {
    const plans: PairedSeriesPlan[] = [];
    const pathsWithMismatchedDataLengths = new Set<string>();
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const fullCount = Math.min(series.full.length, this.#xValues.full.length);
      const currentCount = Math.min(series.current.length, this.#xValues.current.length);
      plans.push({ series, fullCount, currentCount, count: fullCount + currentCount });
      if (
        series.full.length !== this.#xValues.full.length ||
        series.current.length !== this.#xValues.current.length
      ) {
        pathsWithMismatchedDataLengths.add(series.config.messagePath);
      }
    }

    const budgets = allocatePointBudgets(
      plans.map((plan) => plan.count),
      MAX_POINTS,
    );
    const datasets: Dataset[] = [];
    for (let planIndex = 0; planIndex < plans.length; planIndex++) {
      const plan = plans[planIndex]!;
      const budget = budgets[planIndex]!;
      const { series } = plan;
      const bounds = getPlanBounds(this.#xValues, plan);
      const downsampleViewport = {
        width: Math.max(1, viewport.size.width),
        height: Math.max(1, viewport.size.height),
        bounds: {
          x: resolveBounds(viewport.bounds.x, bounds.x),
          y: resolveBounds(viewport.bounds.y, bounds.y),
        },
      };

      let indices: number[];
      if (plan.count === 0 || budget === 0) {
        indices = [];
      } else if (series.config.showLine) {
        // A custom x-axis is not necessarily monotonic. Downsampling only by ordinal position keeps
        // the original connection order and never introduces a sorted-x assumption.
        indices = selectOrderedLineIndices(plan.count, budget, (index) => {
          const point = getPlanPoint(this.#xValues, plan, index);
          return point.yStore.getValue(point.storeIndex);
        });
      } else {
        indices = downsampleScatter(iteratePlanPoints(this.#xValues, plan), downsampleViewport);
        indices = limitOrderedIndices(indices, budget);
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

    return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths };
  }

  public getCsvData(): CsvDataset[] {
    const datasets: CsvDataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const plan = {
        series,
        fullCount: Math.min(series.full.length, this.#xValues.full.length),
        currentCount: Math.min(series.current.length, this.#xValues.current.length),
        count: 0,
      } satisfies PairedSeriesPlan;
      plan.count = plan.fullCount + plan.currentCount;
      const data = new Array<Datum>(plan.count);
      for (let index = 0; index < plan.count; index++) {
        const point = getPlanPoint(this.#xValues, plan, index);
        data[index] = {
          x: point.xStore.getValue(point.storeIndex),
          y: point.yStore.getValue(point.storeIndex),
          receiveTime: point.xStore.getReceiveTime(point.storeIndex),
          value: point.yStore.getOriginalValue(point.storeIndex),
        };
      }
      datasets.push({ label: series.config.messagePath, data });
    }
    return datasets;
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
        currentSideTableEntries: value.current.sideTableEntryCount(),
        fullLength: value.full.length,
      };
    }
    return {
      x: {
        currentLength: this.#xValues.current.length,
        currentCapacity: this.#xValues.current.capacity,
        fullLength: this.#xValues.full.length,
      },
      series,
    };
  }

  #applyAction(action: Immutable<UpdateDataAction>): void {
    switch (action.type) {
      case "reset-current-x":
        this.#xValues.current = new CompactValueStore();
        break;
      case "reset-full-x":
        this.#xValues.full = new CompactValueStore();
        break;
      case "reset-current": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.current = new CompactValueStore();
        }
        break;
      }
      case "reset-full": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.full = new CompactValueStore();
        }
        break;
      }
      case "append-current-x": {
        const lastFullReceiveTime = getLastReceiveTime(this.#xValues.full);
        this.#xValues.current.appendBatch(action.items, lastFullReceiveTime);
        break;
      }
      case "append-full-x": {
        this.#xValues.full.appendBatch(action.items);
        const lastFullReceiveTime = getLastReceiveTime(this.#xValues.full);
        if (lastFullReceiveTime) {
          this.#xValues.current = trimThroughReceiveTime(
            this.#xValues.current,
            lastFullReceiveTime,
          );
        }
        break;
      }
      case "append-current": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        const lastFullReceiveTime = getLastReceiveTime(series.full);
        series.current.appendBatch(action.items, lastFullReceiveTime);
        break;
      }
      case "append-full": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        series.full.appendBatch(action.items);
        const lastFullReceiveTime = getLastReceiveTime(series.full);
        if (lastFullReceiveTime) {
          series.current = trimThroughReceiveTime(series.current, lastFullReceiveTime);
        }
        break;
      }
      case "update-series-config":
        this.#updateSeriesConfigAction(action.seriesItems);
        break;
    }
  }

  #updateSeriesConfigAction(seriesItems: Immutable<SeriesItem[]>): void {
    const newSeries = new Map<SeriesConfigKey, Series>();
    for (const config of seriesItems) {
      let existingSeries = this.#seriesByKey.get(config.key);
      existingSeries ??= {
        config,
        current: new CompactValueStore(),
        full: new CompactValueStore(),
      };
      existingSeries.config = config;
      newSeries.set(config.key, existingSeries);
    }
    this.#seriesByKey = newSeries;
  }

  #capCurrentStoresTogether(): void {
    let maximumLength = this.#xValues.current.length;
    for (const series of this.#seriesByKey.values()) {
      maximumLength = Math.max(maximumLength, series.current.length);
    }
    if (maximumLength <= MAX_CURRENT_DATUMS_PER_SERIES) {
      return;
    }
    const dropCount = maximumLength - RETAINED_CURRENT_DATUMS_PER_SERIES;
    this.#xValues.current = this.#xValues.current.sliceFrom(
      Math.min(dropCount, this.#xValues.current.length),
    );
    for (const series of this.#seriesByKey.values()) {
      series.current = series.current.sliceFrom(Math.min(dropCount, series.current.length));
    }
  }
}

function getLastReceiveTime(store: CompactValueStore) {
  return store.length > 0 ? store.getReceiveTime(store.length - 1) : undefined;
}

function trimThroughReceiveTime(
  store: CompactValueStore,
  lastFullReceiveTime: ReturnType<CompactValueStore["getReceiveTime"]>,
): CompactValueStore {
  let firstRetained = 0;
  while (
    firstRetained < store.length &&
    compare(store.getReceiveTime(firstRetained), lastFullReceiveTime) <= 0
  ) {
    firstRetained++;
  }
  return firstRetained > 0 ? store.sliceFrom(firstRetained) : store;
}

function getPlanPoint(
  xValues: { current: CompactValueStore; full: CompactValueStore },
  plan: PairedSeriesPlan,
  index: number,
): { xStore: CompactValueStore; yStore: CompactValueStore; storeIndex: number } {
  if (index < plan.fullCount) {
    return { xStore: xValues.full, yStore: plan.series.full, storeIndex: index };
  }
  return {
    xStore: xValues.current,
    yStore: plan.series.current,
    storeIndex: index - plan.fullCount,
  };
}

function* iteratePlanPoints(
  xValues: { current: CompactValueStore; full: CompactValueStore },
  plan: PairedSeriesPlan,
): Iterable<{ index: number; x: number; y: number }> {
  for (let index = 0; index < plan.count; index++) {
    const point = getPlanPoint(xValues, plan, index);
    yield {
      index,
      x: point.xStore.getValue(point.storeIndex),
      y: point.yStore.getValue(point.storeIndex),
    };
  }
}

function getPlanBounds(
  xValues: { current: CompactValueStore; full: CompactValueStore },
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

function selectOrderedLineIndices(
  count: number,
  budget: number,
  getY: (index: number) => number,
): number[] {
  if (budget <= 0 || count <= 0) {
    return [];
  }
  if (count <= budget) {
    return Array.from({ length: count }, (_, index) => index);
  }
  if (budget === 1) {
    return [0];
  }
  if (budget === 2) {
    return [0, count - 1];
  }

  const result = [0];
  const interiorSlots = budget - 2;
  const bucketCount = Math.ceil(interiorSlots / 2);
  let slotsUsed = 0;
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor(((count - 2) * bucket) / bucketCount);
    const end = 1 + Math.floor(((count - 2) * (bucket + 1)) / bucketCount);
    let minimumIndex = start;
    let maximumIndex = start;
    for (let index = start + 1; index < end; index++) {
      if (getY(index) < getY(minimumIndex)) {
        minimumIndex = index;
      }
      if (getY(index) > getY(maximumIndex)) {
        maximumIndex = index;
      }
    }
    const remainingBuckets = bucketCount - bucket;
    const remainingSlots = interiorSlots - slotsUsed;
    const slotsForBucket = Math.min(2, Math.ceil(remainingSlots / remainingBuckets));
    if (slotsForBucket === 1 || minimumIndex === maximumIndex) {
      result.push(
        Math.abs(getY(minimumIndex)) >= Math.abs(getY(maximumIndex)) ? minimumIndex : maximumIndex,
      );
      slotsUsed++;
    } else {
      result.push(Math.min(minimumIndex, maximumIndex), Math.max(minimumIndex, maximumIndex));
      slotsUsed += 2;
    }
  }
  result.push(count - 1);
  return limitOrderedIndices(result, budget);
}

function limitOrderedIndices(indices: readonly number[], budget: number): number[] {
  if (budget <= 0 || indices.length === 0) {
    return [];
  }
  if (indices.length <= budget) {
    return [...indices];
  }
  if (budget === 1) {
    return [indices[0]!];
  }
  const result = new Array<number>(budget);
  for (let outputIndex = 0; outputIndex < budget; outputIndex++) {
    const sourceIndex = Math.round((outputIndex * (indices.length - 1)) / (budget - 1));
    result[outputIndex] = indices[sourceIndex]!;
  }
  return result;
}
