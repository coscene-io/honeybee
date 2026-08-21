// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import stringHash from "string-hash";

import { allocatePointBudgets, GrowableTypedArray } from "@foxglove/den/collection";
import { Immutable } from "@foxglove/studio";
import { expandedLineColors } from "@foxglove/studio-base/util/plotColors";
import { grey } from "@foxglove/studio-base/util/toolsColorScheme";

import { MAX_POINTS, Viewport } from "./downsampleStates";
import positiveModulo from "./positiveModulo";
import { Datum } from "./types";

const NO_STATE = 0xffffffff;
const MINIMUM_PIXEL_DISTANCE = 3;
const MAX_CURRENT_DATUMS_PER_SERIES = 50_000;

type StateValue = Exclude<Datum["value"], undefined>;

export type StateDatum = {
  x: number;
  value: StateValue;
  constantName?: string;
};

export type StateDatumMetadata = {
  value: StateValue;
  constantName?: string;
};

/**
 * Transfer-friendly state samples. The per-point representation is two typed columns; repeated
 * values and enum names appear only once in the side table.
 */
export type PackedStateDatumBatch = {
  x: Float64Array;
  metadataIndices: Uint32Array;
  metadata: StateDatumMetadata[];
};

export type StateTransitionSeriesConfig = {
  key: string;
  configIndex: number;
  enabled: boolean;
  label: string;
  timestampMethod: "receiveTime" | "headerStamp";
  y: number;
};

export type StateTransitionsDatasetAction =
  | { type: "reset" }
  | { type: "set-series"; series: StateTransitionSeriesConfig[] }
  | { type: "reset-series"; key: string }
  | { type: "reset-full"; key: string }
  | { type: "reset-current" }
  | { type: "append-full"; key: string; batch: PackedStateDatumBatch }
  | { type: "append-current"; key: string; batch: PackedStateDatumBatch };

export type StateTransitionsDatasetRequest = {
  viewport?: Viewport;
  /** Visible bounds before the half-window pan buffer is applied. */
  xBounds: { min: number; max: number };
  showPoints: boolean;
};

export type RenderDatumMetadata = Pick<
  Datum,
  "value" | "label" | "labelColor" | "constantName" | "states"
>;

/**
 * A dataset payload passed from the Dataset Worker through the coordinator to the Chart Worker.
 * Chart.js objects are reconstructed only in the Chart Worker, after the data is bounded by the
 * shared point budget.
 */
export type PackedStateTransitionDataset = {
  configIndex: number;
  label: string;
  y: number;
  x: Float64Array;
  metadataIndices: Uint32Array;
  metadata: RenderDatumMetadata[];
  borderWidth: number;
  pointBackgroundColor: string;
  pointBorderColor: string;
  pointHoverRadius: number;
  pointRadius: number;
  pointStyle: "circle";
  showLine: true;
};

type StoredMetadata = Required<Pick<Datum, "value" | "label" | "labelColor">> &
  Pick<Datum, "constantName">;

type SeriesState = {
  config: StateTransitionSeriesConfig;
  full: ChunkedSortedStateStore;
  current: CompactStateStore;
  metadata: StoredMetadata[];
  metadataByValue: Map<StateValue, Map<string, number>>;
};

type CompactPoints = {
  x: Float64Array;
  metadataIndices: Uint32Array;
};

type WindowSource = CompactPoints & {
  /** Orders samples with equal x values by their original append chronology. */
  appendOrdinal: number;
};

type XLookupStore = {
  length(): number;
  containsX(x: number): boolean;
};

type SortedRun = CompactPoints & {
  /** The first batch ordinal represented by this run. Runs cover disjoint ordinal intervals. */
  firstAppendOrdinal: number;
};

type ProcessedPoints = CompactPoints & {
  showLabel: Uint8Array;
};

type OutputPoint = {
  x: number;
  metadataIndex?: number;
  showLabel?: boolean;
  states?: string[];
};

/** Create a compact, exclusively-owned batch suitable for Comlink transfer. */
export function packStateDatums(datums: readonly StateDatum[]): PackedStateDatumBatch {
  const metadata: StateDatumMetadata[] = [];
  const metadataByValue = new Map<StateValue, Map<string, number>>();
  const x = new Float64Array(datums.length);
  const metadataIndices = new Uint32Array(datums.length);

  for (let i = 0; i < datums.length; i++) {
    const datum = datums[i]!;
    x[i] = datum.x;

    const metadataKey = metadataNameKey(datum.constantName);
    let byName = metadataByValue.get(datum.value);
    if (!byName) {
      byName = new Map();
      metadataByValue.set(datum.value, byName);
    }
    let metadataIndex = byName.get(metadataKey);
    if (metadataIndex == undefined) {
      metadataIndex = metadata.length;
      metadata.push({ value: datum.value, constantName: datum.constantName });
      byName.set(metadataKey, metadataIndex);
    }
    metadataIndices[i] = metadataIndex;
  }

  return { x, metadataIndices, metadata };
}

/** Reconstruct the bounded Chart.js datum objects in the Chart Worker. */
export function unpackStateTransitionDataset(dataset: PackedStateTransitionDataset): Datum[] {
  const data = new Array<Datum>(dataset.x.length);
  for (let i = 0; i < dataset.x.length; i++) {
    const metadata = dataset.metadata[dataset.metadataIndices[i]!] ?? {};
    data[i] = {
      x: dataset.x[i]!,
      y: dataset.y,
      ...metadata,
    };
  }
  return data;
}

/** Compact storage for a sorted x column and its discrete metadata ids. */
class CompactStateStore {
  #x = new GrowableTypedArray(Float64Array);
  #metadataIndices = new GrowableTypedArray(Uint32Array);
  #start = 0;

  public length(): number {
    return this.#x.length() - this.#start;
  }

  public xAt(index: number): number {
    return this.#x.at(this.#start + index) ?? NaN;
  }

  public metadataIndexAt(index: number): number {
    return this.#metadataIndices.at(this.#start + index) ?? NO_STATE;
  }

  public maxX(): number {
    return this.xAt(this.length() - 1);
  }

  public clear(): void {
    // A reset is also a memory boundary. Replacing the growable columns lets a series which
    // briefly held a large history release that peak capacity instead of retaining it forever.
    this.#x = new GrowableTypedArray(Float64Array);
    this.#metadataIndices = new GrowableTypedArray(Uint32Array);
    this.#start = 0;
  }

  public storageByteLength(): number {
    return (
      this.#x.capacity() * Float64Array.BYTES_PER_ELEMENT +
      this.#metadataIndices.capacity() * Uint32Array.BYTES_PER_ELEMENT
    );
  }

  public appendSorted(batch: CompactPoints, duplicatePolicy: "deduplicate" | "preserve"): void {
    if (batch.x.length === 0) {
      return;
    }

    const sorted = sortCompactPoints(batch);
    const deduplicate = duplicatePolicy === "deduplicate";
    if (this.length() === 0) {
      if (deduplicate) {
        this.#replace(deduplicateCompactPoints(sorted));
      } else {
        this.#replace(sorted);
      }
      return;
    }

    const lastExistingX = this.xAt(this.length() - 1);
    if (sorted.x[0]! >= lastExistingX) {
      let appendFrom = 0;
      if (deduplicate) {
        while (appendFrom < sorted.x.length && sorted.x[appendFrom] === lastExistingX) {
          appendFrom++;
        }
        const tail = deduplicateCompactPoints({
          x: sorted.x.slice(appendFrom),
          metadataIndices: sorted.metadataIndices.slice(appendFrom),
        });
        this.#x.appendAll(tail.x);
        this.#metadataIndices.appendAll(tail.metadataIndices);
      } else {
        this.#x.appendAll(sorted.x);
        this.#metadataIndices.appendAll(sorted.metadataIndices);
      }
      return;
    }

    const existingX = this.#x.view().subarray(this.#start);
    const existingMetadata = this.#metadataIndices.view().subarray(this.#start);
    const mergedX = new Float64Array(existingX.length + sorted.x.length);
    const mergedMetadata = new Uint32Array(mergedX.length);
    let existingIndex = 0;
    let batchIndex = 0;
    let writeIndex = 0;

    while (existingIndex < existingX.length || batchIndex < sorted.x.length) {
      const existingValue = existingX[existingIndex] ?? Infinity;
      const batchValue = sorted.x[batchIndex] ?? Infinity;

      if (existingValue <= batchValue) {
        mergedX[writeIndex] = existingValue;
        mergedMetadata[writeIndex] = existingMetadata[existingIndex]!;
        existingIndex++;
        writeIndex++;
        if (deduplicate && existingValue === batchValue) {
          batchIndex++;
        }
        continue;
      }

      if (deduplicate && writeIndex > 0 && mergedX[writeIndex - 1] === batchValue) {
        batchIndex++;
        continue;
      }
      mergedX[writeIndex] = batchValue;
      mergedMetadata[writeIndex] = sorted.metadataIndices[batchIndex]!;
      batchIndex++;
      writeIndex++;
    }

    this.#replace({
      x: mergedX.slice(0, writeIndex),
      metadataIndices: mergedMetadata.slice(0, writeIndex),
    });
  }

  public removeAtOrBefore(x: number): void {
    const from = this.firstIndexAfter(x);
    if (from === 0) {
      return;
    }
    this.#discardPrefix(from);
  }

  public removeXsPresentIn(other: XLookupStore): void {
    if (this.length() === 0 || other.length() === 0) {
      return;
    }
    const x = new Float64Array(this.length());
    const metadataIndices = new Uint32Array(this.length());
    let writeIndex = 0;
    for (let i = 0; i < this.length(); i++) {
      const value = this.xAt(i);
      if (other.containsX(value)) {
        continue;
      }
      x[writeIndex] = value;
      metadataIndices[writeIndex] = this.metadataIndexAt(i);
      writeIndex++;
    }
    this.#replace({
      x: x.slice(0, writeIndex),
      metadataIndices: metadataIndices.slice(0, writeIndex),
    });
  }

  public retainNewest(maxLength: number): void {
    if (this.length() <= maxLength) {
      return;
    }
    const from = this.#start + this.length() - maxLength;
    this.#replace({
      x: this.#x.view().slice(from),
      metadataIndices: this.#metadataIndices.view().slice(from),
    });
  }

  public containsX(x: number): boolean {
    return this.xAt(this.firstIndexAtOrAfter(x)) === x;
  }

  public forEachMetadataIndex(callback: (metadataIndex: number) => void): void {
    for (let i = 0; i < this.length(); i++) {
      callback(this.metadataIndexAt(i));
    }
  }

  public remapMetadataIndices(mapping: Uint32Array): void {
    const x = this.#x.view().slice(this.#start);
    const metadataIndices = new Uint32Array(this.length());
    for (let i = 0; i < this.length(); i++) {
      metadataIndices[i] = mapping[this.metadataIndexAt(i)] ?? NO_STATE;
    }
    this.#replace({ x, metadataIndices });
  }

  public windowSource(minX: number, maxX: number, appendOrdinal: number): WindowSource | undefined {
    if (this.length() === 0) {
      return undefined;
    }
    const validBounds = maxX >= minX;
    const from = validBounds ? Math.max(0, this.firstIndexAfter(minX) - 1) : 0;
    const to = validBounds
      ? Math.min(this.length(), this.firstIndexAfter(maxX) + 1)
      : this.length();
    return {
      x: this.#x.view().subarray(this.#start + from, this.#start + to),
      metadataIndices: this.#metadataIndices.view().subarray(this.#start + from, this.#start + to),
      appendOrdinal,
    };
  }

  public firstIndexAtOrAfter(x: number): number {
    let low = 0;
    let high = this.length();
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.xAt(mid) < x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  public firstIndexAfter(x: number): number {
    let low = 0;
    let high = this.length();
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.xAt(mid) <= x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  #replace(points: CompactPoints): void {
    this.#x = new GrowableTypedArray(Float64Array, points.x.length);
    this.#metadataIndices = new GrowableTypedArray(Uint32Array, points.metadataIndices.length);
    this.#start = 0;
    this.#x.appendAll(points.x);
    this.#metadataIndices.appendAll(points.metadataIndices);
  }

  #discardPrefix(count: number): void {
    this.#start += count;
    if (this.length() === 0) {
      this.clear();
      return;
    }
    // Keep appends O(1) while bounding stale ring storage to roughly twice the live window.
    if (this.#start >= this.length()) {
      this.#replace({
        x: this.#x.view().slice(this.#start),
        metadataIndices: this.#metadataIndices.view().slice(this.#start),
      });
    }
  }
}

/**
 * Full-history storage with a monotonic fast path and binomial immutable runs after the first
 * interleaved batch. A point participates in at most one merge per run level, so reverse or
 * interleaved range batches copy O(N log B) points instead of repeatedly copying all history.
 */
class ChunkedSortedStateStore implements XLookupStore {
  #base = new CompactStateStore();
  #levels: Array<SortedRun | undefined> = [];
  #runMode = false;
  #nextAppendOrdinal = 1;
  #length = 0;
  #maxX = NaN;
  #mergedPointCopies = 0;

  public length(): number {
    return this.#length;
  }

  public maxX(): number {
    return this.#maxX;
  }

  public clear(): void {
    this.#base.clear();
    this.#levels = [];
    this.#runMode = false;
    this.#nextAppendOrdinal = 1;
    this.#length = 0;
    this.#maxX = NaN;
    this.#mergedPointCopies = 0;
  }

  public storageByteLength(): number {
    let byteLength = this.#base.storageByteLength();
    for (const run of this.#levels) {
      if (run) {
        byteLength += run.x.byteLength + run.metadataIndices.byteLength;
      }
    }
    return byteLength;
  }

  public appendSorted(batch: CompactPoints): void {
    if (batch.x.length === 0) {
      return;
    }

    const sorted = sortCompactPoints(batch);
    if (!this.#runMode && (this.#base.length() === 0 || sorted.x[0]! >= this.#base.maxX())) {
      this.#base.appendSorted(sorted, "preserve");
      this.#length += sorted.x.length;
      this.#maxX = sorted.x[sorted.x.length - 1]!;
      return;
    }

    this.#runMode = true;
    const appendOrdinal = this.#nextAppendOrdinal++;
    let carry: SortedRun = {
      x: sorted.x,
      metadataIndices: sorted.metadataIndices,
      firstAppendOrdinal: appendOrdinal,
    };
    let level = 0;
    while (this.#levels[level]) {
      const older = this.#levels[level]!;
      this.#levels[level] = undefined;
      carry = mergeSortedRuns(older, carry);
      this.#mergedPointCopies += carry.x.length;
      level++;
    }
    this.#levels[level] = carry;
    this.#length += sorted.x.length;
    this.#maxX = Number.isNaN(this.#maxX)
      ? sorted.x[sorted.x.length - 1]!
      : Math.max(this.#maxX, sorted.x[sorted.x.length - 1]!);
  }

  public containsX(x: number): boolean {
    if (this.#base.containsX(x)) {
      return true;
    }
    for (const run of this.#levels) {
      if (!run) {
        continue;
      }
      if (run.x[lowerBound(run.x, x)] === x) {
        return true;
      }
    }
    return false;
  }

  public forEachMetadataIndex(callback: (metadataIndex: number) => void): void {
    this.#base.forEachMetadataIndex(callback);
    for (const run of this.#levels) {
      if (!run) {
        continue;
      }
      for (const metadataIndex of run.metadataIndices) {
        callback(metadataIndex);
      }
    }
  }

  public remapMetadataIndices(mapping: Uint32Array): void {
    this.#base.remapMetadataIndices(mapping);
    for (let level = 0; level < this.#levels.length; level++) {
      const run = this.#levels[level];
      if (!run) {
        continue;
      }
      const metadataIndices = new Uint32Array(run.metadataIndices.length);
      for (let i = 0; i < metadataIndices.length; i++) {
        metadataIndices[i] = mapping[run.metadataIndices[i]!] ?? NO_STATE;
      }
      this.#levels[level] = { ...run, metadataIndices };
    }
  }

  public windowSources(minX: number, maxX: number): WindowSource[] {
    const sources: WindowSource[] = [];
    const base = this.#base.windowSource(minX, maxX, 0);
    if (base) {
      sources.push(base);
    }
    for (const run of this.#levels) {
      if (!run) {
        continue;
      }
      const source = windowSourceForSortedPoints(run, minX, maxX, run.firstAppendOrdinal);
      if (source) {
        sources.push(source);
      }
    }
    return sources;
  }

  /** @internal Deterministic counters for complexity-regression tests. */
  public statsForTests(): { runCount: number; mergedPointCopies: number } {
    return {
      runCount:
        (this.#base.length() > 0 ? 1 : 0) + this.#levels.filter((run) => run != undefined).length,
      mergedPointCopies: this.#mergedPointCopies,
    };
  }
}

/** Dataset-worker implementation. No per-sample objects are retained after applyActions(). */
export class StateTransitionsDatasetBuilderImpl {
  #seriesByKey = new Map<string, SeriesState>();

  /** @internal Exposes retained typed-column capacity to memory-regression tests. */
  public getStorageByteLengthsForTests(): { full: number; current: number } {
    let full = 0;
    let current = 0;
    for (const series of this.#seriesByKey.values()) {
      full += series.full.storageByteLength();
      current += series.current.storageByteLength();
    }
    return { full, current };
  }

  /** @internal Exposes the full-history merge shape without relying on wall-clock timings. */
  public getFullStoreStatsForTests(): { runCount: number; mergedPointCopies: number } {
    let runCount = 0;
    let mergedPointCopies = 0;
    for (const series of this.#seriesByKey.values()) {
      const stats = series.full.statsForTests();
      runCount += stats.runCount;
      mergedPointCopies += stats.mergedPointCopies;
    }
    return { runCount, mergedPointCopies };
  }

  public applyActions(actions: Immutable<StateTransitionsDatasetAction[]>): void {
    for (const action of actions) {
      switch (action.type) {
        case "reset":
          this.#seriesByKey.clear();
          break;
        case "set-series":
          this.#setSeries(action.series);
          break;
        case "reset-series": {
          const series = this.#seriesByKey.get(action.key);
          series?.full.clear();
          series?.current.clear();
          if (series) {
            series.metadata = [];
            series.metadataByValue.clear();
          }
          break;
        }
        case "reset-full": {
          const series = this.#seriesByKey.get(action.key);
          series?.full.clear();
          if (series) {
            compactSeriesMetadata(series);
          }
          break;
        }
        case "reset-current":
          for (const series of this.#seriesByKey.values()) {
            series.current.clear();
            compactSeriesMetadata(series);
          }
          break;
        case "append-full":
          this.#append(action.key, action.batch, "full");
          break;
        case "append-current":
          this.#append(action.key, action.batch, "current");
          break;
      }
    }
  }

  public getViewportDatasets(
    request: Immutable<StateTransitionsDatasetRequest>,
  ): PackedStateTransitionDataset[] {
    const enabledSeries = [...this.#seriesByKey.values()].filter(({ config }) => config.enabled);
    if (!isValidDatasetRequest(request)) {
      return enabledSeries.map((series) =>
        this.#packDataset(series, [], { showPoints: request.showPoints }),
      );
    }
    const prepared = enabledSeries.map((series) => ({
      series,
      points: this.#prepareSeries(series, request),
    }));
    const budgets = allocatePointBudgets(
      prepared.map(({ points }) => points.x.length),
      MAX_POINTS,
    );

    return prepared.map(({ series, points }, index) =>
      this.#packDataset(
        series,
        selectOutputPoints(points, series.metadata, request, budgets[index] ?? 0),
        { showPoints: request.showPoints },
      ),
    );
  }

  #setSeries(configs: Immutable<StateTransitionSeriesConfig[]>): void {
    const next = new Map<string, SeriesState>();
    for (const config of configs) {
      const existing = this.#seriesByKey.get(config.key);
      next.set(
        config.key,
        existing ? { ...existing, config: { ...config } } : createSeries(config),
      );
    }
    this.#seriesByKey = next;
  }

  #append(key: string, batch: Immutable<PackedStateDatumBatch>, target: "full" | "current"): void {
    const series = this.#seriesByKey.get(key);
    if (!series || batch.x.length !== batch.metadataIndices.length) {
      return;
    }

    const metadataIndices = new Uint32Array(batch.metadataIndices.length);
    for (let i = 0; i < batch.metadataIndices.length; i++) {
      const incoming = batch.metadata[batch.metadataIndices[i]!];
      if (!incoming) {
        metadataIndices[i] = NO_STATE;
        continue;
      }
      metadataIndices[i] = internMetadata(series, incoming);
    }
    const valid = removeInvalidMetadata({ x: new Float64Array(batch.x), metadataIndices });

    if (target === "full") {
      series.full.appendSorted(valid);
      this.#trimCurrent(series);
      return;
    }

    let current = valid;
    if (series.config.timestampMethod === "headerStamp") {
      current = filterPoints(current, (x) => !series.full.containsX(x));
    } else if (series.full.length() > 0) {
      const lastFullX = series.full.maxX();
      current = filterPoints(current, (x) => x > lastFullX);
    }
    series.current.appendSorted(current, "deduplicate");
    series.current.retainNewest(MAX_CURRENT_DATUMS_PER_SERIES);
    compactSeriesMetadata(series);
  }

  #trimCurrent(series: SeriesState): void {
    if (series.full.length() === 0 || series.current.length() === 0) {
      return;
    }
    if (series.config.timestampMethod === "headerStamp") {
      series.current.removeXsPresentIn(series.full);
    } else {
      series.current.removeAtOrBefore(series.full.maxX());
    }
  }

  #prepareSeries(
    series: SeriesState,
    request: Immutable<StateTransitionsDatasetRequest>,
  ): ProcessedPoints {
    const viewRange = request.xBounds.max - request.xBounds.min;
    const pad = Number.isFinite(viewRange) && viewRange >= 0 ? viewRange * 0.5 : 0;
    const raw = mergeStoresForWindow(
      series.full,
      series.current,
      request.xBounds.min - pad,
      request.xBounds.max + pad,
    );
    return collapseStatePlateaus(raw, series.metadata, { showPoints: request.showPoints });
  }

  #packDataset(
    series: SeriesState,
    points: OutputPoint[],
    options: { showPoints: boolean },
  ): PackedStateTransitionDataset {
    const x = new Float64Array(points.length);
    const metadataIndices = new Uint32Array(points.length);
    const metadata: RenderDatumMetadata[] = [];
    const rawMetadataCache = new Map<string, number>();
    const compressedMetadataCache = new Map<string, number>();

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      x[i] = point.x;

      let outputMetadataIndex: number | undefined;
      if (point.states) {
        const key = JSON.stringify(point.states) ?? "";
        outputMetadataIndex = compressedMetadataCache.get(key);
        if (outputMetadataIndex == undefined) {
          outputMetadataIndex = metadata.length;
          metadata.push({
            label: "[...]",
            labelColor: grey,
            states: point.states,
            value: undefined,
          });
          compressedMetadataCache.set(key, outputMetadataIndex);
        }
      } else if (point.metadataIndex != undefined) {
        const key = `${point.metadataIndex}:${point.showLabel === true ? 1 : 0}`;
        outputMetadataIndex = rawMetadataCache.get(key);
        if (outputMetadataIndex == undefined) {
          const stored = series.metadata[point.metadataIndex]!;
          outputMetadataIndex = metadata.length;
          metadata.push({
            value: stored.value,
            label: point.showLabel === true ? stored.label : undefined,
            labelColor: stored.labelColor,
            constantName: stored.constantName,
          });
          rawMetadataCache.set(key, outputMetadataIndex);
        }
      }
      metadataIndices[i] = outputMetadataIndex ?? NO_STATE;
    }

    return {
      configIndex: series.config.configIndex,
      label: series.config.label,
      y: series.config.y,
      x,
      metadataIndices,
      metadata,
      borderWidth: 10,
      pointBackgroundColor: "rgba(0, 0, 0, 0.4)",
      pointBorderColor: "transparent",
      pointHoverRadius: 3,
      pointRadius: options.showPoints ? 1.25 : 0,
      pointStyle: "circle",
      showLine: true,
    };
  }
}

function createSeries(config: Immutable<StateTransitionSeriesConfig>): SeriesState {
  return {
    config: { ...config },
    full: new ChunkedSortedStateStore(),
    current: new CompactStateStore(),
    metadata: [],
    metadataByValue: new Map(),
  };
}

function isValidDatasetRequest(request: Immutable<StateTransitionsDatasetRequest>): boolean {
  if (
    !Number.isFinite(request.xBounds.min) ||
    !Number.isFinite(request.xBounds.max) ||
    request.xBounds.max < request.xBounds.min
  ) {
    return false;
  }

  const viewport = request.viewport;
  return (
    viewport == undefined ||
    (Number.isFinite(viewport.width) &&
      viewport.width > 0 &&
      Number.isFinite(viewport.bounds.x.min) &&
      Number.isFinite(viewport.bounds.x.max) &&
      viewport.bounds.x.max >= viewport.bounds.x.min)
  );
}

function metadataNameKey(constantName: string | undefined): string {
  return constantName == undefined ? "undefined" : `string:${constantName}`;
}

function internMetadata(series: SeriesState, incoming: Immutable<StateDatumMetadata>): number {
  const metadataKey = metadataNameKey(incoming.constantName);
  let byName = series.metadataByValue.get(incoming.value);
  if (!byName) {
    byName = new Map();
    series.metadataByValue.set(incoming.value, byName);
  }
  const existing = byName.get(metadataKey);
  if (existing != undefined) {
    return existing;
  }

  const label =
    incoming.constantName != undefined
      ? `${incoming.constantName} (${String(incoming.value)})`
      : String(incoming.value);
  const valueForColor =
    typeof incoming.value === "string"
      ? stringHash(incoming.value)
      : Math.round(Number(incoming.value));
  const metadataIndex = series.metadata.length;
  series.metadata.push({
    value: incoming.value,
    constantName: incoming.constantName,
    label,
    labelColor:
      expandedLineColors[positiveModulo(valueForColor, expandedLineColors.length)] ?? grey,
  });
  byName.set(metadataKey, metadataIndex);
  return metadataIndex;
}

function compactSeriesMetadata(series: SeriesState): void {
  const pointCount = series.full.length() + series.current.length();
  if (series.metadata.length <= pointCount * 2 + 1_024) {
    return;
  }

  const used = new Set<number>();
  series.full.forEachMetadataIndex((metadataIndex) => used.add(metadataIndex));
  series.current.forEachMetadataIndex((metadataIndex) => used.add(metadataIndex));
  const mapping = new Uint32Array(series.metadata.length);
  mapping.fill(NO_STATE);
  const metadata: StoredMetadata[] = [];
  const metadataByValue = new Map<StateValue, Map<string, number>>();
  for (let oldIndex = 0; oldIndex < series.metadata.length; oldIndex++) {
    if (!used.has(oldIndex)) {
      continue;
    }
    const stored = series.metadata[oldIndex]!;
    const newIndex = metadata.length;
    mapping[oldIndex] = newIndex;
    metadata.push(stored);
    let byName = metadataByValue.get(stored.value);
    if (!byName) {
      byName = new Map();
      metadataByValue.set(stored.value, byName);
    }
    byName.set(metadataNameKey(stored.constantName), newIndex);
  }
  series.full.remapMetadataIndices(mapping);
  series.current.remapMetadataIndices(mapping);
  series.metadata = metadata;
  series.metadataByValue = metadataByValue;
}

function removeInvalidMetadata(points: CompactPoints): CompactPoints {
  return filterPoints(points, (_x, index) => points.metadataIndices[index] !== NO_STATE);
}

function filterPoints(
  points: CompactPoints,
  predicate: (x: number, index: number) => boolean,
): CompactPoints {
  const x = new Float64Array(points.x.length);
  const metadataIndices = new Uint32Array(points.x.length);
  let writeIndex = 0;
  for (let i = 0; i < points.x.length; i++) {
    if (!predicate(points.x[i]!, i)) {
      continue;
    }
    x[writeIndex] = points.x[i]!;
    metadataIndices[writeIndex] = points.metadataIndices[i]!;
    writeIndex++;
  }
  return {
    x: x.slice(0, writeIndex),
    metadataIndices: metadataIndices.slice(0, writeIndex),
  };
}

function sortCompactPoints(points: CompactPoints): CompactPoints {
  let sorted = true;
  for (let i = 1; i < points.x.length; i++) {
    if (points.x[i - 1]! > points.x[i]!) {
      sorted = false;
      break;
    }
  }
  if (sorted) {
    return points;
  }

  const order = Array.from(points.x.keys()).sort((a, b) => {
    const difference = points.x[a]! - points.x[b]!;
    return difference !== 0 ? difference : a - b;
  });
  const x = new Float64Array(order.length);
  const metadataIndices = new Uint32Array(order.length);
  for (let i = 0; i < order.length; i++) {
    const sourceIndex = order[i]!;
    x[i] = points.x[sourceIndex]!;
    metadataIndices[i] = points.metadataIndices[sourceIndex]!;
  }
  return { x, metadataIndices };
}

function deduplicateCompactPoints(points: CompactPoints): CompactPoints {
  if (points.x.length < 2) {
    return points;
  }
  return filterPoints(points, (x, index) => index === 0 || points.x[index - 1] !== x);
}

function mergeSortedRuns(older: SortedRun, newer: SortedRun): SortedRun {
  const x = new Float64Array(older.x.length + newer.x.length);
  const metadataIndices = new Uint32Array(x.length);
  let olderIndex = 0;
  let newerIndex = 0;
  let writeIndex = 0;
  while (olderIndex < older.x.length || newerIndex < newer.x.length) {
    if (
      newerIndex >= newer.x.length ||
      (olderIndex < older.x.length && older.x[olderIndex]! <= newer.x[newerIndex]!)
    ) {
      x[writeIndex] = older.x[olderIndex]!;
      metadataIndices[writeIndex] = older.metadataIndices[olderIndex]!;
      olderIndex++;
    } else {
      x[writeIndex] = newer.x[newerIndex]!;
      metadataIndices[writeIndex] = newer.metadataIndices[newerIndex]!;
      newerIndex++;
    }
    writeIndex++;
  }
  return { x, metadataIndices, firstAppendOrdinal: older.firstAppendOrdinal };
}

function windowSourceForSortedPoints(
  points: CompactPoints,
  minX: number,
  maxX: number,
  appendOrdinal: number,
): WindowSource | undefined {
  if (points.x.length === 0) {
    return undefined;
  }
  const validBounds = maxX >= minX;
  const from = validBounds ? Math.max(0, upperBound(points.x, minX) - 1) : 0;
  const to = validBounds
    ? Math.min(points.x.length, upperBound(points.x, maxX) + 1)
    : points.x.length;
  return {
    x: points.x.subarray(from, to),
    metadataIndices: points.metadataIndices.subarray(from, to),
    appendOrdinal,
  };
}

function mergeStoresForWindow(
  full: ChunkedSortedStateStore,
  current: CompactStateStore,
  minX: number,
  maxX: number,
): CompactPoints {
  const validBounds = maxX >= minX;
  const sources = full.windowSources(minX, maxX);
  const currentSource = current.windowSource(minX, maxX, Number.POSITIVE_INFINITY);
  if (currentSource) {
    sources.push(currentSource);
  }

  const mergedLength = sources.reduce((sum, source) => sum + source.x.length, 0);
  const mergedX = new Float64Array(mergedLength);
  const mergedMetadata = new Uint32Array(mergedX.length);
  const sourceIndices = new Uint32Array(sources.length);
  for (let writeIndex = 0; writeIndex < mergedLength; writeIndex++) {
    let selectedSource = -1;
    let selectedX = NaN;
    let selectedOrdinal = Number.POSITIVE_INFINITY;
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sources[sourceIndex]!;
      const pointIndex = sourceIndices[sourceIndex]!;
      if (pointIndex >= source.x.length) {
        continue;
      }
      const candidateX = source.x[pointIndex]!;
      if (
        selectedSource === -1 ||
        candidateX < selectedX ||
        (candidateX === selectedX && source.appendOrdinal < selectedOrdinal)
      ) {
        selectedSource = sourceIndex;
        selectedX = candidateX;
        selectedOrdinal = source.appendOrdinal;
      }
    }
    const source = sources[selectedSource]!;
    const pointIndex = sourceIndices[selectedSource]!;
    mergedX[writeIndex] = selectedX;
    mergedMetadata[writeIndex] = source.metadataIndices[pointIndex]!;
    sourceIndices[selectedSource] = pointIndex + 1;
  }

  const merged = { x: mergedX, metadataIndices: mergedMetadata };
  if (!validBounds || merged.x.length === 0) {
    return merged;
  }

  const firstAfterMin = upperBound(merged.x, minX);
  const from = Math.max(0, firstAfterMin - 1);
  let to = upperBound(merged.x, maxX);
  if (to > 0 && to < merged.x.length) {
    to++;
  }
  if (from >= to) {
    return from < merged.x.length && merged.x[from]! <= minX
      ? {
          x: merged.x.slice(from, from + 1),
          metadataIndices: merged.metadataIndices.slice(from, from + 1),
        }
      : { x: new Float64Array(), metadataIndices: new Uint32Array() };
  }
  return {
    x: merged.x.slice(from, to),
    metadataIndices: merged.metadataIndices.slice(from, to),
  };
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid]! <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function collapseStatePlateaus(
  points: CompactPoints,
  metadata: readonly StoredMetadata[],
  options: { showPoints: boolean },
): ProcessedPoints {
  const x = new Float64Array(points.x.length);
  const metadataIndices = new Uint32Array(points.x.length);
  const showLabel = new Uint8Array(points.x.length);
  let writeIndex = 0;
  let haveLastValue = false;
  let lastValue: StateValue | undefined;
  let lastSuppressed = -1;

  for (let i = 0; i < points.x.length; i++) {
    const metadataIndex = points.metadataIndices[i]!;
    const value = metadata[metadataIndex]?.value;
    if (value == undefined) {
      continue;
    }
    const isNewSegment = !haveLastValue || lastValue !== value;
    haveLastValue = true;
    lastValue = value;

    if (isNewSegment || options.showPoints) {
      x[writeIndex] = points.x[i]!;
      metadataIndices[writeIndex] = metadataIndex;
      showLabel[writeIndex] = isNewSegment ? 1 : 0;
      writeIndex++;
      lastSuppressed = -1;
    } else {
      lastSuppressed = i;
    }
  }

  if (lastSuppressed >= 0) {
    x[writeIndex] = points.x[lastSuppressed]!;
    metadataIndices[writeIndex] = points.metadataIndices[lastSuppressed]!;
    showLabel[writeIndex] = 0;
    writeIndex++;
  }

  return {
    x: x.slice(0, writeIndex),
    metadataIndices: metadataIndices.slice(0, writeIndex),
    showLabel: showLabel.slice(0, writeIndex),
  };
}

function allOutputPoints(points: ProcessedPoints): OutputPoint[] {
  return Array.from(points.x, (x, index) => ({
    x,
    metadataIndex: points.metadataIndices[index],
    showLabel: points.showLabel[index] === 1,
  }));
}

function selectOutputPoints(
  points: ProcessedPoints,
  metadata: readonly StoredMetadata[],
  request: Immutable<StateTransitionsDatasetRequest>,
  budget: number,
): OutputPoint[] {
  if (points.x.length <= budget && !request.viewport) {
    return allOutputPoints(points);
  }
  if (budget <= 0) {
    return [];
  }

  const min = request.viewport?.bounds.x.min ?? request.xBounds.min;
  const max = request.viewport?.bounds.x.max ?? request.xBounds.max;
  if (!(max > min)) {
    if (points.x.length <= budget) {
      return allOutputPoints(points);
    }
    const states = Array.from(
      new Set(
        Array.from(
          points.metadataIndices,
          (metadataIndex) => metadata[metadataIndex]?.label,
        ).filter((label): label is string => label != undefined),
      ),
    );
    const lastIndex = points.x.length - 1;
    if (budget === 1) {
      return [
        {
          x: points.x[lastIndex]!,
          metadataIndex: points.metadataIndices[lastIndex],
          showLabel: points.showLabel[lastIndex] === 1,
        },
      ];
    }
    return [
      { x: points.x[0]!, states },
      {
        x: points.x[lastIndex]!,
        metadataIndex: points.metadataIndices[lastIndex],
        showLabel: points.showLabel[lastIndex] === 1,
      },
    ];
  }

  const viewport = request.viewport ?? {
    // Two output points per interval, with enough synthetic pixels to use the entire budget.
    width: Math.max(3, Math.ceil(budget / 2) * MINIMUM_PIXEL_DISTANCE),
    height: 1,
    bounds: { x: { min, max }, y: { min: 0, max: 1 } },
  };
  // When the assigned budget already fits the series, preserve the original pixel-bucket
  // semantics. The shared budget should tighten dense series, not make a sparse series look
  // artificially compressed merely because it happens to have a small allocation.
  const maxPoints = points.x.length <= budget ? undefined : budget;
  return downsampleCompactStates(points, metadata, viewport, maxPoints, {
    showPoints: request.showPoints,
  });
}

/** Compact equivalent of downsampleStates(), retaining its half-window and states semantics. */
function downsampleCompactStates(
  points: ProcessedPoints,
  metadata: readonly StoredMetadata[],
  viewport: Immutable<Viewport>,
  maxPoints: number | undefined,
  options: { showPoints: boolean },
): OutputPoint[] {
  if (
    points.x.length === 0 ||
    viewport.width <= 0 ||
    (maxPoints != undefined && maxPoints <= 0) ||
    !(viewport.bounds.x.max > viewport.bounds.x.min)
  ) {
    return maxPoints != undefined && maxPoints <= 0 ? [] : allOutputPoints(points);
  }

  const xRange = viewport.bounds.x.max - viewport.bounds.x.min;
  const minX = viewport.bounds.x.min - xRange * 0.5;
  const maxX = viewport.bounds.x.max + xRange * 0.5;
  const interiorFrom = lowerBound(points.x, minX);
  const interiorTo = upperBound(points.x, maxX);
  const beforeIndex = interiorFrom > 0 ? interiorFrom - 1 : undefined;
  const afterIndex = interiorTo < points.x.length ? interiorTo : undefined;

  // Continuity points live outside the pixel buckets. Reserve their slots first so they cannot
  // make a water-filled allocation exceed the global budget.
  let remainingBudget = maxPoints ?? Number.POSITIVE_INFINITY;
  const beforePoint =
    beforeIndex != undefined && remainingBudget > 0
      ? outputPointAt(points, beforeIndex)
      : undefined;
  if (beforePoint) {
    remainingBudget--;
  }
  const afterPoint =
    afterIndex != undefined && remainingBudget > 0
      ? outputPointAt(points, afterIndex, maxX)
      : undefined;
  if (afterPoint) {
    remainingBudget--;
  }

  if (interiorFrom >= interiorTo || remainingBudget <= 0) {
    return [beforePoint, afterPoint].filter((point): point is OutputPoint => point != undefined);
  }

  const numPixelIntervals = Math.trunc(viewport.width / MINIMUM_PIXEL_DISTANCE);
  const numIntervals =
    maxPoints == undefined
      ? numPixelIntervals
      : Math.min(Math.trunc(remainingBudget / 2), numPixelIntervals * 2);
  if (numIntervals <= 0) {
    return [beforePoint, outputPointAt(points, interiorTo - 1), afterPoint].filter(
      (point): point is OutputPoint => point != undefined,
    );
  }

  const samplingRange = maxPoints == undefined ? xRange : maxX - minX;
  const pixelPerXValue = numIntervals / samplingRange;
  const xValuePerPixel = 1 / pixelPerXValue;
  const output: OutputPoint[] = [];
  const outputBudget = remainingBudget;
  let interval:
    | {
        x: number;
        xPixel: number;
        endX: number;
        firstIndex: number;
        lastIndex: number;
        transitionCount: number;
        lastLabel?: string;
        states: string[];
        stateSet: Set<string>;
      }
    | undefined;

  const finishInterval = () => {
    if (!interval) {
      return;
    }
    if (interval.transitionCount === 1) {
      if (output.length < outputBudget) {
        output.push({
          x: interval.x,
          metadataIndex: points.metadataIndices[interval.firstIndex],
          showLabel: points.showLabel[interval.firstIndex] === 1,
        });
      }
    } else {
      const finalPoint = {
        x: interval.endX,
        metadataIndex: points.metadataIndices[interval.lastIndex],
        showLabel: points.showLabel[interval.lastIndex] === 1,
      };
      if (output.length + 2 <= outputBudget) {
        output.push({ x: interval.x, states: interval.states }, finalPoint);
      } else if (output.length < outputBudget) {
        // With one slot left, the real final state is more useful for continuity than a synthetic
        // compressed-state marker.
        output.push(finalPoint);
      }
    }
  };

  for (let i = interiorFrom; i < interiorTo; i++) {
    const x = points.x[i]!;
    const shouldShowLabel = points.showLabel[i] === 1;
    const label = metadata[points.metadataIndices[i]!]?.label;
    if (!options.showPoints && !shouldShowLabel) {
      const outputLengthBeforeInterval = output.length;
      finishInterval();
      interval = undefined;
      const endpoint = outputPointAt(points, i);
      if (output.length - outputLengthBeforeInterval === 2) {
        // Preserve a compressed interval as a pair while extending its final state to the real
        // plateau endpoint.
        output[output.length - 1] = endpoint;
      } else if (
        output.length - outputLengthBeforeInterval === 1 &&
        output.length >= outputBudget
      ) {
        // A one-slot interval must still end at the real plateau boundary.
        output[output.length - 1] = endpoint;
      } else if (output.length < outputBudget) {
        output.push(endpoint);
      }
      continue;
    }
    if (label == undefined) {
      continue;
    }

    const xPixel = Math.trunc(x * pixelPerXValue);
    if (interval && interval.xPixel !== xPixel) {
      finishInterval();
      interval = undefined;
    }
    if (!interval) {
      interval = {
        x,
        xPixel,
        endX: xPixel * xValuePerPixel + xValuePerPixel,
        firstIndex: i,
        lastIndex: i,
        transitionCount: 1,
        lastLabel: label,
        states: [label],
        stateSet: new Set([label]),
      };
      continue;
    }

    interval.lastIndex = i;
    if (interval.lastLabel !== label) {
      interval.transitionCount++;
      interval.lastLabel = label;
      if (!interval.stateSet.has(label)) {
        interval.stateSet.add(label);
        interval.states.push(label);
      }
    }
  }

  finishInterval();
  return [beforePoint, ...output, afterPoint].filter(
    (point): point is OutputPoint => point != undefined,
  );
}

function outputPointAt(points: ProcessedPoints, index: number, x = points.x[index]!): OutputPoint {
  return {
    x,
    metadataIndex: points.metadataIndices[index],
    showLabel: points.showLabel[index] === 1,
  };
}
