// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { cameraFrameStrip, sortCameraFrames, type CameraStripCell } from "../cameraFrames";
import { summaryHasGeometry } from "../maskGeometry";
import { frameInstanceKey } from "../service";
import { sourceFrameLoaders } from "../sourceFrames";
import type {
  SegmentationDocument,
  SegmentationFrame,
  SegmentationInstance,
  SegmentationVideo,
} from "../types";

/** Lookups the tree needs every render, built once per frame list instead of scanned per row. */
export type FrameIndex = {
  frameById: Map<string, SegmentationFrame>;
  videoById: Map<string, SegmentationVideo>;
  /** Each camera's frames in log-time order, one per log time (as `sortCameraFrames`). */
  framesByVideo: Map<string, SegmentationFrame[]>;
  /** A frame's position in its camera's `framesByVideo` list. */
  positionById: Map<string, number>;
  /** Each camera's frames in document order, duplicates included, as `frames.filter` gave. */
  framesOfVideo: Map<string, SegmentationFrame[]>;
  /** Each camera's frames by their `index` field, for the single-video presence row. */
  frameByVideoIndex: Map<string, Map<number, SegmentationFrame>>;
};

type FrameIndexEntry = {
  length: number;
  videos: readonly SegmentationVideo[];
  videosLength: number;
  index: FrameIndex;
};

/**
 * Keyed by the frame array. The runtime grows the frame and video arrays in place while playback
 * registers frames, so their lengths are part of the key too. Both are only ever added to.
 */
const frameIndexes = new WeakMap<readonly SegmentationFrame[], FrameIndexEntry>();

export function frameIndexOf(
  document: Pick<SegmentationDocument, "frames" | "videos">,
): FrameIndex {
  const cached = frameIndexes.get(document.frames);
  if (
    cached?.length === document.frames.length &&
    cached.videos === document.videos &&
    cached.videosLength === document.videos.length
  ) {
    return cached.index;
  }
  const frameById = new Map<string, SegmentationFrame>();
  const byVideo = new Map<string, SegmentationFrame[]>();
  const frameByVideoIndex = new Map<string, Map<number, SegmentationFrame>>();
  for (const frame of document.frames) {
    frameById.set(frame.id, frame);
    const list = byVideo.get(frame.videoId);
    if (list) {
      list.push(frame);
    } else {
      byVideo.set(frame.videoId, [frame]);
    }
    let byIndex = frameByVideoIndex.get(frame.videoId);
    if (!byIndex) {
      byIndex = new Map();
      frameByVideoIndex.set(frame.videoId, byIndex);
    }
    if (!byIndex.has(frame.index)) {
      byIndex.set(frame.index, frame);
    }
  }
  const framesByVideo = new Map<string, SegmentationFrame[]>();
  const positionById = new Map<string, number>();
  for (const [videoId, list] of byVideo) {
    const sorted = sortCameraFrames(list);
    framesByVideo.set(videoId, sorted);
    sorted.forEach((frame, position) => positionById.set(frame.id, position));
  }
  const index: FrameIndex = {
    frameById,
    videoById: new Map(document.videos.map((video) => [video.id, video])),
    framesByVideo,
    positionById,
    framesOfVideo: byVideo,
    frameByVideoIndex,
  };
  frameIndexes.set(document.frames, {
    length: document.frames.length,
    videos: document.videos,
    videosLength: document.videos.length,
    index,
  });
  return index;
}

const instancesByClassCache = new WeakMap<
  readonly SegmentationInstance[],
  Map<string, SegmentationInstance[]>
>();

export function instancesByClass(
  instances: readonly SegmentationInstance[],
): Map<string, SegmentationInstance[]> {
  const cached = instancesByClassCache.get(instances);
  if (cached) {
    return cached;
  }
  const grouped = new Map<string, SegmentationInstance[]>();
  for (const instance of instances) {
    const list = grouped.get(instance.classId);
    if (list) {
      list.push(instance);
    } else {
      grouped.set(instance.classId, [instance]);
    }
  }
  instancesByClassCache.set(instances, grouped);
  return grouped;
}

type StripCacheEntry = {
  frames: readonly SegmentationFrame[];
  length: number;
  cells: Map<string, CameraStripCell[]>;
};

/** Per summary table: cells by instance and shown frame. A new summary table starts over. */
const stripCaches = new WeakMap<SegmentationDocument["annotationSummaries"], StripCacheEntry>();

/**
 * One camera's ±20 cells for an instance around the frame it shows, from the frame index.
 * Cached until the summaries or the frame list change, as the strip's own memo was.
 */
export function cameraStripCells(
  document: Pick<SegmentationDocument, "frames" | "videos" | "annotationSummaries">,
  instanceId: string,
  frameId: string,
): CameraStripCell[] {
  let entry = stripCaches.get(document.annotationSummaries);
  if (entry?.frames !== document.frames || entry.length !== document.frames.length) {
    entry = { frames: document.frames, length: document.frames.length, cells: new Map() };
    stripCaches.set(document.annotationSummaries, entry);
  }
  const key = `${instanceId}\u0000${frameId}`;
  const cached = entry.cells.get(key);
  if (cached) {
    return cached;
  }
  const index = frameIndexOf(document);
  const frame = index.frameById.get(frameId);
  const position = index.positionById.get(frameId);
  const sorted = frame ? index.framesByVideo.get(frame.videoId) : undefined;
  const cells =
    frame && sorted && position != undefined
      ? cameraFrameStrip({
          frames: sorted,
          presorted: { center: position },
          currentFrameId: frameId,
          isAnnotated: (id) =>
            summaryHasGeometry(document.annotationSummaries[frameInstanceKey(id, instanceId)]),
          isLoaded: sourceFrameLoaders.get(frame.videoId)?.isLoaded,
        })
      : [];
  entry.cells.set(key, cells);
  return cells;
}
