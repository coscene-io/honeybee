// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import {
  FrameWindow,
  MediaCacheSource,
  PropagationCapabilities,
  PropagationCancellation,
  PropagationContext,
  PropagationRequest,
  PropagationResult,
  PropagationSeed,
  SegmentationDocument,
  SegmentationPatch,
  SegmentationPolygon,
  SegmentationRevision,
  SubmitRequest,
  SubmitResult,
} from "./types";

/** Replace this boundary with a production adapter; the workbench has no transport dependency. */
export interface SemanticSegmentationService {
  /** Append real source metadata without changing annotation or revision identity. */
  updateSourceMetadata?(metadata: Pick<SegmentationDocument, "videos" | "frames">): void;
  loadDocument(signal?: AbortSignal): Promise<SegmentationDocument>;
  loadFrameWindow(
    videoId: string,
    startSec: number,
    endSec: number,
    signal?: AbortSignal,
  ): Promise<FrameWindow>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  listRevisions(): Promise<SegmentationRevision[]>;
  loadRevision(id: string): Promise<SegmentationDocument>;
  /** Reject if the authoritative head changed after the confirmation was opened. */
  rollbackRevision(id: string, expectedHeadRevisionId?: string): Promise<SubmitResult>;
  /** True means every result must echo the full request context, including any revision label. */
  supportsPropagationContext?: boolean;
  supportsMultiInstanceSeeds?: boolean;
  getPropagationCapabilities?(): Promise<PropagationCapabilities>;
  cancelPropagation?(context: PropagationContext): Promise<PropagationCancellation>;
  propagate(request: PropagationRequest, signal: AbortSignal): AsyncIterable<PropagationResult>;
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

/** Production adapters may normalize a remote cache-miss into this scoped transport error. */
export class MediaCacheMissError extends Error {
  public readonly code = "CACHE_MISS";
  public constructor(
    public readonly source: MediaCacheSource,
    public readonly cacheKey?: string,
  ) {
    super("Media cache acknowledgement is missing or expired; upload this video again");
    this.name = "MediaCacheMissError";
  }
}

export function validatePropagationCapabilities(
  request: PropagationRequest,
  capabilities?: PropagationCapabilities,
  range?: { beforeFrames: number; afterFrames: number },
): void {
  if (!capabilities) {
    return;
  }
  const directions = range
    ? [
        ...(range.beforeFrames > 0 ? ["backward" as const] : []),
        ...(range.afterFrames > 0 ? ["forward" as const] : []),
      ]
    : [request.direction];
  for (const direction of directions) {
    if (!capabilities.directions.includes(direction)) {
      throw new Error(
        capabilities.directionReasons?.[direction] ??
          `Propagation direction ${direction} is not supported by this adapter`,
      );
    }
  }
  if (request.model != undefined && !capabilities.models.includes(request.model)) {
    throw new Error("Selected propagation model is not supported by this adapter");
  }
  if (request.resolution != undefined && !capabilities.resolutions.includes(request.resolution)) {
    throw new Error("Selected propagation resolution is not supported by this adapter");
  }
}

/** Freeze exactly the selected seed geometry; absent legacy fields alone use the fallback. */
export function resolvePropagationSeeds(
  request: PropagationRequest,
  fallback: SegmentationPolygon[] = [],
): PropagationSeed[] {
  const supplied = request.seeds ?? [
    {
      instanceId: request.instanceId,
      polygons: (request.seedPolygons ?? fallback).filter(
        (polygon) =>
          polygon.points.length > 0 &&
          (!request.polygonIds || request.polygonIds.includes(polygon.id)),
      ),
    },
  ];
  const instances = new Map<string, Map<string, SegmentationPolygon>>();
  for (const seed of supplied) {
    if (!seed.instanceId.trim() || seed.polygons.length === 0) {
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
  if (instances.size === 0) {
    throw new Error("Propagation requires a nonempty seed polygon");
  }
  return [...instances].map(([instanceId, polygons]) => ({
    instanceId,
    polygons: [...polygons.values()],
  }));
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
    const polygons = new Map((current?.polygons ?? []).map((polygon) => [polygon.id, polygon]));
    for (const [id, polygon] of Object.entries(change.polygons)) {
      if (polygon) {
        polygons.set(id, cloneSegmentation(polygon));
      } else {
        polygons.delete(id);
      }
    }
    next.annotations[key] = {
      frameId: change.frameId,
      instanceId: change.instanceId,
      version: next.versions[key] ?? 0,
      polygons: [...polygons.values()],
    };
  }
  for (const [sourceId, targetId] of Object.entries(patch.instanceMerges ?? {})) {
    for (const [key, summary] of Object.entries(next.annotationSummaries)) {
      const [frameId, instanceId] = JSON.parse(key) as [string, string];
      if (instanceId !== sourceId) {
        continue;
      }
      const targetKey = frameInstanceKey(frameId, targetId);
      const target = next.annotationSummaries[targetKey];
      next.annotationSummaries[targetKey] = {
        polygonCount: summary.polygonCount + (target?.polygonCount ?? 0),
        pointCount: summary.pointCount + (target?.pointCount ?? 0),
      };
      delete next.annotationSummaries[key];
    }
    for (const [key, annotation] of Object.entries(next.annotations)) {
      if (annotation.instanceId !== sourceId) {
        continue;
      }
      const targetKey = frameInstanceKey(annotation.frameId, targetId);
      const target = next.annotations[targetKey];
      next.annotations[targetKey] = {
        ...annotation,
        instanceId: targetId,
        polygons: [...(target?.polygons ?? []), ...annotation.polygons],
      };
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
  for (const key of Object.keys(patch.annotations ?? {})) {
    delete next.annotationSummaries[key];
  }
  for (const [key, annotation] of Object.entries(next.annotations)) {
    next.annotationSummaries[key] = {
      polygonCount: annotation.polygons.length,
      pointCount: annotation.polygons.reduce((sum, polygon) => sum + polygon.points.length, 0),
    };
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
    ...Object.keys(document.versions),
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
    endSec - startSec > 10
  ) {
    throw new Error("Frame windows must span between 0 and 10 seconds");
  }
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
        ? { ...existing, durationSec: Math.max(existing.durationSec, video.durationSec) }
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
