// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Datum } from "./types";

/**
 * Fingerprint for processed-dataset caches. Includes the head/tail endpoints as well as length so
 * any in-place endpoint mutation (same length, new x) still invalidates the cache.
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
 * concatenation and copies only the visible window.
 *
 * Result is identical to slicing the materialized merge: `currentData` contributes only samples
 * strictly newer than the last `fullData` sample, matching the previous merge semantics. This is
 * only valid for receive-time-ordered series; header-stamped series must use
 * {@link sliceInterleavedStateDataForViewport} because their currentData can interleave with
 * fullData on the x axis.
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

/**
 * As {@link sliceMergedStateDataForViewport}, but for series whose currentData can interleave
 * with fullData on the x axis. Header stamps are not monotonic in receive order, so a live
 * sample's stamp may fall between block stamps; the concatenation-based slice would silently
 * drop it.
 *
 * Each store contributes a bounded candidate window (its last sample at or before minX through
 * its first sample after maxX); the two windows are merged and the standard single-array slice
 * applies the margin semantics to the merge. Every global boundary candidate is inside some
 * store's candidate window, so the result equals slicing the materialized sorted merge — at
 * O(log history + window) cost, never O(history).
 *
 * Assumes exact-x duplicates across the two stores were already removed at ingestion
 * (StateTransitionsCoordinator dedupes header-stamped samples by stamp membership).
 */
export function sliceInterleavedStateDataForViewport(
  fullData: readonly Datum[],
  currentData: readonly Datum[],
  minX: number,
  maxX: number,
): Datum[] {
  if (fullData.length === 0) {
    return sliceStateDataForViewport(currentData, minX, maxX);
  }
  if (currentData.length === 0) {
    return sliceStateDataForViewport(fullData, minX, maxX);
  }
  if (!(maxX >= minX)) {
    // Degenerate/NaN bounds: preserve the "return everything" behaviour of the base slice.
    return mergeSortedByX(fullData.slice(), currentData.slice());
  }

  const candidateWindow = (data: readonly Datum[]): Datum[] => {
    const from = Math.max(0, firstIndexAfter(data, minX) - 1);
    const to = Math.min(data.length, firstIndexAfter(data, maxX) + 1);
    return data.slice(from, Math.max(from, to));
  };

  return sliceStateDataForViewport(
    mergeSortedByX(candidateWindow(fullData), candidateWindow(currentData)),
    minX,
    maxX,
  );
}

/** Merge two x-sorted arrays into one x-sorted array (stable: `a` wins ties). */
export function mergeSortedByX(a: readonly Datum[], b: readonly Datum[]): Datum[] {
  const merged: Datum[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]!.x <= b[j]!.x) {
      merged.push(a[i++]!);
    } else {
      merged.push(b[j++]!);
    }
  }
  while (i < a.length) {
    merged.push(a[i++]!);
  }
  while (j < b.length) {
    merged.push(b[j++]!);
  }
  return merged;
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
