// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * COCO compressed RLE (pycocotools `rleToString` / `rleFrString`) and a column-major interval
 * form that the GPU overlay samples directly.
 *
 * The backend `Mask` carries only `counts`. Runs scan the source frame in column-major
 * (Fortran) order and alternate background/foreground, starting with background. The frame size
 * is not in the message; it is the decoded size of the observation's topic, so every decode
 * here takes it explicitly and rejects counts whose total does not cover exactly width × height.
 */

/** Foreground as sorted, disjoint [start, end) pairs over the column-major index x * height + y. */
export type MaskRuns = {
  width: number;
  height: number;
  intervals: Uint32Array;
  area: number;
  /** Inclusive pixel bounds; undefined for an empty mask. */
  bbox: { x0: number; y0: number; x1: number; y1: number } | undefined;
};

export function decodeCounts(counts: string): number[] {
  const out: number[] = [];
  let p = 0;
  while (p < counts.length) {
    let x = 0;
    let k = 0;
    let more = true;
    while (more) {
      if (p >= counts.length || k > 6) {
        throw new Error("Malformed RLE counts: truncated run length");
      }
      const c = counts.charCodeAt(p) - 48;
      if (c < 0 || c > 63) {
        throw new Error("Malformed RLE counts: character outside the COCO alphabet");
      }
      x |= (c & 0x1f) << (5 * k);
      more = (c & 0x20) !== 0;
      p++;
      k++;
      if (!more && (c & 0x10) !== 0) {
        x |= -1 << (5 * k);
      }
    }
    if (out.length > 2) {
      x += out[out.length - 2]!;
    }
    if (x < 0) {
      throw new Error("Malformed RLE counts: negative run length");
    }
    out.push(x);
  }
  return out;
}

export function encodeCounts(runs: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < runs.length; i++) {
    let x = runs[i]!;
    if (i > 2) {
      x -= runs[i - 2]!;
    }
    let more = true;
    while (more) {
      let c = x & 0x1f;
      x >>= 5;
      more = (c & 0x10) !== 0 ? x !== -1 : x !== 0;
      if (more) {
        c |= 0x20;
      }
      s += String.fromCharCode(c + 48);
    }
  }
  return s;
}

function boundsOf(intervals: Uint32Array, height: number): MaskRuns["bbox"] & { area: number } {
  let area = 0;
  let y0 = height;
  let y1 = -1;
  for (let i = 0; i < intervals.length; i += 2) {
    const start = intervals[i]!;
    const end = intervals[i + 1]!;
    area += end - start;
    const sx = Math.floor(start / height);
    const ex = Math.floor((end - 1) / height);
    if (sx !== ex) {
      // Spans a column boundary, so it touches both the top and the bottom row.
      y0 = 0;
      y1 = height - 1;
    } else {
      y0 = Math.min(y0, start - sx * height);
      y1 = Math.max(y1, end - 1 - sx * height);
    }
  }
  const first = intervals[0]!;
  const last = intervals[intervals.length - 1]!;
  return {
    area,
    x0: Math.floor(first / height),
    x1: Math.floor((last - 1) / height),
    y0,
    y1,
  };
}

export function runsFromIntervals(intervals: Uint32Array, width: number, height: number): MaskRuns {
  if (intervals.length === 0) {
    return { width, height, intervals, area: 0, bbox: undefined };
  }
  const { area, ...bbox } = boundsOf(intervals, height);
  return { width, height, intervals, area, bbox };
}

/** Throws when the counts do not cover exactly the bound source frame. */
export function maskRunsFromCounts(counts: string, width: number, height: number): MaskRuns {
  if (!(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height))) {
    throw new Error("A mask needs the positive decoded frame size of its topic");
  }
  const runs = decodeCounts(counts);
  const intervals = new Uint32Array(runs.length + 1);
  let position = 0;
  let n = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (i % 2 === 1 && run > 0) {
      intervals[n++] = position;
      intervals[n++] = position + run;
    }
    position += run;
  }
  if (position !== width * height) {
    throw new Error(
      `RLE counts cover ${position} pixels, but the bound ${width}×${height} frame has ${width * height}`,
    );
  }
  return runsFromIntervals(intervals.slice(0, n), width, height);
}

export function countsFromRuns(mask: MaskRuns): string {
  const runs: number[] = [];
  let position = 0;
  for (let i = 0; i < mask.intervals.length; i += 2) {
    runs.push(mask.intervals[i]! - position, mask.intervals[i + 1]! - mask.intervals[i]!);
    position = mask.intervals[i + 1]!;
  }
  const total = mask.width * mask.height;
  if (position < total || runs.length === 0) {
    runs.push(total - position);
  }
  return encodeCounts(runs);
}

/** Last interval whose start is <= index, or -1. */
function intervalAt(intervals: Uint32Array, index: number): number {
  let lo = 0;
  let hi = (intervals.length >> 1) - 1;
  if (hi < 0 || intervals[0]! > index) {
    return -1;
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (intervals[mid * 2]! <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

export function maskContains(mask: MaskRuns, x: number, y: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) {
    return false;
  }
  const index = px * mask.height + py;
  const i = intervalAt(mask.intervals, index);
  return i >= 0 && index < mask.intervals[i * 2 + 1]!;
}

export function intersectionArea(a: MaskRuns, b: MaskRuns): number {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.intervals.length && j < b.intervals.length) {
    const start = Math.max(a.intervals[i]!, b.intervals[j]!);
    const end = Math.min(a.intervals[i + 1]!, b.intervals[j + 1]!);
    if (end > start) {
      total += end - start;
    }
    if (a.intervals[i + 1]! < b.intervals[j + 1]!) {
      i += 2;
    } else {
      j += 2;
    }
  }
  return total;
}

export function maskIou(a: MaskRuns, b: MaskRuns): number {
  const inter = intersectionArea(a, b);
  const union = a.area + b.area - inter;
  return union === 0 ? 1 : inter / union;
}

export function unionRuns(a: MaskRuns, b: MaskRuns): MaskRuns {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("Cannot merge masks bound to different frame sizes");
  }
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.intervals.length || j < b.intervals.length) {
    const takeA =
      j >= b.intervals.length || (i < a.intervals.length && a.intervals[i]! <= b.intervals[j]!);
    const start = takeA ? a.intervals[i]! : b.intervals[j]!;
    const end = takeA ? a.intervals[i + 1]! : b.intervals[j + 1]!;
    if (takeA) {
      i += 2;
    } else {
      j += 2;
    }
    if (out.length > 0 && start <= out[out.length - 1]!) {
      out[out.length - 1] = Math.max(out[out.length - 1]!, end);
    } else {
      out.push(start, end);
    }
  }
  return runsFromIntervals(Uint32Array.from(out), a.width, a.height);
}

/** Foreground of `a` that is not in `b` (the eraser). */
export function subtractRuns(a: MaskRuns, b: MaskRuns): MaskRuns {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("Cannot subtract masks bound to different frame sizes");
  }
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < a.intervals.length; i += 2) {
    let start = a.intervals[i]!;
    const end = a.intervals[i + 1]!;
    while (j < b.intervals.length && b.intervals[j + 1]! <= start) {
      j += 2;
    }
    let k = j;
    while (start < end && k < b.intervals.length && b.intervals[k]! < end) {
      const cutStart = b.intervals[k]!;
      const cutEnd = b.intervals[k + 1]!;
      if (cutStart > start) {
        out.push(start, cutStart);
      }
      start = Math.max(start, cutEnd);
      if (cutEnd <= end) {
        k += 2;
      } else {
        break;
      }
    }
    if (start < end) {
      out.push(start, end);
    }
  }
  return runsFromIntervals(Uint32Array.from(out), a.width, a.height);
}

/** Row-major bitmap of the bounding box, one byte per pixel, plus its origin. */
export function bitmapOfRuns(mask: MaskRuns): {
  bits: Uint8Array;
  x0: number;
  y0: number;
  w: number;
  h: number;
} {
  const bbox = mask.bbox;
  if (!bbox) {
    return { bits: new Uint8Array(0), x0: 0, y0: 0, w: 0, h: 0 };
  }
  const w = bbox.x1 - bbox.x0 + 1;
  const h = bbox.y1 - bbox.y0 + 1;
  const bits = new Uint8Array(w * h);
  const H = mask.height;
  for (let i = 0; i < mask.intervals.length; i += 2) {
    let start = mask.intervals[i]!;
    const end = mask.intervals[i + 1]!;
    while (start < end) {
      const x = Math.floor(start / H);
      const columnEnd = Math.min(end, (x + 1) * H);
      for (let index = start; index < columnEnd; index++) {
        bits[(index - x * H - bbox.y0) * w + (x - bbox.x0)] = 1;
      }
      start = columnEnd;
    }
  }
  return { bits, x0: bbox.x0, y0: bbox.y0, w, h };
}

/** Column-major intervals of a row-major sub-bitmap placed at (x0, y0) in a width × height frame. */
export function runsOfBitmap(
  bits: Uint8Array,
  origin: { x0: number; y0: number; w: number; h: number },
  width: number,
  height: number,
): MaskRuns {
  const out: number[] = [];
  for (let x = 0; x < origin.w; x++) {
    let runStart = -1;
    for (let y = 0; y <= origin.h; y++) {
      const set = y < origin.h && bits[y * origin.w + x] === 1;
      if (set && runStart < 0) {
        runStart = y;
      } else if (!set && runStart >= 0) {
        const start = (origin.x0 + x) * height + origin.y0 + runStart;
        const end = (origin.x0 + x) * height + origin.y0 + y;
        if (out.length > 0 && out[out.length - 1] === start) {
          out[out.length - 1] = end;
        } else {
          out.push(start, end);
        }
        runStart = -1;
      }
    }
  }
  return runsFromIntervals(Uint32Array.from(out), width, height);
}
