// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import {
  countsFromRuns,
  decodeCounts,
  maskRunsFromCounts,
  unionRuns,
  type MaskRuns,
} from "./maskCodec";
import { maskToSimplePolygons, polygonsToRuns, type PixelPolygon } from "./maskPolygon";
import type {
  AnnotationSummary,
  FrameInstance,
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

export function summarizeObservation(annotation: FrameInstance): AnnotationSummary {
  return {
    polygonCount: annotation.polygons.length,
    pointCount: annotation.polygons.reduce((sum, polygon) => sum + polygon.points.length, 0),
    ...(annotation.mask ? { maskArea: maskArea(annotation.mask.counts) } : {}),
  };
}

/** True when the observation has any geometry: polygon vertices or mask pixels. */
export function summaryHasGeometry(summary: AnnotationSummary | undefined): boolean {
  return (
    summary != undefined &&
    (summary.fromTimeline === true || summary.pointCount > 0 || (summary.maskArea ?? 0) > 0)
  );
}

export function observationHasGeometry(annotation: FrameInstance | undefined): boolean {
  return (
    annotation != undefined &&
    (annotation.polygons.some((polygon) => polygon.points.length > 0) ||
      (annotation.mask != undefined && maskArea(annotation.mask.counts) > 0))
  );
}

export function pixelPolygonsOf(
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
  return rings.map(
    (ring): SegmentationPolygon => ({
      id: createId(),
      points: ring.map(([x, y]) => ({
        x: (x + HALF_PIXEL) / mask.width,
        y: (y + HALF_PIXEL) / mask.height,
      })),
      ...(topic == undefined ? {} : { topic }),
    }),
  );
}

/**
 * Merge two observations of the same frame. Polygons concatenate; as soon as either side is a
 * mask, the result is one mask (the union), since one observation has one representation.
 */
export function mergeObservations(
  target: FrameInstance | undefined,
  source: FrameInstance,
  instanceId: string,
): FrameInstance {
  if (!target) {
    return { ...source, instanceId };
  }
  const mask = target.mask ?? source.mask;
  if (!mask) {
    return { ...target, instanceId, polygons: [...target.polygons, ...source.polygons] };
  }
  const toRuns = (item: FrameInstance) =>
    item.mask ? runsOfMask(item.mask) : runsOfPolygons(item.polygons, mask.width, mask.height);
  const union = unionRuns(toRuns(target), toRuns(source));
  return {
    ...target,
    instanceId,
    polygons: [],
    mask: {
      counts: countsFromRuns(union),
      width: mask.width,
      height: mask.height,
      source: "merge",
    },
  };
}
