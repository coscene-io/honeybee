// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import {
  countsFromRuns,
  decodeCounts,
  intersectionArea,
  maskIou,
  maskRunsFromCounts,
  runsFromIntervals,
  runsOfBitmap,
  subtractRuns,
  unionRuns,
  type MaskRuns,
} from "./maskCodec";
import { maskToSimplePolygons, polygonsToRuns, type PixelPolygon } from "./maskPolygon";
import type {
  AnnotationSummary,
  FrameInstance,
  MaskConversionLoss,
  ObservationGeometry,
  SegmentationMask,
  SegmentationPolygon,
} from "./types";

/**
 * Coordinate convention. Editor points are continuous image coordinates normalized by the frame
 * size: (0, 0) is the top-left corner of the image and pixel (i, j) covers [i, i+1) × [j, j+1).
 * det_seg/OpenCV polygons use integer pixel centres. Converting adds or removes the half pixel so
 * a polygon drawn over a mask lines up with the pixels the GPU fills.
 */
const HALF_PIXEL = 0.5;

const RUNS_CACHE_LIMIT = 4096;
const runsCache = new Map<string, MaskRuns>();
const areaCache = new Map<string, number>();

/** Decoded intervals for a mask, cached by content so cloned documents share the work. */
export function runsOfMask(mask: SegmentationMask): MaskRuns {
  const key = `${mask.width}x${mask.height}:${mask.counts}`;
  const cached = runsCache.get(key);
  if (cached) {
    runsCache.delete(key);
    runsCache.set(key, cached);
    return cached;
  }
  const runs = maskRunsFromCounts(mask.counts, mask.width, mask.height);
  runsCache.set(key, runs);
  if (runsCache.size > RUNS_CACHE_LIMIT) {
    runsCache.delete(runsCache.keys().next().value!);
  }
  return runs;
}

/** Foreground pixel count without materializing intervals. */
export function maskArea(counts: string): number {
  const cached = areaCache.get(counts);
  if (cached != undefined) {
    return cached;
  }
  let area = 0;
  decodeCounts(counts).forEach((run, index) => {
    if (index % 2 === 1) {
      area += run;
    }
  });
  areaCache.set(counts, area);
  if (areaCache.size > RUNS_CACHE_LIMIT * 4) {
    areaCache.delete(areaCache.keys().next().value!);
  }
  return area;
}

/** The polygons of a polygon observation; a mask (or no observation) has none. */
export function polygonsOf(
  annotation: ObservationGeometry | undefined,
): readonly SegmentationPolygon[] {
  return annotation?.kind === "polygons" ? annotation.polygons : [];
}

/** The mask of a mask observation, if it is one. */
export function maskOf(annotation: ObservationGeometry | undefined): SegmentationMask | undefined {
  return annotation?.kind === "mask" ? annotation.mask : undefined;
}

/**
 * The observation a polygon list leaves behind: a polygon observation with only complete polygons
 * (≥ 3 vertices), or undefined when none remain (the observation is then cleared).
 */
export function polygonObservation(
  frameId: string,
  instanceId: string,
  polygons: readonly SegmentationPolygon[],
): FrameInstance | undefined {
  const complete = polygons.filter((polygon) => polygon.points.length >= 3);
  return complete.length > 0
    ? { frameId, instanceId, kind: "polygons", polygons: [...complete] }
    : undefined;
}

/** A mask observation, or undefined when the mask has no foreground (the observation is cleared). */
export function maskObservation(
  frameId: string,
  instanceId: string,
  mask: SegmentationMask,
): FrameInstance | undefined {
  return maskArea(mask.counts) > 0 ? { frameId, instanceId, kind: "mask", mask } : undefined;
}

export function summarizeObservation(annotation: FrameInstance): AnnotationSummary {
  const polygons = polygonsOf(annotation);
  const mask = maskOf(annotation);
  return {
    polygonCount: polygons.length,
    pointCount: polygons.reduce((sum, polygon) => sum + polygon.points.length, 0),
    ...(mask ? { maskArea: maskArea(mask.counts) } : {}),
  };
}

/** True when the observation has any geometry: polygon vertices or mask pixels. */
export function summaryHasGeometry(summary: AnnotationSummary | undefined): boolean {
  return (
    summary != undefined &&
    (summary.fromTimeline === true || summary.pointCount > 0 || (summary.maskArea ?? 0) > 0)
  );
}

export function observationHasGeometry(annotation: ObservationGeometry | undefined): boolean {
  if (annotation?.kind === "mask") {
    return maskArea(annotation.mask.counts) > 0;
  }
  return annotation?.polygons.some((polygon) => polygon.points.length >= 3) === true;
}

function pixelPolygonsOf(
  polygons: readonly SegmentationPolygon[],
  width: number,
  height: number,
): PixelPolygon[] {
  return polygons
    .filter((polygon) => polygon.points.length > 0)
    .map((polygon) =>
      polygon.points.map(({ x, y }): [number, number] => [
        x * width - HALF_PIXEL,
        y * height - HALF_PIXEL,
      ]),
    );
}

const polygonRunsCache = new Map<string, MaskRuns>();

/** Rasterize editor polygons exactly as det_seg PolygonsToMask, cached by content. */
export function runsOfPolygons(
  polygons: readonly SegmentationPolygon[],
  width: number,
  height: number,
): MaskRuns {
  const key = `${width}x${height}:${JSON.stringify(polygons.map((polygon) => polygon.points))}`;
  const cached = polygonRunsCache.get(key);
  if (cached) {
    return cached;
  }
  const runs = polygonsToRuns(pixelPolygonsOf(polygons, width, height), width, height);
  polygonRunsCache.set(key, runs);
  if (polygonRunsCache.size > RUNS_CACHE_LIMIT) {
    polygonRunsCache.delete(polygonRunsCache.keys().next().value!);
  }
  return runs;
}

/**
 * One observation's mask as editor polygons the annotation contract accepts (maskToSimplePolygons,
 * eps=1). det_seg's MaskToPolygons is not used here: it bridges holes into the outer ring as a
 * keyhole, repeating two vertices, and its traces revisit pinch pixels, so the server rejected
 * them with "Duplicate polygon vertex". Components of one or two pixels and one-pixel filaments
 * have no polygon the contract can save, so they are not editable and drop out.
 */
export function maskToEditorPolygons(
  mask: SegmentationMask,
  topic: string | undefined,
  createId: () => string = uuidv4,
): SegmentationPolygon[] {
  const rings = maskToSimplePolygons(runsOfMask(mask), 1).filter((ring) => ring.length >= 3);
  return rings.map((ring): SegmentationPolygon => ({
    id: createId(),
    points: ring.map(([x, y]) => ({
      x: (x + HALF_PIXEL) / mask.width,
      y: (y + HALF_PIXEL) / mask.height,
    })),
    ...(topic == undefined ? {} : { topic }),
  }));
}

/** Pixel runs of any observation at the given source size (polygons are rasterized). */
function runsOfObservation(
  annotation: ObservationGeometry,
  width: number,
  height: number,
): MaskRuns {
  if (annotation.kind === "mask") {
    if (annotation.mask.width !== width || annotation.mask.height !== height) {
      throw new Error(
        `Mask is bound to ${annotation.mask.width}×${annotation.mask.height}, not ${width}×${height}`,
      );
    }
    return runsOfMask(annotation.mask);
  }
  return runsOfPolygons(annotation.polygons, width, height);
}

export function maskOfRuns(runs: MaskRuns, source: SegmentationMask["source"]): SegmentationMask {
  return {
    counts: countsFromRuns(runs),
    width: runs.width,
    height: runs.height,
    ...(source ? { source } : {}),
  };
}

/**
 * Merge two observations of the same frame. Polygons concatenate; as soon as either side is a
 * mask, the result is one mask (the union), since one observation has one representation and a
 * mask is the lossless side: rasterizing polygons costs only sub-pixel precision, while
 * vectorizing a mask loses holes and slivers.
 */
export function mergeObservations(
  target: FrameInstance | undefined,
  source: FrameInstance,
  instanceId: string,
): FrameInstance {
  if (!target) {
    return { ...source, instanceId };
  }
  if (target.kind === "polygons" && source.kind === "polygons") {
    return { ...target, instanceId, polygons: [...target.polygons, ...source.polygons] };
  }
  const mask = maskOf(target) ?? maskOf(source)!;
  const union = unionRuns(
    runsOfObservation(target, mask.width, mask.height),
    runsOfObservation(source, mask.width, mask.height),
  );
  return {
    frameId: target.frameId,
    instanceId,
    kind: "mask",
    mask: maskOfRuns(union, "merge"),
  };
}

/**
 * Pixels a round brush covers along a stroke. Points are continuous pixel coordinates; a pixel is
 * covered when its centre lies within `radius` of the stroke's centre line.
 */
export function strokeRuns(
  points: readonly { x: number; y: number }[],
  radius: number,
  width: number,
  height: number,
): MaskRuns {
  if (points.length === 0 || !(radius > 0)) {
    return runsFromIntervals(new Uint32Array(0), width, height);
  }
  const x0 = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) - radius));
  const y0 = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) - radius));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...points.map((p) => p.x)) + radius));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...points.map((p) => p.y)) + radius));
  if (x1 < x0 || y1 < y0) {
    return runsFromIntervals(new Uint32Array(0), width, height);
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  const r2 = radius * radius;
  const segments = points.length === 1 ? [[points[0]!, points[0]!]] : [];
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1]!, points[i]!]);
  }
  for (const [a, b] of segments) {
    const dx = b!.x - a!.x;
    const dy = b!.y - a!.y;
    const length2 = dx * dx + dy * dy;
    const sx0 = Math.max(x0, Math.floor(Math.min(a!.x, b!.x) - radius));
    const sx1 = Math.min(x1, Math.ceil(Math.max(a!.x, b!.x) + radius));
    const sy0 = Math.max(y0, Math.floor(Math.min(a!.y, b!.y) - radius));
    const sy1 = Math.min(y1, Math.ceil(Math.max(a!.y, b!.y) + radius));
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const px = x + HALF_PIXEL;
        const py = y + HALF_PIXEL;
        const t =
          length2 === 0
            ? 0
            : Math.max(0, Math.min(1, ((px - a!.x) * dx + (py - a!.y) * dy) / length2));
        const cx = a!.x + t * dx - px;
        const cy = a!.y + t * dy - py;
        if (cx * cx + cy * cy <= r2) {
          bits[(y - y0) * w + (x - x0)] = 1;
        }
      }
    }
  }
  return runsOfBitmap(bits, { x0, y0, w, h }, width, height);
}

/** Paint (union) or erase (subtract) a brush stroke on an observation; the result is a mask. */
export function applyStroke(
  current: ObservationGeometry | undefined,
  stroke: MaskRuns,
  mode: "paint" | "erase",
): SegmentationMask {
  const base = current
    ? runsOfObservation(current, stroke.width, stroke.height)
    : runsFromIntervals(new Uint32Array(0), stroke.width, stroke.height);
  return maskOfRuns(
    mode === "paint" ? unionRuns(base, stroke) : subtractRuns(base, stroke),
    "brush",
  );
}

/** Count 4-connected components of `bits` (w × h) that satisfy `keep`, labelling in place. */
function countComponents(
  bits: Uint8Array,
  w: number,
  h: number,
  value: number,
  keep: (pixels: number[]) => boolean,
): number {
  const seen = new Uint8Array(w * h);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < bits.length; start++) {
    if (bits[start] !== value || seen[start] === 1) {
      continue;
    }
    const pixels: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      pixels.push(index);
      const x = index % w;
      const neighbours = [x > 0 ? index - 1 : -1, x < w - 1 ? index + 1 : -1, index - w, index + w];
      for (const next of neighbours) {
        if (next >= 0 && next < bits.length && bits[next] === value && seen[next] !== 1) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (keep(pixels)) {
      count++;
    }
  }
  return count;
}

/** Rasterize runs into a row-major bitmap of the given box. */
function boxBitmap(
  runs: MaskRuns,
  box: { x0: number; y0: number; w: number; h: number },
): Uint8Array {
  const bits = new Uint8Array(box.w * box.h);
  const H = runs.height;
  for (let i = 0; i < runs.intervals.length; i += 2) {
    for (let index = runs.intervals[i]!; index < runs.intervals[i + 1]!; index++) {
      const x = Math.floor(index / H) - box.x0;
      const y = (index % H) - box.y0;
      if (x >= 0 && y >= 0 && x < box.w && y < box.h) {
        bits[y * box.w + x] = 1;
      }
    }
  }
  return bits;
}

/** What `maskToEditorPolygons` would lose for this mask, measured in source pixels. */
export function maskConversionLoss(mask: SegmentationMask): MaskConversionLoss {
  const original = runsOfMask(mask);
  const polygons = maskToEditorPolygons(mask, undefined, () => "loss");
  const raster = runsOfPolygons(polygons, mask.width, mask.height);
  const inter = intersectionArea(original, raster);
  const result = {
    iou: maskIou(original, raster),
    lostPixels: original.area - inter,
    addedPixels: raster.area - inter,
    holes: 0,
    droppedComponents: 0,
    polygonCount: polygons.length,
  };
  const bbox = original.bbox;
  if (!bbox) {
    return result;
  }
  // One pixel of background padding so a hole is background that cannot reach the border.
  const box = {
    x0: bbox.x0 - 1,
    y0: bbox.y0 - 1,
    w: bbox.x1 - bbox.x0 + 3,
    h: bbox.y1 - bbox.y0 + 3,
  };
  const bits = boxBitmap(original, box);
  const covered = boxBitmap(raster, box);
  result.holes = countComponents(bits, box.w, box.h, 0, (pixels) => !pixels.includes(0));
  result.droppedComponents = countComponents(bits, box.w, box.h, 1, (pixels) =>
    pixels.every((index) => covered[index] !== 1),
  );
  return result;
}
