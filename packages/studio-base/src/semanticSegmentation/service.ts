// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { ANNOTATION_WINDOW_SEC } from "./annotationFrames";
import { SegmentationError } from "./errors";
import {
  mergeObservations,
  polygonObservation,
  polygonsOf,
  runsOfMask,
  summarizeObservation,
} from "./maskGeometry";
import { normalizedPolygonProblem } from "./normalizedPolygon";
import type { QuickSegmentRequest, QuickSegmentResult } from "./quickSegment";
import {
  FrameWindow,
  ObservationGeometry,
  PropagationCapabilities,
  PropagationCancellation,
  PropagationContext,
  PropagationRequest,
  PropagationResult,
  PropagationSeed,
  SegmentationDocument,
  SegmentationMask,
  SegmentationPatch,
  SegmentationPolygon,
  SubmitRequest,
  SegmentationFrame,
  SubmitResult,
} from "./types";

/**
 * Frames a propagation run writes, in the order results arrive. An end after the seed goes
 * forward over seed < t <= end; an end before it goes backward over end <= t < seed, latest first.
 */
export function propagationTargets(
  frames: readonly SegmentationFrame[],
  source: SegmentationFrame,
  endTimeNs: string,
): SegmentationFrame[] {
  if (!/^\d+$/.test(endTimeNs) || BigInt(endTimeNs) === BigInt(source.logTimeNs)) {
    throw new SegmentationError("errorPropagationEndEqualsSeed");
  }
  const seed = BigInt(source.logTimeNs);
  const end = BigInt(endTimeNs);
  const backward = end < seed;
  return frames
    .filter((frame) => {
      if (frame.videoId !== source.videoId) {
        return false;
      }
      const time = BigInt(frame.logTimeNs);
      return backward ? time >= end && time < seed : time > seed && time <= end;
    })
    .sort((a, b) => (backward ? b.index - a.index : a.index - b.index));
}

/** Replace this boundary with a production adapter; the workbench has no transport dependency. */
export interface SemanticSegmentationService {
  /** Append real source metadata without changing annotation identity. */
  updateSourceMetadata?(metadata: Pick<SegmentationDocument, "videos" | "frames">): void;
  loadDocument(signal?: AbortSignal): Promise<SegmentationDocument>;
  loadFrameWindow(
    videoId: string,
    startSec: number,
    endSec: number,
    signal?: AbortSignal,
  ): Promise<FrameWindow>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  /** True means every result must echo the full request context. */
  supportsPropagationContext?: boolean;
  supportsMultiInstanceSeeds?: boolean;
  /**
   * True when `submit` accepts `instanceMerges`. The UI offers instance and class merges only then;
   * polygon merges are plain annotation edits and always work.
   */
  supportsInstanceMerge?: boolean;
  getPropagationCapabilities?(): Promise<PropagationCapabilities>;
  cancelPropagation?(context: PropagationContext): Promise<PropagationCancellation>;
  propagate(request: PropagationRequest, signal: AbortSignal): AsyncIterable<PropagationResult>;
  /** Stops background reads and drops listeners; the runtime calls it when the session ends. */
  dispose?(): void;
  /** Quick annotation: one object's mask from clicks on the displayed frame. Unsaved draft. */
  segmentFrame?(request: QuickSegmentRequest, signal?: AbortSignal): Promise<QuickSegmentResult>;
}

/** Encode both IDs to avoid collisions even when an ID contains a separator. */
export function frameInstanceKey(frameId: string, instanceId: string): string {
  return JSON.stringify([frameId, instanceId])!;
}

export function cloneSegmentation<T>(value: T): T {
  // Preserve undefined patch values: they represent entity deletion.
  return _.cloneDeep(value);
}

export function validatePropagationCapabilities(
  request: PropagationRequest,
  capabilities?: PropagationCapabilities,
): void {
  if (!capabilities) {
    return;
  }
  if (request.model != undefined && !capabilities.models.includes(request.model)) {
    throw new SegmentationError("errorModelUnsupported");
  }
}

/**
 * Freeze exactly the selected seed geometry. Without explicit seeds the source observation is
 * the seed: a mask as itself, polygons optionally limited to `polygonIds`.
 */
export function resolvePropagationSeeds(
  request: PropagationRequest,
  source?: ObservationGeometry,
): PropagationSeed[] {
  const supplied: PropagationSeed[] =
    request.seeds ??
    (source?.kind === "mask"
      ? [{ instanceId: request.instanceId, kind: "mask", mask: source.mask }]
      : [
          {
            instanceId: request.instanceId,
            kind: "polygons",
            polygons: (source?.polygons ?? []).filter(
              (polygon) =>
                polygon.points.length > 0 &&
                (!request.polygonIds || request.polygonIds.includes(polygon.id)),
            ),
          },
        ]);
  const instances = new Map<string, Map<string, SegmentationPolygon>>();
  const masks = new Map<string, SegmentationMask>();
  for (const seed of supplied) {
    if (seed.kind === "mask") {
      if (!seed.instanceId.trim()) {
        throw new SegmentationError("errorMaskSeedNeedsInstance");
      }
      // A mask seed is one authoritative representation; it cannot be combined with polygons.
      if (instances.has(seed.instanceId)) {
        throw new SegmentationError("errorMaskSeedWithPolygons");
      }
      const existing = masks.get(seed.instanceId);
      if (existing && existing.counts !== seed.mask.counts) {
        throw new SegmentationError("errorConflictingSeedMask");
      }
      if (runsOfMask(seed.mask).area === 0) {
        throw new SegmentationError("errorEmptySeedMask");
      }
      masks.set(seed.instanceId, cloneSegmentation(seed.mask));
      continue;
    }
    if (!seed.instanceId.trim() || seed.polygons.length === 0 || masks.has(seed.instanceId)) {
      throw new SegmentationError("errorEmptySeedPolygon");
    }
    const polygons = instances.get(seed.instanceId) ?? new Map<string, SegmentationPolygon>();
    for (const polygon of seed.polygons) {
      if (!polygon.id || normalizedPolygonProblem(polygon.points) != undefined) {
        throw new SegmentationError("errorInvalidSeedPolygon");
      }
      const existing = polygons.get(polygon.id);
      if (existing && !_.isEqual(existing, polygon)) {
        throw new SegmentationError("errorConflictingSeedPolygon");
      }
      polygons.set(polygon.id, cloneSegmentation(polygon));
    }
    instances.set(seed.instanceId, polygons);
  }
  if (instances.size === 0 && masks.size === 0) {
    throw new SegmentationError("errorEmptySeedPolygon");
  }
  return [
    ...[...instances].map(([instanceId, polygons]): PropagationSeed => ({
      instanceId,
      kind: "polygons",
      polygons: [...polygons.values()],
    })),
    ...[...masks].map(([instanceId, seedMask]): PropagationSeed => ({
      instanceId,
      kind: "mask",
      mask: seedMask,
    })),
  ];
}

function patchCollection<T extends { id: string }>(
  source: T[],
  changes?: Record<string, T | undefined>,
): T[] {
  if (!changes || Object.keys(changes).length === 0) {
    return source;
  }
  const entities = new Map(source.map((item) => [item.id, item]));
  for (const [id, value] of Object.entries(changes)) {
    if (value) {
      entities.set(id, cloneSegmentation(value));
    } else {
      entities.delete(id);
    }
  }
  return [...entities.values()];
}

export function applySegmentationPatch(
  document: SegmentationDocument,
  patch: SegmentationPatch,
): SegmentationDocument {
  return applySegmentationPatches(document, [patch]);
}

/**
 * Replay an immutable overlay in order. The result shares every entity the patches leave alone
 * with `document` (structural sharing); only the changed containers and values are new. Callers
 * replace values, never mutate them in place.
 */
export function applySegmentationPatches(
  document: SegmentationDocument,
  patches: readonly SegmentationPatch[],
): SegmentationDocument {
  if (patches.length === 0) {
    return document;
  }
  const next: SegmentationDocument = {
    ...document,
    annotations: { ...document.annotations },
    annotationSummaries: { ...document.annotationSummaries },
    ...(document.unreadableObservations
      ? { unreadableObservations: { ...document.unreadableObservations } }
      : {}),
  };
  for (const patch of patches) {
    applyPatchToCopy(next, patch);
  }
  return next;
}

/**
 * Only receives a private copy of the document's containers; patch payloads remain independently
 * owned. Summaries are recomputed for the keys the patch touches only: a mask summary decodes it.
 */
function applyPatchToCopy(next: SegmentationDocument, patch: SegmentationPatch): void {
  next.classes = patchCollection(next.classes, patch.classes);
  next.instances = patchCollection(next.instances, patch.instances);
  const touched = new Set<string>();
  for (const [key, value] of Object.entries(patch.annotations ?? {})) {
    touched.add(key);
    if (value) {
      next.annotations[key] = cloneSegmentation(value);
    } else {
      delete next.annotations[key];
    }
  }
  for (const [key, change] of Object.entries(patch.polygonChanges ?? {})) {
    touched.add(key);
    const current = next.annotations[key];
    const polygons = new Map(polygonsOf(current).map((polygon) => [polygon.id, polygon]));
    for (const [id, polygon] of Object.entries(change.polygons)) {
      if (polygon) {
        polygons.set(id, cloneSegmentation(polygon));
      } else {
        polygons.delete(id);
      }
    }
    const merged = polygonObservation(change.frameId, change.instanceId, [...polygons.values()]);
    // Polygon deltas replace a mask only once they leave polygons behind; never both.
    if (merged) {
      next.annotations[key] = merged;
    } else if (current?.kind !== "mask") {
      delete next.annotations[key];
    }
  }
  const merges = Object.entries(patch.instanceMerges ?? {});
  for (const [sourceId, targetId] of merges) {
    for (const [key, summary] of Object.entries(next.annotationSummaries)) {
      const [frameId, instanceId] = JSON.parse(key) as [string, string];
      if (instanceId !== sourceId) {
        continue;
      }
      const targetKey = frameInstanceKey(frameId, targetId);
      const target = next.annotationSummaries[targetKey];
      const maskTotal = (summary.maskArea ?? 0) + (target?.maskArea ?? 0);
      next.annotationSummaries[targetKey] = {
        polygonCount: summary.polygonCount + (target?.polygonCount ?? 0),
        pointCount: summary.pointCount + (target?.pointCount ?? 0),
        ...(summary.maskArea != undefined || target?.maskArea != undefined
          ? { maskArea: maskTotal }
          : {}),
      };
      delete next.annotationSummaries[key];
    }
    for (const [key, annotation] of Object.entries(next.annotations)) {
      if (annotation.instanceId !== sourceId) {
        continue;
      }
      const targetKey = frameInstanceKey(annotation.frameId, targetId);
      touched.add(targetKey);
      const target = next.annotations[targetKey];
      next.annotations[targetKey] = mergeObservations(target, annotation, targetId);
      delete next.annotations[key];
    }
  }
  const validInstanceIds = new Set(next.instances.map((instance) => instance.id));
  const removesInstances =
    merges.length > 0 || Object.values(patch.instances ?? {}).some((value) => value == undefined);
  // Observations of a removed instance go with it. Without a removal only the touched keys can
  // name an unknown instance (a write for an instance that no longer exists).
  const instanceOf = (key: string) => (JSON.parse(key) as [string, string])[1];
  for (const key of removesInstances ? Object.keys(next.annotations) : touched) {
    const annotation = next.annotations[key];
    if (annotation && !validInstanceIds.has(annotation.instanceId)) {
      delete next.annotations[key];
    }
  }
  for (const key of removesInstances ? Object.keys(next.annotationSummaries) : touched) {
    if (key in next.annotationSummaries && !validInstanceIds.has(instanceOf(key))) {
      delete next.annotationSummaries[key];
    }
  }
  if (next.unreadableObservations) {
    // A user write (or clear) of the same instance/frame supersedes what could not be read.
    for (const [key, unreadable] of Object.entries(next.unreadableObservations)) {
      if (
        !validInstanceIds.has(unreadable.instanceId) ||
        key in (patch.annotations ?? {}) ||
        key in (patch.polygonChanges ?? {}) ||
        patch.instanceMerges?.[unreadable.instanceId] != undefined
      ) {
        delete next.unreadableObservations[key];
      }
    }
  }
  for (const key of touched) {
    const annotation = next.annotations[key];
    if (annotation) {
      next.annotationSummaries[key] = summarizeObservation(annotation);
    } else {
      delete next.annotationSummaries[key];
    }
  }
}

/** Includes unloaded geometry affected by record-wide instance operations. */
export function patchAnnotationKeys(
  document: SegmentationDocument,
  patch: SegmentationPatch,
): string[] {
  const keys = new Set([
    ...Object.keys(patch.annotations ?? {}),
    ...Object.keys(patch.polygonChanges ?? {}),
  ]);
  for (const key of new Set([
    ...Object.keys(document.annotationSummaries),
    ...Object.keys(document.annotations),
  ])) {
    const [frameId, instanceId] = JSON.parse(key) as [string, string];
    if (
      (patch.instances && instanceId in patch.instances && !patch.instances[instanceId]) ||
      patch.instanceMerges?.[instanceId]
    ) {
      keys.add(key);
      const targetId = patch.instanceMerges?.[instanceId];
      if (targetId) {
        keys.add(frameInstanceKey(frameId, targetId));
      }
    }
  }
  return [...keys];
}

export function validateFrameWindow(startSec: number, endSec: number): void {
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    startSec < 0 ||
    endSec < startSec ||
    endSec - startSec > ANNOTATION_WINDOW_SEC
  ) {
    throw new SegmentationError("errorWindowSpan", { max: ANNOTATION_WINDOW_SEC });
  }
}

// Frame lookups by ID per frames table. Runtimes grow their table in place, so the length is
// part of the key.
const frameIndexes = new WeakMap<
  readonly SegmentationDocument["frames"][number][],
  { length: number; byId: Map<string, SegmentationDocument["frames"][number]> }
>();

/**
 * Whether `mergeSourceMetadata(document, metadata)` would change the source tables: a new or
 * longer video, a new decoded size, or a frame not listed yet. A conflicting entry counts as a
 * change, so the merge still runs and rejects it.
 */
export function sourceMetadataChanges(
  document: Pick<SegmentationDocument, "videos" | "frames">,
  metadata: Pick<SegmentationDocument, "videos" | "frames">,
): boolean {
  for (const video of metadata.videos) {
    const existing = document.videos.find((item) => item.id === video.id);
    if (
      existing?.recordId !== video.recordId ||
      !(video.durationSec <= existing.durationSec) ||
      (video.width != undefined &&
        video.height != undefined &&
        (video.width !== existing.width || video.height !== existing.height))
    ) {
      return true;
    }
  }
  let index = frameIndexes.get(document.frames);
  if (index?.length !== document.frames.length) {
    index = {
      length: document.frames.length,
      byId: new Map(document.frames.map((frame) => [frame.id, frame])),
    };
    frameIndexes.set(document.frames, index);
  }
  for (const frame of metadata.frames) {
    const existing = index.byId.get(frame.id);
    if (existing?.videoId !== frame.videoId || existing.timestampSec !== frame.timestampSec) {
      return true;
    }
  }
  return false;
}

/** Source IDs and timestamps are immutable; display indices follow actual presentation order. */
export function mergeSourceMetadata(
  document: SegmentationDocument,
  metadata: Pick<SegmentationDocument, "videos" | "frames">,
): SegmentationDocument {
  const videos = new Map(document.videos.map((video) => [video.id, video]));
  for (const video of metadata.videos) {
    const existing = videos.get(video.id);
    if (
      !Number.isFinite(video.durationSec) ||
      video.durationSec < 0 ||
      video.recordId !== document.record.id ||
      (existing && existing.recordId !== video.recordId)
    ) {
      throw new SegmentationError("errorVideoOtherRecord");
    }
    videos.set(
      video.id,
      existing
        ? {
            ...existing,
            durationSec: Math.max(existing.durationSec, video.durationSec),
            // A newly decoded frame is the authority for the topic's source size.
            ...(video.width != undefined && video.height != undefined
              ? { width: video.width, height: video.height }
              : {}),
          }
        : cloneSegmentation(video),
    );
  }
  const frames = new Map(document.frames.map((frame) => [frame.id, frame]));
  for (const frame of metadata.frames) {
    const existing = frames.get(frame.id);
    if (
      !videos.has(frame.videoId) ||
      !Number.isFinite(frame.timestampSec) ||
      frame.timestampSec < 0 ||
      frame.timestampSec > videos.get(frame.videoId)!.durationSec ||
      (existing &&
        (existing.videoId !== frame.videoId || existing.timestampSec !== frame.timestampSec))
    ) {
      throw new SegmentationError("errorConflictingFrameMetadata");
    }
    if (!existing) {
      frames.set(frame.id, cloneSegmentation(frame));
    }
  }
  const indices = new Map<string, number>();
  const ordered = [...frames.values()]
    .sort((a, b) => {
      const videoOrder = a.videoId.localeCompare(b.videoId);
      if (videoOrder !== 0) {
        return videoOrder;
      }
      const timeOrder = a.timestampSec - b.timestampSec;
      return timeOrder !== 0 ? timeOrder : a.id.localeCompare(b.id);
    })
    .map((frame) => {
      const index = indices.get(frame.videoId) ?? 0;
      indices.set(frame.videoId, index + 1);
      return { ...frame, index };
    });
  return { ...document, videos: [...videos.values()], frames: ordered };
}
