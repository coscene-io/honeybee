// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { ANNOTATION_WINDOW_SEC } from "./annotationFrames";
import {
  mergeObservations,
  polygonObservation,
  polygonsOf,
  runsOfMask,
  summarizeObservation,
} from "./maskGeometry";
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
    throw new Error("End time must differ from the seed frame");
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
  getPropagationCapabilities?(): Promise<PropagationCapabilities>;
  cancelPropagation?(context: PropagationContext): Promise<PropagationCancellation>;
  propagate(request: PropagationRequest, signal: AbortSignal): AsyncIterable<PropagationResult>;
  /** Quick annotation: one object's mask from clicks on the displayed frame. Unsaved draft. */
  segmentFrame?(request: QuickSegmentRequest, signal?: AbortSignal): Promise<QuickSegmentResult>;
  getPersistenceError?(): string | undefined;
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
    throw new Error("Selected propagation model is not supported by this adapter");
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
        throw new Error("A mask seed requires an instance");
      }
      // A mask seed is one authoritative representation; it cannot be combined with polygons.
      if (instances.has(seed.instanceId)) {
        throw new Error("A mask seed cannot be combined with polygons for the same instance");
      }
      const existing = masks.get(seed.instanceId);
      if (existing && existing.counts !== seed.mask.counts) {
        throw new Error("Conflicting geometry for the same seed mask");
      }
      if (runsOfMask(seed.mask).area === 0) {
        throw new Error("Propagation requires a nonempty seed mask");
      }
      masks.set(seed.instanceId, cloneSegmentation(seed.mask));
      continue;
    }
    if (!seed.instanceId.trim() || seed.polygons.length === 0 || masks.has(seed.instanceId)) {
      throw new Error("Propagation requires a nonempty seed polygon");
    }
    const polygons = instances.get(seed.instanceId) ?? new Map<string, SegmentationPolygon>();
    for (const polygon of seed.polygons) {
      const points = polygon.points;
      const area = points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]!;
        return sum + point.x * next.y - next.x * point.y;
      }, 0);
      if (
        !polygon.id ||
        points.length < 3 ||
        Math.abs(area) <= 1e-12 ||
        points.some(
          ({ x, y }) =>
            !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1,
        )
      ) {
        throw new Error(
          "Propagation requires a valid nonempty seed polygon in normalized image coordinates",
        );
      }
      const existing = polygons.get(polygon.id);
      if (existing && !_.isEqual(existing, polygon)) {
        throw new Error("Conflicting geometry for the same seed polygon");
      }
      polygons.set(polygon.id, cloneSegmentation(polygon));
    }
    instances.set(seed.instanceId, polygons);
  }
  if (instances.size === 0 && masks.size === 0) {
    throw new Error("Propagation requires a nonempty seed polygon");
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
  const entities = new Map(source.map((item) => [item.id, item]));
  for (const [id, value] of Object.entries(changes ?? {})) {
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

/** Replay an immutable overlay in order, cloning the base only once for the whole replay. */
export function applySegmentationPatches(
  document: SegmentationDocument,
  patches: readonly SegmentationPatch[],
): SegmentationDocument {
  if (patches.length === 0) {
    return document;
  }
  const next = cloneSegmentation(document);
  for (const patch of patches) {
    applyPatchToClone(next, patch);
  }
  return next;
}

/** Only receives a private document clone; patch payloads remain independently owned. */
function applyPatchToClone(next: SegmentationDocument, patch: SegmentationPatch): void {
  next.classes = patchCollection(next.classes, patch.classes);
  next.instances = patchCollection(next.instances, patch.instances);
  next.momentReferences = patchCollection(next.momentReferences, patch.momentReferences);
  for (const [key, value] of Object.entries(patch.annotations ?? {})) {
    if (value) {
      next.annotations[key] = cloneSegmentation(value);
    } else {
      delete next.annotations[key];
    }
  }
  for (const [key, change] of Object.entries(patch.polygonChanges ?? {})) {
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
  for (const [sourceId, targetId] of Object.entries(patch.instanceMerges ?? {})) {
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
      const target = next.annotations[targetKey];
      next.annotations[targetKey] = mergeObservations(target, annotation, targetId);
      delete next.annotations[key];
    }
  }
  const validInstanceIds = new Set(next.instances.map((instance) => instance.id));
  for (const [key, annotation] of Object.entries(next.annotations)) {
    if (!validInstanceIds.has(annotation.instanceId)) {
      delete next.annotations[key];
    }
  }
  for (const key of Object.keys(next.annotationSummaries)) {
    const [, instanceId] = JSON.parse(key) as [string, string];
    if (!validInstanceIds.has(instanceId)) {
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
  for (const key of Object.keys(patch.annotations ?? {})) {
    delete next.annotationSummaries[key];
  }
  for (const [key, annotation] of Object.entries(next.annotations)) {
    next.annotationSummaries[key] = summarizeObservation(annotation);
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
    throw new Error(`Frame windows must span between 0 and ${ANNOTATION_WINDOW_SEC} seconds`);
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
      throw new Error("Source video belongs to a different record");
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
      throw new Error("Conflicting source frame metadata");
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
