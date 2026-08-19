// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as Comlink from "@coscene-io/comlink";

import { allocatePointBudgets } from "@foxglove/den/collection";
import { fromNanoSec, isTime, toNanoSec } from "@foxglove/rostime";
import { Immutable, Time } from "@foxglove/studio";
import {
  continueDownsample,
  DownsampleState,
  finishDownsample,
  initDownsample,
  MAX_POINTS,
  POINTS_PER_INTERVAL,
  downsampleScatter,
} from "@foxglove/studio-base/components/TimeBasedChart/downsample";
import { Bounds1D } from "@foxglove/studio-base/types/Bounds";

import { CsvDataset, SeriesConfigKey, SeriesItem, Viewport } from "./IDatasetsBuilder";
import type { Dataset } from "../ChartRenderer";
import {
  attachUnpackedDataAccessor,
  getPackedDatasetTransferables,
  PackedDatasetWriter,
} from "../PackedDataset";
import { Datum, OriginalValue } from "../datum";

export type DataItem = Datum & { receiveTime: Time; headerStamp?: Time };

type Series = {
  config: Immutable<SeriesItem>;
  current: CompactSeriesData;
  full: CompactSeriesData;
  prefixRevision: number;
  windowExtremaCache?: WindowExtremaCache;
  downsampleCache?: {
    key: string;
    prefixRevision: number;
    processedEnd: number;
    indices: number[];
    state: DownsampleState;
  };
};

type ResetSeriesFullAction = { type: "reset-full"; series: SeriesConfigKey };
type ResetSeriesCurrentAction = { type: "reset-current"; series: SeriesConfigKey };
type UpdateSeriesCurrentAction = {
  type: "append-current";
  series: SeriesConfigKey;
  items: DataItem[];
};
type UpdateSeriesFullAction = {
  type: "append-full";
  series: SeriesConfigKey;
  items: DataItem[];
};
type UpdateSeriesConfigAction = { type: "update-series-config"; seriesItems: SeriesItem[] };

export type UpdateDataAction =
  | UpdateSeriesConfigAction
  | ResetSeriesFullAction
  | ResetSeriesCurrentAction
  | UpdateSeriesCurrentAction
  | UpdateSeriesFullAction;

const MAX_CURRENT_DATUMS_PER_SERIES = 50_000;
const RETAINED_CURRENT_DATUMS_PER_SERIES = 37_500;
const EPSILON = 1e-5;
const MAX_UINT64 = (1n << 64n) - 1n;
const MISSING_TIME = MAX_UINT64;
// Real ROS timestamps are far below this range. Reserving it keeps exceptional negative or very
// large values lossless without adding a fallback column to every point.
const TIME_FALLBACK_BASE = MAX_UINT64 - (1n << 32n);

enum StoredValueKind {
  Number,
  Boolean,
  PositiveBigInt,
  NegativeBigInt,
  Time,
  String,
  Fallback,
}

class StoredValueCodec {
  readonly #strings: string[] = [];
  readonly #stringIds = new Map<string, number>();
  readonly #fallbackValues: OriginalValue[] = [];

  public encode(value: OriginalValue): readonly [StoredValueKind, bigint] {
    switch (typeof value) {
      case "number":
        return [StoredValueKind.Number, 0n];
      case "boolean":
        return [StoredValueKind.Boolean, 0n];
      case "bigint": {
        const magnitude = value < 0n ? -value : value;
        if (magnitude <= MAX_UINT64) {
          return [
            value < 0n ? StoredValueKind.NegativeBigInt : StoredValueKind.PositiveBigInt,
            magnitude,
          ];
        }
        return this.#encodeFallback(value);
      }
      case "string": {
        let id = this.#stringIds.get(value);
        if (id == undefined) {
          id = this.#strings.length;
          this.#strings.push(value);
          this.#stringIds.set(value, id);
        }
        return [StoredValueKind.String, BigInt(id)];
      }
      case "object": {
        if (isTime(value) && isCanonicalNonnegativeTime(value)) {
          try {
            const nanoseconds = toNanoSec(value);
            if (nanoseconds >= 0n && nanoseconds <= MAX_UINT64) {
              return [StoredValueKind.Time, nanoseconds];
            }
          } catch {
            // Preserve malformed legacy Time objects in the exceptional value table.
          }
        }
        // Store an owned copy so the exceptional table cannot retain a view into a decoded
        // message for the life of the series.
        return this.#encodeFallback(isTime(value) ? { sec: value.sec, nsec: value.nsec } : value);
      }
    }
  }

  public decode(kind: StoredValueKind, payload: bigint, y: number): OriginalValue {
    switch (kind) {
      case StoredValueKind.Number:
        return y;
      case StoredValueKind.Boolean:
        return y !== 0;
      case StoredValueKind.PositiveBigInt:
        return payload;
      case StoredValueKind.NegativeBigInt:
        return -payload;
      case StoredValueKind.Time:
        return fromNanoSec(payload);
      case StoredValueKind.String:
        return this.#strings[Number(payload)] ?? "";
      case StoredValueKind.Fallback:
        return this.#fallbackValues[Number(payload)] ?? y;
    }
  }

  #encodeFallback(value: OriginalValue): readonly [StoredValueKind, bigint] {
    const index = this.#fallbackValues.length;
    this.#fallbackValues.push(value);
    return [StoredValueKind.Fallback, BigInt(index)];
  }
}

class StoredTimeCodec {
  readonly #fallbackTimes: Time[] = [];

  public encode(value: Immutable<Time> | undefined): bigint {
    if (value == undefined) {
      return MISSING_TIME;
    }
    try {
      if (!isCanonicalNonnegativeTime(value)) {
        throw new RangeError("Timestamp is not in canonical form");
      }
      const nanoseconds = toNanoSec(value);
      if (nanoseconds >= 0n && nanoseconds < TIME_FALLBACK_BASE) {
        return nanoseconds;
      }
    } catch {
      // Fractional seconds existed in older fixtures and are kept losslessly below.
    }
    const index = this.#fallbackTimes.length;
    if (index >= 0xffff_ffff) {
      throw new RangeError("Too many exceptional timestamps in a plot series");
    }
    this.#fallbackTimes.push({ sec: value.sec, nsec: value.nsec });
    return TIME_FALLBACK_BASE + BigInt(index);
  }

  public decode(value: bigint): Time | undefined {
    if (value === MISSING_TIME) {
      return undefined;
    }
    if (value >= TIME_FALLBACK_BASE) {
      return this.#fallbackTimes[Number(value - TIME_FALLBACK_BASE)];
    }
    return fromNanoSec(value);
  }
}

type EncodedBatch = {
  length: number;
  xy: Float64Array;
  receiveTimes: BigUint64Array;
  headerStamps: BigUint64Array;
  valueKinds: Uint8Array;
  valuePayloads: BigUint64Array;
};

class CompactSeriesData {
  public length = 0;
  #capacity = 0;
  #xy = new Float64Array();
  #receiveTimes = new BigUint64Array();
  #headerStamps = new BigUint64Array();
  #valueKinds = new Uint8Array();
  #valuePayloads = new BigUint64Array();
  #xMin = Infinity;
  #xMax = -Infinity;
  #yMin = Infinity;
  #yMax = -Infinity;
  readonly #valueCodec = new StoredValueCodec();
  readonly #receiveTimeCodec = new StoredTimeCodec();
  readonly #headerStampCodec = new StoredTimeCodec();
  readonly #onPointEncoded?: () => void;

  public constructor(onPointEncoded?: () => void) {
    this.#onPointEncoded = onPointEncoded;
  }

  public getX(index: number): number {
    return this.#xy[index * 2]!;
  }

  public getY(index: number): number {
    return this.#xy[index * 2 + 1]!;
  }

  public getValue(index: number): OriginalValue {
    return this.#valueCodec.decode(
      this.#valueKinds[index] as StoredValueKind,
      this.#valuePayloads[index]!,
      this.getY(index),
    );
  }

  public getReceiveTime(index: number): Time {
    const decoded = this.#receiveTimeCodec.decode(this.#receiveTimes[index]!);
    if (decoded == undefined) {
      throw new Error("A plot datum is missing its receive timestamp");
    }
    return decoded;
  }

  public getHeaderStamp(index: number): Time | undefined {
    return this.#headerStampCodec.decode(this.#headerStamps[index]!);
  }

  public getBounds(): { xMin: number; xMax: number; yMin: number; yMax: number } {
    return { xMin: this.#xMin, xMax: this.#xMax, yMin: this.#yMin, yMax: this.#yMax };
  }

  public lowerBound(x: number): number {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.getX(mid) < x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  public upperBound(x: number): number {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.getX(mid) <= x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  public appendItems(
    items: Immutable<DataItem[]>,
    ordering: "headerStamp" | "receiveTime",
    duplicatePolicy: "deduplicate" | "preserve",
    minimumXExclusive?: number,
  ): boolean {
    const batch = this.#encodeBatch(items, ordering, duplicatePolicy, minimumXExclusive);
    if (batch.length === 0) {
      return true;
    }
    const appendedAtEnd = this.length === 0 || this.getX(this.length - 1) <= batch.xy[0]!;
    if (appendedAtEnd) {
      this.#appendOrderedBatch(batch, duplicatePolicy);
    } else {
      this.#mergeOrderedBatch(batch, duplicatePolicy);
    }
    return appendedAtEnd;
  }

  public sliceFrom(start: number): CompactSeriesData {
    const first = Math.min(Math.max(0, start), this.length);
    if (first === 0) {
      return this;
    }
    const result = new CompactSeriesData(this.#onPointEncoded);
    const items = new Array<DataItem>(this.length - first);
    for (let index = first; index < this.length; index++) {
      items[index - first] = {
        x: this.getX(index),
        y: this.getY(index),
        value: this.getValue(index),
        receiveTime: this.getReceiveTime(index),
        headerStamp: this.getHeaderStamp(index),
      };
    }
    result.appendItems(items, "receiveTime", "preserve");
    return result;
  }

  #encodeBatch(
    items: Immutable<DataItem[]>,
    ordering: "headerStamp" | "receiveTime",
    duplicatePolicy: "deduplicate" | "preserve",
    minimumXExclusive?: number,
  ): EncodedBatch {
    const acceptedIndices: number[] = [];
    let sorted = true;
    let previousX = -Infinity;
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (minimumXExclusive != undefined && item.x <= minimumXExclusive) {
        continue;
      }
      acceptedIndices.push(index);
      if (item.x < previousX) {
        sorted = false;
      }
      previousX = item.x;
    }
    // header.stamp can arrive out of order. Sort the batch once, then linearly merge it into the
    // typed history; never splice a typed column per point.
    if (ordering === "headerStamp" || !sorted) {
      acceptedIndices.sort((left, right) => items[left]!.x - items[right]!.x);
    }

    if (duplicatePolicy === "deduplicate") {
      let writeIndex = 0;
      for (const itemIndex of acceptedIndices) {
        const item = items[itemIndex]!;
        const previousItemIndex = acceptedIndices[writeIndex - 1];
        const previousItem = previousItemIndex == undefined ? undefined : items[previousItemIndex];
        if (
          (previousItem != undefined && isDuplicatePoint(previousItem, item.x, item.y)) ||
          this.#containsDuplicate(item.x, item.y)
        ) {
          continue;
        }
        acceptedIndices[writeIndex++] = itemIndex;
      }
      acceptedIndices.length = writeIndex;
    }

    const length = acceptedIndices.length;
    const batch: EncodedBatch = {
      length,
      xy: new Float64Array(length * 2),
      receiveTimes: new BigUint64Array(length),
      headerStamps: new BigUint64Array(length),
      valueKinds: new Uint8Array(length),
      valuePayloads: new BigUint64Array(length),
    };
    for (let outputIndex = 0; outputIndex < length; outputIndex++) {
      const item = items[acceptedIndices[outputIndex]!]!;
      this.#onPointEncoded?.();
      batch.xy[outputIndex * 2] = item.x;
      batch.xy[outputIndex * 2 + 1] = item.y;
      batch.receiveTimes[outputIndex] = this.#receiveTimeCodec.encode(item.receiveTime);
      batch.headerStamps[outputIndex] = this.#headerStampCodec.encode(item.headerStamp);
      const [kind, payload] = this.#valueCodec.encode(item.value);
      batch.valueKinds[outputIndex] = kind;
      batch.valuePayloads[outputIndex] = payload;
    }
    return batch;
  }

  #containsDuplicate(x: number, y: number): boolean {
    let index = this.lowerBound(x - EPSILON);
    while (index < this.length && this.getX(index) - x < EPSILON) {
      if (isDuplicatePoint({ x: this.getX(index), y: this.getY(index) }, x, y)) {
        return true;
      }
      index++;
    }
    return false;
  }

  #appendOrderedBatch(batch: EncodedBatch, duplicatePolicy: "deduplicate" | "preserve"): void {
    this.#ensureCapacity(this.length + batch.length);
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
      if (
        duplicatePolicy === "deduplicate" &&
        this.length > 0 &&
        this.#isDuplicate(this.length - 1, batch, batchIndex)
      ) {
        continue;
      }
      this.#copyBatchPoint(this.length, batch, batchIndex);
      this.length++;
    }
  }

  #mergeOrderedBatch(batch: EncodedBatch, duplicatePolicy: "deduplicate" | "preserve"): void {
    const capacity = nextCapacity(this.length + batch.length);
    const xy = new Float64Array(capacity * 2);
    const receiveTimes = new BigUint64Array(capacity);
    const headerStamps = new BigUint64Array(capacity);
    const valueKinds = new Uint8Array(capacity);
    const valuePayloads = new BigUint64Array(capacity);
    let currentIndex = 0;
    let batchIndex = 0;
    let outputIndex = 0;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    const extendBounds = (x: number, y: number): void => {
      if (Number.isFinite(x)) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
      }
      if (Number.isFinite(y)) {
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    };

    const appendCurrent = (): void => {
      const x = this.getX(currentIndex);
      const y = this.getY(currentIndex);
      if (duplicatePolicy === "preserve" || !isDuplicateXY(xy, outputIndex, x, y)) {
        xy[outputIndex * 2] = x;
        xy[outputIndex * 2 + 1] = y;
        receiveTimes[outputIndex] = this.#receiveTimes[currentIndex]!;
        headerStamps[outputIndex] = this.#headerStamps[currentIndex]!;
        valueKinds[outputIndex] = this.#valueKinds[currentIndex]!;
        valuePayloads[outputIndex] = this.#valuePayloads[currentIndex]!;
        extendBounds(x, y);
        outputIndex++;
      }
      currentIndex++;
    };
    const appendBatch = (): void => {
      const x = batch.xy[batchIndex * 2]!;
      const y = batch.xy[batchIndex * 2 + 1]!;
      if (duplicatePolicy === "preserve" || !isDuplicateXY(xy, outputIndex, x, y)) {
        xy[outputIndex * 2] = x;
        xy[outputIndex * 2 + 1] = y;
        receiveTimes[outputIndex] = batch.receiveTimes[batchIndex]!;
        headerStamps[outputIndex] = batch.headerStamps[batchIndex]!;
        valueKinds[outputIndex] = batch.valueKinds[batchIndex]!;
        valuePayloads[outputIndex] = batch.valuePayloads[batchIndex]!;
        extendBounds(x, y);
        outputIndex++;
      }
      batchIndex++;
    };
    while (currentIndex < this.length && batchIndex < batch.length) {
      if (this.getX(currentIndex) <= batch.xy[batchIndex * 2]!) {
        appendCurrent();
      } else {
        appendBatch();
      }
    }
    while (currentIndex < this.length) {
      appendCurrent();
    }
    while (batchIndex < batch.length) {
      appendBatch();
    }

    this.#capacity = capacity;
    this.length = outputIndex;
    this.#xy = xy;
    this.#receiveTimes = receiveTimes;
    this.#headerStamps = headerStamps;
    this.#valueKinds = valueKinds;
    this.#valuePayloads = valuePayloads;
    this.#xMin = xMin;
    this.#xMax = xMax;
    this.#yMin = yMin;
    this.#yMax = yMax;
  }

  #isDuplicate(existingIndex: number, batch: EncodedBatch, batchIndex: number): boolean {
    return (
      Math.abs(this.getX(existingIndex) - batch.xy[batchIndex * 2]!) < EPSILON &&
      Math.abs(this.getY(existingIndex) - batch.xy[batchIndex * 2 + 1]!) < EPSILON
    );
  }

  #copyBatchPoint(targetIndex: number, batch: EncodedBatch, batchIndex: number): void {
    const x = batch.xy[batchIndex * 2]!;
    const y = batch.xy[batchIndex * 2 + 1]!;
    this.#xy[targetIndex * 2] = x;
    this.#xy[targetIndex * 2 + 1] = y;
    this.#receiveTimes[targetIndex] = batch.receiveTimes[batchIndex]!;
    this.#headerStamps[targetIndex] = batch.headerStamps[batchIndex]!;
    this.#valueKinds[targetIndex] = batch.valueKinds[batchIndex]!;
    this.#valuePayloads[targetIndex] = batch.valuePayloads[batchIndex]!;
    if (Number.isFinite(x)) {
      this.#xMin = Math.min(this.#xMin, x);
      this.#xMax = Math.max(this.#xMax, x);
    }
    if (Number.isFinite(y)) {
      this.#yMin = Math.min(this.#yMin, y);
      this.#yMax = Math.max(this.#yMax, y);
    }
  }

  #ensureCapacity(required: number): void {
    if (required <= this.#capacity) {
      return;
    }
    const capacity = nextCapacity(required);
    const xy = new Float64Array(capacity * 2);
    xy.set(this.#xy.subarray(0, this.length * 2));
    const receiveTimes = new BigUint64Array(capacity);
    receiveTimes.set(this.#receiveTimes.subarray(0, this.length));
    const headerStamps = new BigUint64Array(capacity);
    headerStamps.set(this.#headerStamps.subarray(0, this.length));
    const valueKinds = new Uint8Array(capacity);
    valueKinds.set(this.#valueKinds.subarray(0, this.length));
    const valuePayloads = new BigUint64Array(capacity);
    valuePayloads.set(this.#valuePayloads.subarray(0, this.length));
    this.#capacity = capacity;
    this.#xy = xy;
    this.#receiveTimes = receiveTimes;
    this.#headerStamps = headerStamps;
    this.#valueKinds = valueKinds;
    this.#valuePayloads = valuePayloads;
  }
}

function nextCapacity(required: number): number {
  let capacity = 16;
  while (capacity < required) {
    capacity *= 2;
  }
  return capacity;
}

function isDuplicateXY(output: Float64Array, length: number, x: number, y: number): boolean {
  return (
    length > 0 &&
    Math.abs(output[(length - 1) * 2]! - x) < EPSILON &&
    Math.abs(output[(length - 1) * 2 + 1]! - y) < EPSILON
  );
}

function isDuplicatePoint(point: { x: number; y: number }, x: number, y: number): boolean {
  return Math.abs(point.x - x) < EPSILON && Math.abs(point.y - y) < EPSILON;
}

function isCanonicalNonnegativeTime(value: Immutable<Time>): boolean {
  return (
    Number.isSafeInteger(value.sec) &&
    value.sec >= 0 &&
    Number.isSafeInteger(value.nsec) &&
    value.nsec >= 0 &&
    value.nsec < 1_000_000_000
  );
}

type WindowPlan = {
  series: Series;
  start: number;
  end: number;
  count: number;
  downsampleViewport: {
    width: number;
    height: number;
    bounds: { x: Bounds1D; y: Bounds1D };
  };
  reserveDiscontinuity: boolean;
};

type WindowExtremaCache = {
  prefixRevision: number;
  start: number;
  processedEnd: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export class TimestampDatasetsBuilderImpl {
  #seriesByKey = new Map<SeriesConfigKey, Series>();
  readonly #onDownsamplePointVisited?: () => void;
  readonly #onExtremaPointVisited?: () => void;
  readonly #onStoredPointEncoded?: () => void;

  public constructor(
    options: {
      onDownsamplePointVisited?: () => void;
      onExtremaPointVisited?: () => void;
      onStoredPointEncoded?: () => void;
    } = {},
  ) {
    this.#onDownsamplePointVisited = options.onDownsamplePointVisited;
    this.#onExtremaPointVisited = options.onExtremaPointVisited;
    this.#onStoredPointEncoded = options.onStoredPointEncoded;
  }

  public getViewportDatasets(viewport: Immutable<Viewport>): Dataset[] {
    const plans: WindowPlan[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (series.config.enabled) {
        plans.push(this.#makeWindowPlan(series, viewport));
      }
    }
    // Scatter output is capped by pixel occupancy rather than by its allocation; a scatter share
    // is only a raw pass-through threshold. Water-fill each group separately so long scatter
    // series cannot starve the line series, which do treat their shares as hard caps.
    const budgets = new Array<number>(plans.length).fill(0);
    for (const wantLine of [true, false]) {
      const groupIndices: number[] = [];
      for (let index = 0; index < plans.length; index++) {
        if (plans[index]!.series.config.showLine === wantLine) {
          groupIndices.push(index);
        }
      }
      const groupBudgets = allocatePointBudgets(
        groupIndices.map(
          (index) => plans[index]!.count + (plans[index]!.reserveDiscontinuity ? 1 : 0),
        ),
        MAX_POINTS,
      );
      groupIndices.forEach((planIndex, groupIndex) => {
        budgets[planIndex] = groupBudgets[groupIndex]!;
      });
    }
    const datasets: Dataset[] = [];

    for (let planIndex = 0; planIndex < plans.length; planIndex++) {
      const plan = plans[planIndex]!;
      const { series } = plan;
      const budget = budgets[planIndex]!;
      const allowDiscontinuity = plan.reserveDiscontinuity && budget > 1;
      const maximumDataPoints = Math.max(0, budget - (allowDiscontinuity ? 1 : 0));
      let relativeIndices: number[];
      if (plan.count === 0) {
        relativeIndices = [];
      } else if (
        maximumDataPoints > 0 &&
        plan.count <= maximumDataPoints &&
        plan.count < plan.downsampleViewport.width
      ) {
        relativeIndices = Array.from({ length: plan.count }, (_, index) => index);
      } else if (series.config.showLine) {
        const downsampledIndices =
          maximumDataPoints === 0 ? [] : this.#getLineDownsampleIndices(plan, maximumDataPoints);
        // The bucket pass already sizes its intervals from the budget; re-thinning its output
        // would drop the min/max extrema it deliberately kept. Only below one interval's worth of
        // points can it exceed the budget (a lone interval emits up to four points), so only then
        // thin the result.
        relativeIndices =
          maximumDataPoints < POINTS_PER_INTERVAL
            ? limitIndices(downsampledIndices, maximumDataPoints)
            : downsampledIndices;
      } else {
        // Scatter plots use budget only as the threshold. Pixel occupancy may legitimately return
        // more than the nominal global point budget.
        relativeIndices = downsampleScatter(
          this.#iterateWindowPoints(plan),
          plan.downsampleViewport,
        );
      }

      const hasCurrentPoint = relativeIndices.some(
        (relativeIndex) => plan.start + relativeIndex >= series.full.length,
      );
      const addDiscontinuity =
        allowDiscontinuity && series.config.showLine && series.full.length > 0 && hasCurrentPoint;
      const writer = new PackedDatasetWriter(relativeIndices.length + (addDiscontinuity ? 1 : 0));
      let outputIndex = 0;
      let discontinuityAdded = !addDiscontinuity;
      const derivative = isDerivative(series);
      for (const relativeIndex of relativeIndices) {
        const index = plan.start + relativeIndex;
        if (!discontinuityAdded && index >= series.full.length) {
          writer.set(outputIndex++, NaN, NaN, NaN);
          discontinuityAdded = true;
        }
        const x = getSeriesX(series, index);
        const y = getSeriesY(series, index);
        writer.set(outputIndex++, x, y, derivative ? y : getSeriesValue(series, index));
      }

      const packedData = writer.finish();
      const dataset = attachUnpackedDataAccessor({
        borderColor: series.config.color,
        showLine: series.config.showLine,
        fill: false,
        borderWidth: series.config.lineSize,
        pointRadius:
          series.config.showLine &&
          relativeIndices.length < plan.count &&
          relativeIndices.length > 1
            ? 0
            : series.config.lineSize * 1.2,
        pointHoverRadius: 3,
        pointBackgroundColor: series.config.showLine
          ? series.config.contrastColor
          : series.config.color,
        pointBorderColor: "transparent",
        packedData,
      });
      datasets[series.config.configIndex] = dataset;
    }

    const transferables = datasets.flatMap((dataset) =>
      dataset.packedData ? getPackedDatasetTransferables(dataset.packedData) : [],
    );
    return Comlink.transfer(datasets, transferables);
  }

  public getCsvData(): CsvDataset[] {
    const datasets: CsvDataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      const data = new Array<Datum>(series.full.length + series.current.length);
      for (let index = 0; index < data.length; index++) {
        const storeIndex = getStoreIndex(series, index);
        const store = storeIndex.store;
        data[index] = {
          x: store.getX(storeIndex.index),
          y: store.getY(storeIndex.index),
          receiveTime: store.getReceiveTime(storeIndex.index),
          headerStamp: store.getHeaderStamp(storeIndex.index),
          value: store.getValue(storeIndex.index),
        };
      }
      datasets.push({ label: series.config.messagePath, data });
    }
    return datasets;
  }

  public getXRange(): Bounds1D {
    let min = Infinity;
    let max = -Infinity;
    for (const series of this.#seriesByKey.values()) {
      if (!series.config.enabled) {
        continue;
      }
      if (series.full.length > 0) {
        min = Math.min(min, series.full.getX(0));
        max = Math.max(max, series.full.getX(series.full.length - 1));
      }
      if (series.current.length > 0) {
        min = Math.min(min, series.current.getX(0));
        max = Math.max(max, series.current.getX(series.current.length - 1));
      }
    }
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 100 };
  }

  public applyActions(actions: Immutable<UpdateDataAction[]>): void {
    for (const action of actions) {
      this.applyAction(action);
    }
  }

  public applyAction(action: Immutable<UpdateDataAction>): void {
    switch (action.type) {
      case "reset-current": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.current = new CompactSeriesData(this.#onStoredPointEncoded);
          series.prefixRevision++;
        }
        break;
      }
      case "reset-full": {
        const series = this.#seriesByKey.get(action.series);
        if (series) {
          series.full = new CompactSeriesData(this.#onStoredPointEncoded);
          series.prefixRevision++;
        }
        break;
      }
      case "append-current": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        const lastFullX =
          series.full.length > 0 ? series.full.getX(series.full.length - 1) : undefined;
        const appendedAtEnd = series.current.appendItems(
          action.items,
          series.config.timestampMethod,
          "deduplicate",
          lastFullX,
        );
        if (!appendedAtEnd) {
          series.prefixRevision++;
        }
        if (series.current.length > MAX_CURRENT_DATUMS_PER_SERIES) {
          series.current = series.current.sliceFrom(
            series.current.length - RETAINED_CURRENT_DATUMS_PER_SERIES,
          );
          series.prefixRevision++;
        }
        break;
      }
      case "append-full": {
        const series = this.#seriesByKey.get(action.series);
        if (!series) {
          return;
        }
        const currentWasEmpty = series.current.length === 0;
        const appendedAtEnd = series.full.appendItems(
          action.items,
          series.config.timestampMethod,
          "preserve",
        );
        if (!currentWasEmpty || !appendedAtEnd) {
          series.prefixRevision++;
        }
        if (series.full.length > 0) {
          const firstCurrent = series.current.upperBound(series.full.getX(series.full.length - 1));
          if (firstCurrent > 0) {
            series.current = series.current.sliceFrom(firstCurrent);
            series.prefixRevision++;
          }
        }
        break;
      }
      case "update-series-config":
        this.#updateSeriesConfigAction(action.seriesItems);
        break;
    }
  }

  #makeWindowPlan(series: Series, viewport: Immutable<Viewport>): WindowPlan {
    const length = series.full.length + series.current.length;
    const derivative = isDerivative(series);
    let start = 0;
    let end = length;
    // Interactive (pan/zoom/sync) bounds move on nearly every frame; exact bounds would change
    // the downsample cache key each time and redo the whole window. Align them like the following
    // window so drag frames inside one grid cell reuse the incremental caches. Scatter series
    // have no incremental cache — a larger window only adds scan cost — so they keep exact
    // bounds. The chart still clips to the exact interactive bounds at draw time.
    const alignForCacheReuse =
      viewport.following === true || (viewport.interactive === true && series.config.showLine);
    const queryXBounds = alignForCacheReuse
      ? alignQueryBounds(viewport.bounds.x)
      : viewport.bounds.x;
    const queryYBounds =
      viewport.interactive === true && series.config.showLine
        ? alignQueryBounds(viewport.bounds.y)
        : viewport.bounds.y;
    const minimumX = queryXBounds?.min;
    const maximumX = queryXBounds?.max;
    if (minimumX != undefined && Number.isFinite(minimumX)) {
      start = Math.max(0, lowerBoundSeries(series, minimumX) - 1);
    }
    if (maximumX != undefined && Number.isFinite(maximumX)) {
      end = Math.min(length, upperBoundSeries(series, maximumX) + 1);
    }
    if (end < start) {
      end = start;
    }
    if (derivative) {
      start = Math.max(1, start);
    }

    let extrema: WindowExtremaCache;
    if (!derivative && start === 0 && end === length) {
      const fullBounds = series.full.getBounds();
      const currentBounds = series.current.getBounds();
      extrema = {
        prefixRevision: series.prefixRevision,
        start,
        processedEnd: end,
        xMin: Math.min(fullBounds.xMin, currentBounds.xMin),
        xMax: Math.max(fullBounds.xMax, currentBounds.xMax),
        yMin: Math.min(fullBounds.yMin, currentBounds.yMin),
        yMax: Math.max(fullBounds.yMax, currentBounds.yMax),
      };
    } else {
      extrema = this.#getWindowExtrema(series, start, end);
    }
    return {
      series,
      start,
      end,
      count: Math.max(0, end - start),
      downsampleViewport: {
        width: Math.max(1, viewport.size.width),
        height: Math.max(1, viewport.size.height),
        bounds: {
          x: resolveBounds(queryXBounds, extrema.xMin, extrema.xMax),
          y: resolveBounds(queryYBounds, extrema.yMin, extrema.yMax),
        },
      },
      reserveDiscontinuity:
        series.config.showLine && series.full.length > 0 && end > series.full.length,
    };
  }

  #getWindowExtrema(series: Series, start: number, end: number): WindowExtremaCache {
    const existingCache = series.windowExtremaCache;
    const cacheIsValid =
      existingCache?.prefixRevision === series.prefixRevision &&
      existingCache.start === start &&
      existingCache.processedEnd <= end;
    const cache: WindowExtremaCache = cacheIsValid
      ? existingCache
      : {
          prefixRevision: series.prefixRevision,
          start,
          processedEnd: start,
          xMin: Infinity,
          xMax: -Infinity,
          yMin: Infinity,
          yMax: -Infinity,
        };
    if (!cacheIsValid) {
      series.windowExtremaCache = cache;
    }
    for (let index = cache.processedEnd; index < end; index++) {
      this.#onExtremaPointVisited?.();
      const x = getSeriesX(series, index);
      const y = getSeriesY(series, index);
      if (Number.isFinite(x)) {
        cache.xMin = Math.min(cache.xMin, x);
        cache.xMax = Math.max(cache.xMax, x);
      }
      if (Number.isFinite(y)) {
        cache.yMin = Math.min(cache.yMin, y);
        cache.yMax = Math.max(cache.yMax, y);
      }
    }
    cache.processedEnd = end;
    return cache;
  }

  *#iterateWindowPoints(plan: WindowPlan): Iterable<{ index: number; x: number; y: number }> {
    yield* this.#iterateSeriesPoints(plan.series, plan.start, plan.end);
  }

  *#iterateSeriesPoints(
    series: Series,
    start: number,
    end: number,
  ): Iterable<{ index: number; x: number; y: number }> {
    for (let index = start; index < end; index++) {
      this.#onDownsamplePointVisited?.();
      yield {
        index: index - start,
        x: getSeriesX(series, index),
        y: getSeriesY(series, index),
      };
    }
  }

  #getLineDownsampleIndices(plan: WindowPlan, maximumDataPoints: number): number[] {
    const { bounds, width, height } = plan.downsampleViewport;
    const key = [
      plan.start,
      maximumDataPoints,
      width,
      height,
      bounds.x.min,
      bounds.x.max,
      bounds.y.min,
      bounds.y.max,
    ].join(":");
    const existingCache = plan.series.downsampleCache;
    const cacheIsValid =
      existingCache?.key === key &&
      existingCache.prefixRevision === plan.series.prefixRevision &&
      existingCache.processedEnd <= plan.end;
    const cache: NonNullable<Series["downsampleCache"]> = cacheIsValid
      ? existingCache
      : {
          key,
          prefixRevision: plan.series.prefixRevision,
          processedEnd: plan.start,
          indices: [],
          state: initDownsample(plan.downsampleViewport, maximumDataPoints),
        };
    if (!cacheIsValid) {
      plan.series.downsampleCache = cache;
    }
    if (cache.processedEnd < plan.end) {
      const [newIndices, state] = continueDownsample(
        this.#iterateSeriesPoints(plan.series, cache.processedEnd, plan.end),
        cache.state,
      );
      cache.indices.push(...newIndices);
      cache.state = state;
      cache.processedEnd = plan.end;
    }
    return [...cache.indices, ...finishDownsample(cache.state)];
  }

  #updateSeriesConfigAction(seriesItems: Immutable<SeriesItem[]>): void {
    const newSeries = new Map<SeriesConfigKey, Series>();
    for (const config of seriesItems) {
      let existingSeries = this.#seriesByKey.get(config.key);
      existingSeries ??= {
        config,
        current: new CompactSeriesData(this.#onStoredPointEncoded),
        full: new CompactSeriesData(this.#onStoredPointEncoded),
        prefixRevision: 0,
      };
      existingSeries.config = config;
      newSeries.set(config.key, existingSeries);
    }
    this.#seriesByKey = newSeries;
  }
}

function limitIndices(indices: readonly number[], maximum: number): number[] {
  if (indices.length <= maximum) {
    return [...indices];
  }
  if (maximum <= 0) {
    return [];
  }
  if (maximum === 1) {
    return [indices[indices.length - 1]!];
  }
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round((index * (indices.length - 1)) / (maximum - 1));
    return indices[sourceIndex]!;
  });
}

function alignQueryBounds(
  configured: Immutable<Partial<Bounds1D>> | undefined,
): Immutable<Partial<Bounds1D>> | undefined {
  const min = configured?.min;
  const max = configured?.max;
  if (
    min == undefined ||
    max == undefined ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return configured;
  }

  const gridSize = 2 ** Math.ceil(Math.log2(max - min));
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return configured;
  }

  // A fixed two-cell query window covers the exact requested range even while its edges sit
  // between grid lines. It moves only once per power-of-two cell instead of once per frame.
  const alignedMax = Math.ceil(max / gridSize) * gridSize;
  const alignedMin = alignedMax - gridSize * 2;
  if (!Number.isFinite(alignedMin) || !Number.isFinite(alignedMax)) {
    return configured;
  }
  return { min: alignedMin, max: alignedMax };
}

function resolveBounds(
  configured: Immutable<Partial<Bounds1D>> | undefined,
  dataMin: number,
  dataMax: number,
): Bounds1D {
  const configuredMin = configured?.min;
  const configuredMax = configured?.max;
  const hasConfiguredMin = configuredMin != undefined && Number.isFinite(configuredMin);
  const hasConfiguredMax = configuredMax != undefined && Number.isFinite(configuredMax);
  let min = hasConfiguredMin ? configuredMin : Number.isFinite(dataMin) ? dataMin : 0;
  let max = hasConfiguredMax ? configuredMax : Number.isFinite(dataMax) ? dataMax : min + 1;
  if (min > max) {
    [min, max] = [max, min];
  }
  if (min === max) {
    const padding = Math.max(Math.abs(min) * Number.EPSILON, 0.5);
    min -= padding;
    max += padding;
  }
  // Auto-ranging would otherwise change the downsampling transform on every appended block and
  // force an O(history) rescan. Power-of-two alignment changes only logarithmically as data grows,
  // while configured viewport edges remain exact.
  if (!hasConfiguredMin || !hasConfiguredMax) {
    const span = Math.max(max - min, Number.EPSILON);
    const interval = 2 ** Math.ceil(Math.log2(span));
    if (!hasConfiguredMin) {
      min = Math.floor(min / interval) * interval;
    }
    if (!hasConfiguredMax) {
      max = Math.ceil(max / interval) * interval;
    }
    if (min === max) {
      max = min + interval;
    }
  }
  return { min, max };
}

function isDerivative(series: Series): boolean {
  return series.config.parsed.modifier === "derivative";
}

function getStoreIndex(series: Series, index: number): { store: CompactSeriesData; index: number } {
  return index < series.full.length
    ? { store: series.full, index }
    : { store: series.current, index: index - series.full.length };
}

function getSeriesX(series: Series, index: number): number {
  const storeIndex = getStoreIndex(series, index);
  return storeIndex.store.getX(storeIndex.index);
}

function getSeriesY(series: Series, index: number): number {
  const storeIndex = getStoreIndex(series, index);
  const y = storeIndex.store.getY(storeIndex.index);
  if (!isDerivative(series)) {
    return y;
  }
  if (index === 0) {
    return NaN;
  }
  const previousStoreIndex = getStoreIndex(series, index - 1);
  const previousX = previousStoreIndex.store.getX(previousStoreIndex.index);
  const previousY = previousStoreIndex.store.getY(previousStoreIndex.index);
  const dx = storeIndex.store.getX(storeIndex.index) - previousX;
  return dx === 0 ? NaN : (y - previousY) / dx;
}

function getSeriesValue(series: Series, index: number): OriginalValue {
  const storeIndex = getStoreIndex(series, index);
  return storeIndex.store.getValue(storeIndex.index);
}

function lowerBoundSeries(series: Series, x: number): number {
  if (series.full.length === 0) {
    return series.current.lowerBound(x);
  }
  const lastFullX = series.full.getX(series.full.length - 1);
  return x <= lastFullX
    ? series.full.lowerBound(x)
    : series.full.length + series.current.lowerBound(x);
}

function upperBoundSeries(series: Series, x: number): number {
  if (series.full.length === 0) {
    return series.current.upperBound(x);
  }
  const lastFullX = series.full.getX(series.full.length - 1);
  return x < lastFullX
    ? series.full.upperBound(x)
    : series.full.length + series.current.upperBound(x);
}
