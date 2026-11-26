// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

import {
  type MaskOverlayControls,
  type MaskOverlayDisplay,
  type SegmentationMaskGeometry,
  type SegmentationMaskOverlay,
  type SegmentationMaskOverlaySource,
  type SegmentationMaskStyle,
} from "../imageSource";
import { clearMaskGeometryCaches, maskOf } from "../maskGeometry";
import { OVERLAY_COLORS } from "../overlayColors";
import type { SegmentationRuntime, SegmentationSession } from "../runtime";
import { frameInstanceKey } from "../service";
import type { SegmentationDocument, SegmentationFrame, SegmentationStore } from "../types";
import { MAX_MASK_SLOTS } from "./maskPlanes";

/** Read-only overlay opacity (no session open); the editor's own slider drives it otherwise. */
const PREVIEW_OPACITY = 0.45;
/** Initial opacity of the editor's mask slider. */
export const DEFAULT_EDITOR_OPACITY = 0.5;

const DEFAULT_CONTROLS: MaskOverlayDisplay = {
  opacity: DEFAULT_EDITOR_OPACITY,
  peekOriginal: false,
};

export function createMaskOverlayControls(): MaskOverlayControls {
  return createStore<MaskOverlayDisplay>(() => DEFAULT_CONTROLS);
}

type TopicIndex = {
  frames: SegmentationFrame[];
  /** BigInt(frames[i].logTimeNs), parsed once per index build, ascending. */
  times: bigint[];
  byLogTime: Map<string, number>;
};

/** Index of the first time strictly after `time`, by binary search (times.length when none). */
function firstAfter(times: readonly bigint[], time: bigint): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function hexColor(hex: string | undefined): [number, number, number] {
  const match =
    /^#?([0-9a-f]{6})$/i.exec(hex ?? "") ?? /^#([0-9a-f]{6})$/i.exec(OVERLAY_COLORS.unclassified)!;
  const value = parseInt(match[1]!, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Frames whose geometry id survives document changes; past this the oldest-used is dropped. */
const LAST_GEOMETRY_LIMIT = 2048;

export type MaskOverlaySourceStats = {
  truncatedFrames: number;
  sizeMismatches: number;
  /** Geometry ids handed out; a steady document should stop growing this. */
  idsIssued: number;
};

/**
 * Reads the shared segmentation session: the editing runtime when the session is open, otherwise
 * the read-only preview runtime. Mask observations only; polygons stay on the SVG layer.
 */
export function createMaskOverlaySource({
  session: sessionStore,
}: {
  session: SegmentationSession;
}): SegmentationMaskOverlaySource & {
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
   * frames. Any change of size, instances or counts gets a new id. An LRU bounded by
   * LAST_GEOMETRY_LIMIT, so switching records does not keep every frame ever shown.
   */
  const lastGeometry = new Map<string, SegmentationMaskGeometry>();
  const stats: MaskOverlaySourceStats = {
    truncatedFrames: 0,
    sizeMismatches: 0,
    idsIssued: 0,
  };

  function state(): SegmentationStore | undefined {
    const session = sessionStore.getState();
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
      const keyed = (byVideo.get(video.id) ?? []).map((frame) => ({
        frame,
        time: BigInt(frame.logTimeNs),
      }));
      keyed.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      const frames = keyed.map((item) => item.frame);
      topics.set(video.topic, {
        frames,
        times: keyed.map((item) => item.time),
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
      const mask = maskOf(doc.annotations[frameInstanceKey(frame.id, instance.id)]);
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
    lastGeometry.delete(cacheKey);
    if (geometry) {
      lastGeometry.set(cacheKey, geometry);
      if (lastGeometry.size > LAST_GEOMETRY_LIMIT) {
        lastGeometry.delete(lastGeometry.keys().next().value!);
      }
    }
    return geometry;
  }

  /** Lookup tables per document arrays; rebuilt only when the arrays change. */
  const classTables = new WeakMap<object, Map<string, SegmentationDocument["classes"][number]>>();
  const instanceTables = new WeakMap<
    object,
    Map<string, SegmentationDocument["instances"][number]>
  >();
  /**
   * Last style per geometry and the inputs it was computed from. Every Image panel asks for its
   * frame's style on every render frame; without this each call rebuilt two Maps and four arrays.
   */
  const styles = new WeakMap<
    MaskOverlayDisplay,
    WeakMap<SegmentationMaskGeometry, { inputs: readonly unknown[]; style: SegmentationMaskStyle }>
  >();

  function styleOf(
    store: SegmentationStore,
    doc: SegmentationDocument,
    geometry: SegmentationMaskGeometry,
    controls: MaskOverlayDisplay,
  ): SegmentationMaskStyle {
    const session = sessionStore.getState();
    let panelStyles = styles.get(controls);
    if (panelStyles == undefined) {
      panelStyles = new WeakMap();
      styles.set(controls, panelStyles);
    }
    const inputs = [
      session.open,
      store.viewMode,
      store.focus,
      store.selection,
      doc.classes,
      doc.instances,
    ] as const;
    const cached = panelStyles.get(geometry);
    if (cached?.inputs.every((value, index) => value === inputs[index]) === true) {
      return cached.style;
    }
    const style = computeStyle(store, doc, geometry, { editing: session.open, controls });
    panelStyles.set(geometry, { inputs, style });
    return style;
  }

  function computeStyle(
    store: SegmentationStore,
    doc: SegmentationDocument,
    geometry: SegmentationMaskGeometry,
    { editing, controls }: { editing: boolean; controls: MaskOverlayDisplay },
  ): SegmentationMaskStyle {
    const hiddenAll = editing && (store.viewMode === "original" || controls.peekOriginal);
    let classes = classTables.get(doc.classes);
    if (!classes) {
      classes = new Map(doc.classes.map((item) => [item.id, item]));
      classTables.set(doc.classes, classes);
    }
    let instances = instanceTables.get(doc.instances);
    if (!instances) {
      instances = new Map(doc.instances.map((item) => [item.id, item]));
      instanceTables.set(doc.instances, instances);
    }
    const instanceTable = instances;
    const matches = (ref: { type: string; id: string } | undefined, instanceId: string) =>
      ref != undefined &&
      ((ref.type === "instance" && ref.id === instanceId) ||
        (ref.type === "class" && instanceTable.get(instanceId)?.classId === ref.id));
    return {
      colors: geometry.instanceIds.map((id) =>
        hexColor(classes.get(instanceTable.get(id)?.classId ?? "")?.color),
      ),
      visible: geometry.instanceIds.map(
        (id) => !hiddenAll && (!editing || store.viewMode === "all" || matches(store.focus, id)),
      ),
      selected: geometry.instanceIds.map(
        (id) =>
          editing && (matches(store.focus, id) || store.selection.some((ref) => matches(ref, id))),
      ),
      opacity: editing ? controls.opacity : PREVIEW_OPACITY,
    };
  }

  return {
    stats,
    frame(topic, logTimeNs, controls = DEFAULT_CONTROLS) {
      const store = state();
      const doc = store?.document;
      if (!store || !doc) {
        return undefined;
      }
      const entry = index(doc).get(topic);
      const position = entry?.byLogTime.get(logTimeNs);
      const frame = position == undefined ? undefined : entry!.frames[position];
      const geometry = frame ? geometryOf(doc, topic, frame) : undefined;
      return geometry ? { geometry, style: styleOf(store, doc, geometry, controls) } : undefined;
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
      const time = BigInt(logTimeNs);
      // The displayed frame, or (between registered frames) the slot before the next later one.
      const start = entry.byLogTime.get(logTimeNs) ?? firstAfter(entry.times, time) - 1;
      const out: SegmentationMaskGeometry[] = [];
      const until = time + horizonNs;
      for (let i = start + 1; i < entry.frames.length && i <= start + maxFrames; i++) {
        if (i > start + minFrames && entry.times[i]! > until) {
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

/**
 * Publishes the session's masks to every Image panel of a host, until the returned function is
 * called.
 */
export function installMaskOverlaySource({
  session,
  overlay,
}: {
  session: SegmentationSession;
  overlay: SegmentationMaskOverlay;
}): () => void {
  overlay.set(createMaskOverlaySource({ session }));
  let unsubscribeRuntime: (() => void) | undefined;
  let watched: SegmentationRuntime | undefined;
  const invalidate = () => {
    overlay.invalidate();
  };
  const watch = () => {
    const state = session.getState();
    const runtime = state.open ? state.runtime : state.previewRuntime;
    if (runtime !== watched) {
      if (watched != undefined) {
        // Another recording (or none): the decoded masks of the previous one are dead weight.
        clearMaskGeometryCaches();
      }
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
  const unsubscribeSession = session.subscribe((next, previous) => {
    if (
      next.open !== previous.open ||
      next.runtime !== previous.runtime ||
      next.previewRuntime !== previous.previewRuntime
    ) {
      watch();
    }
  });
  return () => {
    unsubscribeSession();
    unsubscribeRuntime?.();
    unsubscribeRuntime = undefined;
    overlay.set(undefined);
  };
}
