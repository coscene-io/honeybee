// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

import {
  segmentationMaskOverlay,
  type SegmentationMaskGeometry,
  type SegmentationMaskOverlaySource,
  type SegmentationMaskStyle,
} from "../imageSource";
import { segmentationSession, type SegmentationRuntime } from "../runtime";
import { frameInstanceKey } from "../service";
import type { SegmentationDocument, SegmentationFrame, SemanticSegmentationStore } from "../types";
import { MAX_MASK_SLOTS } from "./maskPlanes";

/** Canvas-local display controls mirrored for the GPU layer (the SVG owns the same values). */
export const maskOverlayControls = createStore<{ opacity: number; peekOriginal: boolean }>(() => ({
  opacity: 0.5,
  peekOriginal: false,
}));

type TopicIndex = {
  frames: SegmentationFrame[];
  byLogTime: Map<string, number>;
};

function hexColor(hex: string | undefined): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) {
    return [0, 0x89 / 255, 0x7b / 255];
  }
  const value = parseInt(match[1]!, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export type MaskOverlaySourceStats = {
  truncatedFrames: number;
  sizeMismatches: number;
  /** Geometry ids handed out; a steady document should stop growing this. */
  idsIssued: number;
};

/**
 * Reads the shared segmentation session: the editing runtime when the session is open, otherwise
 * the read-only preview runtime. Mask observations only; polygons stay on the SVG layer, and an
 * observation opened for vertex editing is already polygons in the store's view document.
 */
export function createMaskOverlaySource(): SegmentationMaskOverlaySource & {
  stats: MaskOverlaySourceStats;
} {
  let nextId = 1;
  let indexedFrames: SegmentationDocument["frames"] | undefined;
  let indexedVideos: SegmentationDocument["videos"] | undefined;
  // The runtime grows its source tables in place (registerSource splices them), so identity alone
  // would miss frames listed later. Frames and videos are only ever added, never removed.
  let indexedFrameCount = 0;
  let indexedVideoCount = 0;
  let topics = new Map<string, TopicIndex>();
  const geometries = new Map<
    string,
    { doc: SegmentationDocument; geometry?: SegmentationMaskGeometry }
  >();
  /**
   * Last geometry per topic + log time. It outlives document changes, so registering frames during
   * playback (a new frame list every frame) keeps ids, and so the built bit planes, of unchanged
   * frames. Any change of size, instances or counts gets a new id.
   */
  const lastGeometry = new Map<string, SegmentationMaskGeometry>();
  const stats: MaskOverlaySourceStats = {
    truncatedFrames: 0,
    sizeMismatches: 0,
    idsIssued: 0,
  };

  function state(): SemanticSegmentationStore | undefined {
    const session = segmentationSession.getState();
    const runtime: SegmentationRuntime | undefined = session.open
      ? session.runtime
      : session.previewRuntime;
    return runtime?.store.getState();
  }

  function index(doc: SegmentationDocument): Map<string, TopicIndex> {
    if (
      doc.frames === indexedFrames &&
      doc.videos === indexedVideos &&
      doc.frames.length === indexedFrameCount &&
      doc.videos.length === indexedVideoCount
    ) {
      return topics;
    }
    const byVideo = new Map<string, SegmentationFrame[]>();
    for (const frame of doc.frames) {
      const list = byVideo.get(frame.videoId) ?? [];
      list.push(frame);
      byVideo.set(frame.videoId, list);
    }
    topics = new Map();
    for (const video of doc.videos) {
      if (video.topic == undefined) {
        continue;
      }
      const frames = (byVideo.get(video.id) ?? []).sort((a, b) =>
        BigInt(a.logTimeNs) < BigInt(b.logTimeNs) ? -1 : 1,
      );
      topics.set(video.topic, {
        frames,
        byLogTime: new Map(frames.map((frame, position) => [frame.logTimeNs, position])),
      });
    }
    indexedFrames = doc.frames;
    indexedVideos = doc.videos;
    indexedFrameCount = doc.frames.length;
    indexedVideoCount = doc.videos.length;
    geometries.clear();
    return topics;
  }

  function geometryOf(
    doc: SegmentationDocument,
    topic: string,
    frame: SegmentationFrame,
  ): SegmentationMaskGeometry | undefined {
    const cacheKey = `${topic}\u0000${frame.logTimeNs}`;
    const cached = geometries.get(cacheKey);
    if (cached?.doc === doc) {
      return cached.geometry;
    }
    const instanceIds: string[] = [];
    const counts: string[] = [];
    let width = 0;
    let height = 0;
    for (const instance of doc.instances) {
      const mask = doc.annotations[frameInstanceKey(frame.id, instance.id)]?.mask;
      if (!mask) {
        continue;
      }
      if (instanceIds.length === 0) {
        width = mask.width;
        height = mask.height;
      } else if (mask.width !== width || mask.height !== height) {
        // One frame has one decoded size; never stretch a mask bound to another size.
        stats.sizeMismatches++;
        continue;
      }
      if (instanceIds.length === MAX_MASK_SLOTS) {
        stats.truncatedFrames++;
        break;
      }
      instanceIds.push(instance.id);
      counts.push(mask.counts);
    }
    let geometry: SegmentationMaskGeometry | undefined;
    if (instanceIds.length > 0) {
      const previous = lastGeometry.get(cacheKey);
      const same =
        previous?.width === width &&
        previous.height === height &&
        previous.counts.length === counts.length &&
        previous.instanceIds.length === instanceIds.length &&
        previous.counts.every((value, slot) => value === counts[slot]) &&
        previous.instanceIds.every((value, slot) => value === instanceIds[slot]);
      if (!same) {
        stats.idsIssued++;
      }
      geometry = same
        ? previous
        : { id: nextId++, topic, logTimeNs: frame.logTimeNs, width, height, instanceIds, counts };
    }
    geometries.set(cacheKey, { doc, geometry });
    if (geometry) {
      lastGeometry.set(cacheKey, geometry);
    } else {
      lastGeometry.delete(cacheKey);
    }
    return geometry;
  }

  function styleOf(
    store: SemanticSegmentationStore,
    doc: SegmentationDocument,
    geometry: SegmentationMaskGeometry,
  ): SegmentationMaskStyle {
    const session = segmentationSession.getState();
    const controls = maskOverlayControls.getState();
    const editing = session.open;
    const hiddenAll = editing && (store.viewMode === "original" || controls.peekOriginal);
    const classes = new Map(doc.classes.map((item) => [item.id, item]));
    const instances = new Map(doc.instances.map((item) => [item.id, item]));
    const matches = (ref: { type: string; id: string } | undefined, instanceId: string) =>
      ref != undefined &&
      ((ref.type === "instance" && ref.id === instanceId) ||
        (ref.type === "class" && instances.get(instanceId)?.classId === ref.id));
    return {
      colors: geometry.instanceIds.map((id) =>
        hexColor(classes.get(instances.get(id)?.classId ?? "")?.color),
      ),
      visible: geometry.instanceIds.map(
        (id) => !hiddenAll && (!editing || store.viewMode === "all" || matches(store.focus, id)),
      ),
      selected: geometry.instanceIds.map(
        (id) =>
          editing && (matches(store.focus, id) || store.selection.some((ref) => matches(ref, id))),
      ),
      opacity: editing ? controls.opacity : 0.28,
    };
  }

  return {
    stats,
    frame(topic, logTimeNs) {
      const store = state();
      const doc = store?.document;
      if (!store || !doc) {
        return undefined;
      }
      const entry = index(doc).get(topic);
      const position = entry?.byLogTime.get(logTimeNs);
      const frame = position == undefined ? undefined : entry!.frames[position];
      const geometry = frame ? geometryOf(doc, topic, frame) : undefined;
      return geometry ? { geometry, style: styleOf(store, doc, geometry) } : undefined;
    },
    upcoming(topic, logTimeNs, { minFrames, maxFrames, horizonNs }) {
      const doc = state()?.document;
      if (!doc) {
        return [];
      }
      const entry = index(doc).get(topic);
      if (!entry) {
        return [];
      }
      let start = entry.byLogTime.get(logTimeNs);
      if (start == undefined) {
        // Between registered frames: the next one is the first with a later log time.
        const time = BigInt(logTimeNs);
        start = entry.frames.findIndex((frame) => BigInt(frame.logTimeNs) > time) - 1;
        if (start < -1) {
          return [];
        }
      }
      const out: SegmentationMaskGeometry[] = [];
      const until = BigInt(logTimeNs) + horizonNs;
      for (let i = start + 1; i < entry.frames.length && i <= start + maxFrames; i++) {
        if (i > start + minFrames && BigInt(entry.frames[i]!.logTimeNs) > until) {
          break;
        }
        const geometry = geometryOf(doc, topic, entry.frames[i]!);
        if (geometry) {
          out.push(geometry);
        }
      }
      return out;
    },
  };
}

let installed: (() => void) | undefined;

/** Publishes the session's masks to every Image panel. Idempotent; lives for the page. */
export function installMaskOverlaySource(): void {
  if (installed) {
    return;
  }
  const source = createMaskOverlaySource();
  segmentationMaskOverlay.set(source);
  let unsubscribeRuntime: (() => void) | undefined;
  let watched: SegmentationRuntime | undefined;
  const invalidate = () => {
    segmentationMaskOverlay.invalidate();
  };
  const watch = () => {
    const session = segmentationSession.getState();
    const runtime = session.open ? session.runtime : session.previewRuntime;
    if (runtime !== watched) {
      unsubscribeRuntime?.();
      watched = runtime;
      unsubscribeRuntime = runtime?.store.subscribe((next, previous) => {
        if (
          next.document !== previous.document ||
          next.viewMode !== previous.viewMode ||
          next.focus !== previous.focus ||
          next.selection !== previous.selection
        ) {
          invalidate();
        }
      });
    }
    invalidate();
  };
  watch();
  const unsubscribeSession = segmentationSession.subscribe((next, previous) => {
    if (
      next.open !== previous.open ||
      next.runtime !== previous.runtime ||
      next.previewRuntime !== previous.previewRuntime
    ) {
      watch();
    }
  });
  const unsubscribeControls = maskOverlayControls.subscribe(invalidate);
  installed = () => {
    unsubscribeSession();
    unsubscribeControls();
    unsubscribeRuntime?.();
    segmentationMaskOverlay.set(undefined);
  };
}
