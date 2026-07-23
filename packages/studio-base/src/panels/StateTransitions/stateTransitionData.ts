// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Datum } from "./types";

/**
 * Append a state-transition sample, collapsing consecutive equal values.
 *
 * Storage shape for a plateau of value V from t0..t1:
 *   [{ x: t0, value: V }, { x: t1, value: V }]
 * Further samples with the same value only advance the trailing endpoint.
 *
 * This preserves segment start/end for chart rendering while dropping the
 * dense interior samples that dominate high-rate continuous/plateau series
 * (REI-125: ~250 Hz joint states into StateTransitions).
 */
export function appendCollapsedStateSample(data: Datum[], datum: Datum): void {
  const last = data[data.length - 1];
  if (last == undefined) {
    data.push(datum);
    return;
  }

  if (last.value !== datum.value) {
    data.push(datum);
    return;
  }

  // Same value: extend plateau. Keep a dedicated trailing endpoint when possible.
  const prev = data[data.length - 2];
  if (prev != undefined && prev.value === datum.value) {
    // Already have start + end of plateau; advance the end.
    // NOTE: length is unchanged — consumers that cache by length alone will go stale
    // unless they also key on the trailing endpoint (see processCacheFingerprint).
    last.x = datum.x;
    last.label = datum.label;
    last.labelColor = datum.labelColor;
    last.constantName = datum.constantName;
    last.y = datum.y;
    return;
  }

  // Only the plateau start exists; add the first trailing endpoint.
  data.push(datum);
}

/**
 * Fingerprint for processed-dataset caches. Must include the trailing endpoint so
 * in-place plateau extension (same length, new last.x) invalidates the cache.
 */
export function processCacheFingerprint(
  data: readonly Datum[],
  y: number,
  viewMin: number,
  viewMax: number,
): string {
  if (data.length === 0) {
    return `0|${y}|${viewMin}|${viewMax}`;
  }
  const head = data[0]!;
  const tail = data[data.length - 1]!;
  return [data.length, y, viewMin, viewMax, head.x, tail.x, String(tail.value)].join("|");
}

/**
 * Slice the merged (fullData ++ newer currentData) series to the visible x-window **without
 * materializing the merge**.
 *
 * `sliceStateDataForViewport(getMergedData(...))` was O(total history) per rebuild: the merge
 * copied the entire preloaded series before the window narrowed it, and rebuilds run on every
 * player emit plus every pan/zoom interaction. This walks the two sorted arrays as one virtual
 * concatenation and copies only the visible window (REI-125 review).
 *
 * Result is identical to slicing the materialized merge: `currentData` contributes only samples
 * strictly newer than the last `fullData` sample, matching the previous merge semantics.
 *
 * The window is materialized with native `Array.slice` rather than an element-by-element copy
 * through the virtual accessor. A/B measurement showed the naive loop was ~2x *slower* than the
 * old merge-then-slice for mid-sized series (~1k-10k samples, the range a partially preloaded bag
 * actually reaches) even though it won by 100x at 400k; native slice wins in every regime.
 */
export function sliceMergedStateDataForViewport(
  fullData: readonly Datum[],
  currentData: readonly Datum[],
  minX: number,
  maxX: number,
): Datum[] {
  const fullLength = fullData.length;
  const lastFullX = fullLength > 0 ? fullData[fullLength - 1]!.x : -Infinity;

  // First index of currentData strictly newer than fullData's last sample.
  const currentStart = firstIndexAfter(currentData, lastFullX);
  const currentLength = currentData.length - currentStart;
  const totalLength = fullLength + currentLength;
  if (totalLength === 0) {
    return [];
  }

  // Virtual index into the concatenation; both halves are sorted and the second is strictly newer.
  const at = (index: number): Datum =>
    index < fullLength ? fullData[index]! : currentData[currentStart + index - fullLength]!;

  /** Copy [startIdx, endIdx) out of the virtual concatenation using native slices. */
  const collect = (startIdx: number, endIdx: number): Datum[] => {
    if (endIdx <= fullLength) {
      return fullData.slice(startIdx, endIdx);
    }
    const currentFrom = currentStart + Math.max(0, startIdx - fullLength);
    const currentTo = currentStart + endIdx - fullLength;
    if (startIdx >= fullLength) {
      return currentData.slice(currentFrom, currentTo);
    }
    // Window straddles the boundary.
    return fullData.slice(startIdx, fullLength).concat(currentData.slice(currentFrom, currentTo));
  };

  if (!(maxX >= minX)) {
    // Degenerate/NaN bounds: preserve the previous "return everything" behaviour.
    return collect(0, totalLength);
  }

  // lo is the first index with x > minX. Include lo-1 for continuity when present.
  const startIdx = Math.max(0, firstIndexAfterVirtual(at, 0, totalLength, minX) - 1);
  let endIdx = firstIndexAfterVirtual(at, startIdx, totalLength, maxX); // exclusive

  // A state is rendered as a line between samples. Keep the first point after the window so a
  // collapsed plateau whose endpoints surround the viewport still has a segment to draw.
  // Do not do this when the entire dataset starts after the window: there is no active state yet.
  if (endIdx > 0 && endIdx < totalLength) {
    endIdx += 1;
  }

  if (startIdx >= endIdx) {
    // No points in range; still return the last point before minX if any.
    if (startIdx < totalLength && at(startIdx).x <= minX) {
      return [at(startIdx)];
    }
    return [];
  }

  return collect(startIdx, endIdx);
}

/** First index of a sorted array whose x is strictly greater than `x`. */
function firstIndexAfter(data: readonly Datum[], x: number): number {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid]!.x <= x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** As {@link firstIndexAfter}, over a virtual array addressed by `at` within [lo, hi). */
function firstIndexAfterVirtual(
  at: (index: number) => Datum,
  from: number,
  to: number,
  x: number,
): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid).x <= x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Slice sorted state samples to the visible x-window, retaining the last sample
 * at or before minX so the first visible segment has the correct state.
 */
export function sliceStateDataForViewport(
  data: readonly Datum[],
  minX: number,
  maxX: number,
): Datum[] {
  if (data.length === 0) {
    return [];
  }
  if (!(maxX >= minX)) {
    return data.slice();
  }

  // Binary search for first index with x > minX (strictly after window start).
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid]!.x <= minX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo is first index with x > minX. Include lo-1 for continuity when present.
  const startIdx = Math.max(0, lo - 1);

  // Binary search for first index with x > maxX.
  lo = startIdx;
  hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid]!.x <= maxX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  let endIdx = lo; // exclusive

  // Retain the first post-window point for line continuity. This is required for collapsed
  // plateaus such as [start, end] when the viewport lies entirely between the two endpoints.
  if (endIdx > 0 && endIdx < data.length) {
    endIdx += 1;
  }

  if (startIdx >= endIdx) {
    // No points in range; still return last point before minX if any.
    if (startIdx < data.length && data[startIdx]!.x <= minX) {
      return [data[startIdx]!];
    }
    return [];
  }

  return data.slice(startIdx, endIdx);
}
