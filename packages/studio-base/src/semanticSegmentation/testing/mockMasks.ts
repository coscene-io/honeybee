// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * MOCK mask observations. Shapes are real SAM3 video-propagation masks copied from det_seg's
 * fixtures, mapped deterministically onto each camera's decoded frame size and moved/deformed
 * with the source frame's log time, so consecutive frames are continuous but never identical.
 * Everything produced here is labelled mock; it is never inference output.
 */

import { countsFromRuns, maskRunsFromCounts, runsFromIntervals, type MaskRuns } from "../maskCodec";
import { runsOfMask, runsOfPolygons } from "../maskGeometry";
import { frameInstanceKey } from "../service";
import type {
  FrameInstance,
  ObservationGeometry,
  SegmentationClass,
  SegmentationFrame,
  SegmentationInstance,
  SegmentationMask,
  SegmentationVideo,
} from "../types";
import shapeFixture from "./fixtures/detSegMasks.json";

export const MOCK_MASK_CLASS_ID = "mock-mask-class";
const MOCK_MASK_CLASS_NAME = "MOCK · 合成 mask（非推理结果）";

export type MockMaskProfile = {
  seed: number;
  instances: number;
  /** Cameras (sorted by topic) that receive masks. */
  cameras: number;
};

export const DEFAULT_MOCK_MASK_PROFILE: MockMaskProfile = { seed: 7, instances: 3, cameras: 5 };

export function validateMockMaskProfile(profile: MockMaskProfile): MockMaskProfile {
  for (const key of ["seed", "instances", "cameras"] as const) {
    if (!Number.isSafeInteger(profile[key]) || profile[key] < 0) {
      throw new Error(`Invalid mock mask ${key}`);
    }
  }
  // The GPU overlay draws at most 64 instances per frame.
  if (profile.instances < 1 || profile.instances > 64 || profile.cameras < 1) {
    throw new Error("Mock mask profile exceeds bounded limits");
  }
  return profile;
}

export function mockMaskCatalog(profile: MockMaskProfile): {
  classes: SegmentationClass[];
  instances: SegmentationInstance[];
} {
  return {
    classes: [{ id: MOCK_MASK_CLASS_ID, name: MOCK_MASK_CLASS_NAME, color: "#ff8a3d" }],
    instances: Array.from({ length: profile.instances }, (_, index) => ({
      id: `mock-mask-${index}`,
      classId: MOCK_MASK_CLASS_ID,
      name: `MOCK #${index + 1}`,
    })),
  };
}

type Shape = {
  width: number;
  height: number;
  /** Per source column, foreground [y0, y1) pairs. */
  columns: Int32Array[];
  cx: number;
  cy: number;
  extent: number;
};

let shapes: Shape[] | undefined;

function shapeLibrary(): Shape[] {
  if (shapes) {
    return shapes;
  }
  shapes = shapeFixture.cases
    .filter((item) => item.area > 400)
    .map((item) => {
      const [height, width] = item.size as [number, number];
      const runs = maskRunsFromCounts(item.counts, width, height);
      const lists: number[][] = Array.from({ length: width }, () => []);
      for (let i = 0; i < runs.intervals.length; i += 2) {
        let start = runs.intervals[i]!;
        const end = runs.intervals[i + 1]!;
        while (start < end) {
          const x = Math.floor(start / height);
          const columnEnd = Math.min(end, (x + 1) * height);
          lists[x]!.push(start - x * height, columnEnd - x * height);
          start = columnEnd;
        }
      }
      const box = runs.bbox!;
      return {
        width,
        height,
        columns: lists.map((list) => Int32Array.from(list)),
        cx: (box.x0 + box.x1 + 1) / 2,
        cy: (box.y0 + box.y1 + 1) / 2,
        extent: Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1),
      };
    });
  return shapes;
}

function hash(...values: number[]): number {
  let h = 2166136261;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 2 ** 32;
}

/**
 * One mock mask for an instance on a camera at a source time. Pure function of its inputs; the
 * mapping works on column intervals (O(columns + runs)), never per pixel.
 */
export function synthesizeMockMask(
  profile: MockMaskProfile,
  instance: number,
  camera: number,
  timeSec: number,
  width: number,
  height: number,
): SegmentationMask {
  const library = shapeLibrary();
  const shape = library[Math.floor(hash(profile.seed, instance, camera) * library.length)]!;
  const perColumn: number[][] = Array.from({ length: width }, () => []);
  const phase = hash(profile.seed, instance, camera, 0) * Math.PI * 2;
  const baseX = 0.25 + 0.5 * hash(instance, camera, 1);
  const baseY = 0.3 + 0.4 * hash(instance, camera, 2);
  const cx = (baseX + 0.06 * Math.sin((2 * Math.PI * timeSec) / 6 + phase)) * width;
  const cy = (baseY + 0.04 * Math.sin((2 * Math.PI * timeSec) / 4.3 + phase)) * height;
  const breathing = 1 + 0.05 * Math.sin((2 * Math.PI * timeSec) / 3.1 + phase);
  const scale = ((0.38 * Math.min(width, height)) / shape.extent) * breathing;
  const wobble = 0.004 * height;
  for (let x = 0; x < width; x++) {
    const sx = Math.floor((x + 0.5 - cx) / scale + shape.cx);
    if (sx < 0 || sx >= shape.width) {
      continue;
    }
    const source = shape.columns[sx]!;
    if (source.length === 0) {
      continue;
    }
    const dy = cy + wobble * Math.sin((x / width) * 4 * Math.PI + timeSec * 2 + phase);
    for (let i = 0; i < source.length; i += 2) {
      const y0 = Math.max(0, Math.round((source[i]! - shape.cy) * scale + dy));
      const y1 = Math.min(height, Math.round((source[i + 1]! - shape.cy) * scale + dy));
      if (y1 > y0) {
        perColumn[x]!.push(y0, y1);
      }
    }
  }
  const out: number[] = [];
  for (let x = 0; x < width; x++) {
    const list = perColumn[x]!;
    if (list.length === 0) {
      continue;
    }
    const pairs: [number, number][] = [];
    for (let i = 0; i < list.length; i += 2) {
      pairs.push([list[i]!, list[i + 1]!]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [y0, y1] of pairs) {
      const start = x * height + y0;
      const end = x * height + y1;
      if (out.length > 0 && start <= out[out.length - 1]!) {
        out[out.length - 1] = Math.max(out[out.length - 1]!, end);
      } else {
        out.push(start, end);
      }
    }
  }
  return {
    counts: countsFromRuns(runsFromIntervals(Uint32Array.from(out), width, height)),
    width,
    height,
    source: "mock",
  };
}

/** Topics in a stable order, so the camera knob does not depend on panel registration order. */
function cameraOrder(videos: readonly SegmentationVideo[]): Map<string, number> {
  return new Map(
    [...videos]
      .sort((a, b) => (a.topic ?? a.id).localeCompare(b.topic ?? b.id))
      .map((video, index) => [video.id, index]),
  );
}

/** Mock observations for the given frames; skips keys the caller already stores (edits, tombstones). */
export function synthesizeMockObservations(
  profile: MockMaskProfile,
  videos: readonly SegmentationVideo[],
  frames: readonly SegmentationFrame[],
  skip: (key: string) => boolean,
): Record<string, FrameInstance> {
  const order = cameraOrder(videos);
  const byId = new Map(videos.map((video) => [video.id, video]));
  const annotations: Record<string, FrameInstance> = {};
  for (const frame of frames) {
    const camera = order.get(frame.videoId);
    const video = byId.get(frame.videoId);
    if (camera == undefined || camera >= profile.cameras) {
      continue;
    }
    if (video?.width == undefined || video.height == undefined) {
      // A mask cannot exist without the topic's decoded size; never guess one.
      continue;
    }
    for (let instance = 0; instance < profile.instances; instance++) {
      const instanceId = `mock-mask-${instance}`;
      const key = frameInstanceKey(frame.id, instanceId);
      if (skip(key)) {
        continue;
      }
      annotations[key] = {
        frameId: frame.id,
        instanceId,
        kind: "mask",
        mask: synthesizeMockMask(
          profile,
          instance,
          camera,
          frame.timestampSec,
          video.width,
          video.height,
        ),
      };
    }
  }
  return annotations;
}

/** Mock propagation: the seed's pixels, moved 10 px right and down per frame (like the polygon mock). */
export function propagateMockMask(
  seed: ObservationGeometry,
  size: { width: number; height: number },
  steps: number,
): SegmentationMask {
  const runs: MaskRuns =
    seed.kind === "mask"
      ? runsOfMask(seed.mask)
      : runsOfPolygons(seed.polygons, size.width, size.height);
  const { width, height } = runs;
  const dx = steps * 10;
  const dy = steps * 10;
  const out: number[] = [];
  for (let i = 0; i < runs.intervals.length; i += 2) {
    let start = runs.intervals[i]!;
    const end = runs.intervals[i + 1]!;
    while (start < end) {
      const x = Math.floor(start / height);
      const columnEnd = Math.min(end, (x + 1) * height);
      const tx = x + dx;
      if (tx >= 0 && tx < width) {
        const y0 = Math.max(0, start - x * height + dy);
        const y1 = Math.min(height, columnEnd - x * height + dy);
        if (y1 > y0) {
          const s = tx * height + y0;
          const e = tx * height + y1;
          if (out.length > 0 && s <= out[out.length - 1]!) {
            out[out.length - 1] = Math.max(out[out.length - 1]!, e);
          } else {
            out.push(s, e);
          }
        }
      }
      start = columnEnd;
    }
  }
  return {
    counts: countsFromRuns(runsFromIntervals(Uint32Array.from(out), width, height)),
    width,
    height,
    source: "propagation",
  };
}
