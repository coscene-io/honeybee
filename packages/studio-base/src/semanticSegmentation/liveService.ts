// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, type Client } from "@connectrpc/connect";

import type {
  Frame as WireFrame,
  FrameSchema,
  FrameSnapshotSchema,
} from "@foxglove/studio-base/services/api/spatial-annotation/generated/coscene/dataplatform/v1alpha3/resources/annotation_pb";
import type {
  AnnotationService,
  ListTimelineRangesResponse_TimelineRange as WireTimelineRange,
} from "@foxglove/studio-base/services/api/spatial-annotation/generated/coscene/dataplatform/v1alpha3/services/annotation_pb";

import { ANNOTATION_WINDOW_SEC } from "./annotationFrames";
import {
  FrameTimeIndex,
  microsToIso,
  microsToTimestamp,
  timestampToMicros,
  truncateToMicros,
  windowBoundaryMicros,
} from "./frameTime";
import { maskRunsFromCounts } from "./maskCodec";
import { maskObservation, observationHasGeometry, polygonObservation } from "./maskGeometry";
import { describeViolation, polygonViolation } from "./polygonContract";
import {
  applySegmentationPatches,
  cloneSegmentation,
  frameInstanceKey,
  mergeSourceMetadata,
  patchAnnotationKeys,
  resolvePropagationSeeds,
  type SemanticSegmentationService,
  validateFrameWindow,
} from "./service";
import type {
  AnnotationSummary,
  FrameInstance,
  FrameWindow,
  ObservationGeometry,
  PropagationResult,
  SegmentationClass,
  SegmentationDocument,
  SegmentationInstance,
  SegmentationPolygon,
  SegmentationVideo,
  SubmitResult,
  UnreadableObservation,
} from "./types";
import { isUuid, polygonWireId } from "./wireIds";

export type AnnotationClient = Client<typeof AnnotationService>;
type WireFrameInit = MessageInitShape<typeof FrameSchema>;
type WireFrameSnapshotInit = MessageInitShape<typeof FrameSnapshotSchema>;

/** ListFrames rejects windows longer than this; longer local windows are read in pieces. */
const MAX_WINDOW_MICROS = BigInt(ANNOTATION_WINDOW_SEC) * 1_000_000n;
const PAGE_SIZE = 1000;
/**
 * Models the backend accepts for mask/polygon seeds. data-platform-server #2403 rejects anything
 * but sam2.1-motion with INVALID_ARGUMENT; sam3.1 in the contract example is not deployed.
 */
export const LIVE_PROPAGATION_MODELS = ["sam2.1-motion"];

export type LiveServiceDiagnostics = {
  recordName: string;
  /** Last ListTimelineRanges failure per topic (the tree then has no unloaded presence). */
  timelineErrors: Record<string, string>;
  /** Server observations whose frame_time matched no registered local frame. */
  unregisteredObservations: number;
  /** Server observations on a frame_time that two local frames truncate to. */
  collidingObservations: number;
  /** Local microsecond collisions per topic. */
  localCollisions: Record<string, number>;
  /** Server masks whose counts do not decode at the topic's source size. */
  maskSizeMismatches: number;
  /** Frames read from the service (complete snapshots). */
  loadedFrames: number;
  lastSave?: { frames: number; at: number };
};

export type LiveSemanticSegmentationService = SemanticSegmentationService & {
  readonly backend: "live";
  readonly recordName: string;
  /** Presence from ListTimelineRanges for registered frames whose geometry is not loaded. */
  timelineSummaries: () => Record<string, AnnotationSummary>;
  /** Called after timeline presence changes outside a document read (a camera registered later). */
  subscribeTimeline: (listener: () => void) => () => void;
  diagnostics: () => LiveServiceDiagnostics;
};

/** gRPC status as a short user-facing message, e.g. "FAILED_PRECONDITION: …". */
export function describeRpcError(error: unknown): string {
  if (error instanceof ConnectError) {
    return `${Code[error.code]}: ${error.rawMessage}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function idOf(resourceName: string): string {
  const id = resourceName.slice(resourceName.lastIndexOf("/") + 1);
  if (id.length === 0) {
    throw new Error(`Invalid resource name ${resourceName}`);
  }
  return id;
}

function sizeOf(video: SegmentationVideo): { width: number; height: number } {
  if (
    video.width == undefined ||
    video.height == undefined ||
    video.width <= 0 ||
    video.height <= 0
  ) {
    // Masks and pixel polygons cannot be bound without the decoded source size; never guess.
    throw new Error(
      `${video.topic ?? video.id} 的源图尺寸未知：等这一路相机解码出第一帧后再读取或保存`,
    );
  }
  return { width: video.width, height: video.height };
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }
}

/**
 * Adapter from the editor's service boundary to the published AnnotationService
 * (cosceneapis PR #866). The backend keeps only current state, with no revisions or version
 * checks. Saves from other tabs or users simply overwrite the frames they send (see the
 * integration report).
 */
export function createLiveAnnotationService(options: {
  client: AnnotationClient;
  /** `warehouses/{w}/projects/{p}/records/{r}` */
  recordName: string;
  /** Recording start; frame windows are offsets from it. */
  startNs: bigint;
  /** Source metadata (record id, videos, frames) known when the session opens. */
  document: SegmentationDocument;
  models?: string[];
}): LiveSemanticSegmentationService {
  const { client, recordName, startNs } = options;
  const models = options.models ?? LIVE_PROPAGATION_MODELS;
  let doc: SegmentationDocument = {
    ...cloneSegmentation(options.document),
    classes: [],
    instances: [],
    annotations: {},
    annotationSummaries: {},
  };
  /** Frames whose complete server snapshot is in `doc.annotations`. */
  const loadedFrames = new Set<string>();
  /** `occluded` has no editor field; keep the server value so a save does not reset it. */
  const occluded = new Map<string, boolean>();
  /**
   * Server observations the editor cannot show (`doc.unreadableObservations`), as read. A frame
   * snapshot replaces the whole frame, so they are re-sent verbatim until the user replaces or
   * clears that instance on that frame.
   */
  const opaqueWires = new Map<string, WireFrame>();
  const indexes = new Map<string, FrameTimeIndex>();
  const ranges = new Map<string, WireTimelineRange[]>();
  let summaries: Record<string, AnnotationSummary> = {};
  const timelineListeners = new Set<() => void>();
  /** Topics whose timeline was requested, so a later camera registration reads only its own. */
  const timelineTopics = new Set<string>();
  const diagnostics: LiveServiceDiagnostics = {
    recordName,
    timelineErrors: {},
    unregisteredObservations: 0,
    collidingObservations: 0,
    localCollisions: {},
    maskSizeMismatches: 0,
    loadedFrames: 0,
  };

  const classResource = (id: string) => `${recordName}/classes/${id}`;
  const instanceResource = (id: string) => `${recordName}/instances/${id}`;

  function requireUuid(id: string, kind: string): string {
    if (!isUuid(id)) {
      throw new Error(`${kind} ${id} 不是 UUID，不能作为正式服务的资源 ID`);
    }
    return id;
  }

  function indexOf(videoId: string): FrameTimeIndex {
    let index = indexes.get(videoId);
    if (!index) {
      index = new FrameTimeIndex();
      indexes.set(videoId, index);
    }
    return index;
  }

  function reindex(): void {
    for (const frame of doc.frames) {
      indexOf(frame.videoId).add(frame);
    }
    for (const video of doc.videos) {
      const count = indexes.get(video.id)?.collisionCount() ?? 0;
      if (count > 0) {
        diagnostics.localCollisions[video.topic ?? video.id] = count;
      }
    }
  }
  reindex();

  function videoOf(videoId: string): SegmentationVideo & { topic: string } {
    const video = doc.videos.find((item) => item.id === videoId);
    if (!video?.topic) {
      throw new Error(`Video ${videoId} has no topic`);
    }
    return video as SegmentationVideo & { topic: string };
  }

  /** Summaries from timeline ranges, for registered frames whose geometry is not loaded. */
  function rebuildSummaries(): void {
    const next: Record<string, AnnotationSummary> = {};
    for (const video of doc.videos) {
      const videoRanges = ranges.get(video.id);
      if (!videoRanges || videoRanges.length === 0) {
        continue;
      }
      const frames = doc.frames
        .filter((frame) => frame.videoId === video.id && !loadedFrames.has(frame.id))
        .map((frame) => ({ id: frame.id, micros: truncateToMicros(frame.logTimeNs) }));
      for (const range of videoRanges) {
        if (!range.startTime || !range.endTime) {
          continue;
        }
        const from = timestampToMicros(range.startTime);
        const to = timestampToMicros(range.endTime);
        const instanceId = idOf(range.instance);
        for (const frame of frames) {
          if (frame.micros >= from && frame.micros <= to) {
            next[frameInstanceKey(frame.id, instanceId)] = {
              polygonCount: 0,
              pointCount: 0,
              fromTimeline: true,
            };
          }
        }
      }
    }
    summaries = next;
  }

  async function listAll<T>(
    page: (token: string) => Promise<{ items: T[]; next: string }>,
  ): Promise<T[]> {
    const items: T[] = [];
    let token = "";
    do {
      const result = await page(token);
      items.push(...result.items);
      token = result.next;
    } while (token.length > 0);
    return items;
  }

  async function refreshTimeline(
    signal?: AbortSignal,
    topics: "all" | "unread" = "all",
  ): Promise<void> {
    await Promise.all(
      doc.videos
        .filter(
          (video) =>
            video.topic != undefined &&
            video.topic !== "" &&
            !(topics === "unread" && timelineTopics.has(video.topic)),
        )
        .map(async (video) => {
          timelineTopics.add(video.topic!);
          const topic = video.topic!;
          try {
            const items = await listAll(async (pageToken) => {
              const response = await client.listTimelineRanges(
                { parent: recordName, topic, pageSize: PAGE_SIZE, pageToken },
                { signal },
              );
              return { items: response.timelineRanges, next: response.nextPageToken };
            });
            ranges.set(video.id, items);
            delete diagnostics.timelineErrors[topic];
          } catch (error) {
            throwIfAborted(signal);
            // The catalog stays usable without a timeline; the error is shown, not hidden.
            ranges.delete(video.id);
            diagnostics.timelineErrors[topic] = describeRpcError(error);
          }
        }),
    );
    rebuildSummaries();
  }

  /** A wire observation as editor geometry, or why the editor cannot show it. */
  function toObservation(
    wire: WireFrame,
    video: SegmentationVideo & { topic: string },
    size: { width: number; height: number },
    frameId: string,
  ): FrameInstance | { unreadable: string } {
    const instanceId = idOf(wire.instance);
    if (wire.geometry.case === "mask") {
      try {
        maskRunsFromCounts(wire.geometry.value.counts, size.width, size.height);
      } catch (error) {
        diagnostics.maskSizeMismatches++;
        return {
          unreadable: `mask 与 ${video.topic} 的源图尺寸 ${size.width}×${size.height} 不符（${
            error instanceof Error ? error.message : String(error)
          }）`,
        };
      }
      const observation = maskObservation(frameId, instanceId, {
        counts: wire.geometry.value.counts,
        width: size.width,
        height: size.height,
      });
      return observation ?? { unreadable: "mask 没有前景像素" };
    }
    if (wire.geometry.case === "polygons") {
      const observation = polygonObservation(
        frameId,
        instanceId,
        wire.geometry.value.polygons.map((polygon) => ({
          id: polygon.id,
          topic: video.topic,
          points: polygon.points.map((point) => ({
            x: point.x / size.width,
            y: point.y / size.height,
          })),
        })),
      );
      return observation ?? { unreadable: "多边形少于 3 个顶点" };
    }
    return { unreadable: "观测没有几何" };
  }

  /** Reads `[fromMicros, toMicros)` of one topic and makes it the complete state of those frames. */
  async function readRange(
    videoId: string,
    fromMicros: bigint,
    toMicros: bigint,
    signal?: AbortSignal,
  ): Promise<{
    annotations: Record<string, FrameInstance>;
    unreadable: Record<string, UnreadableObservation>;
  }> {
    const video = videoOf(videoId);
    const wireFrames: WireFrame[] = [];
    for (let start = fromMicros; start < toMicros; start += MAX_WINDOW_MICROS) {
      const end = start + MAX_WINDOW_MICROS < toMicros ? start + MAX_WINDOW_MICROS : toMicros;
      wireFrames.push(
        ...(await listAll(async (pageToken) => {
          const response = await client.listFrames(
            {
              parent: recordName,
              topic: video.topic,
              startTime: microsToTimestamp(start),
              endTime: microsToTimestamp(end),
              pageSize: PAGE_SIZE,
              pageToken,
            },
            { signal },
          );
          return { items: response.frames, next: response.nextPageToken };
        })),
      );
    }
    throwIfAborted(signal);
    const index = indexOf(videoId);
    const annotations: Record<string, FrameInstance> = {};
    const unreadable: Record<string, UnreadableObservation> = {};
    const unreadableWires = new Map<string, WireFrame>();
    const size = wireFrames.length > 0 ? sizeOf(video) : undefined;
    for (const wire of wireFrames) {
      if (!wire.frameTime) {
        continue;
      }
      const resolved = index.resolve(timestampToMicros(wire.frameTime));
      if ("missing" in resolved) {
        if (resolved.missing === "collision") {
          diagnostics.collidingObservations++;
        } else {
          diagnostics.unregisteredObservations++;
        }
        continue;
      }
      const observation = toObservation(wire, video, size!, resolved.frameId);
      const instanceId = idOf(wire.instance);
      const key = frameInstanceKey(resolved.frameId, instanceId);
      occluded.set(key, wire.occluded);
      if ("unreadable" in observation) {
        unreadable[key] = { frameId: resolved.frameId, instanceId, reason: observation.unreadable };
        unreadableWires.set(key, wire);
      } else {
        annotations[key] = observation;
      }
    }
    // The read is the complete state of every registered frame in the range.
    const covered = new Set(
      doc.frames
        .filter((frame) => {
          if (frame.videoId !== videoId) {
            return false;
          }
          const micros = truncateToMicros(frame.logTimeNs);
          return micros >= fromMicros && micros < toMicros;
        })
        .map((frame) => frame.id),
    );
    for (const [key, annotation] of Object.entries(doc.annotations)) {
      if (covered.has(annotation.frameId)) {
        delete doc.annotations[key];
      }
    }
    Object.assign(doc.annotations, cloneSegmentation(annotations));
    const keptUnreadable = Object.entries(doc.unreadableObservations ?? {}).filter(
      ([key, item]) => {
        if (covered.has(item.frameId)) {
          opaqueWires.delete(key);
          return false;
        }
        return true;
      },
    );
    for (const [key, wire] of unreadableWires) {
      opaqueWires.set(key, wire);
    }
    const nextUnreadable = { ...Object.fromEntries(keptUnreadable), ...unreadable };
    if (Object.keys(nextUnreadable).length > 0) {
      doc.unreadableObservations = nextUnreadable;
    } else {
      delete doc.unreadableObservations;
    }
    for (const id of covered) {
      loadedFrames.add(id);
    }
    diagnostics.loadedFrames = loadedFrames.size;
    return { annotations, unreadable };
  }

  async function ensureFramesLoaded(frameIds: Iterable<string>): Promise<void> {
    for (const frameId of frameIds) {
      if (loadedFrames.has(frameId)) {
        continue;
      }
      const frame = doc.frames.find((item) => item.id === frameId);
      if (!frame) {
        throw new Error(`Frame ${frameId} is not in the media index`);
      }
      const micros = indexOf(frame.videoId).frameTimeOf(frame.id);
      await readRange(frame.videoId, micros, micros + 1n);
    }
  }

  function wirePolygons(
    polygons: SegmentationPolygon[],
    instanceName: string,
    size: { width: number; height: number },
    topic: string,
  ) {
    return polygons
      .filter((polygon) => {
        if (polygon.topic != undefined && polygon.topic !== topic) {
          throw new Error(`Polygon ${polygon.id} belongs to ${polygon.topic}, not ${topic}`);
        }
        // An in-progress polygon stays a local draft (the contract rejects < 3 vertices).
        return polygon.points.length >= 3;
      })
      .map((polygon, index) => {
        const points = polygon.points
          .map((point) => {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
              throw new Error("Annotation coordinate must be finite");
            }
            return {
              x: clamp(point.x * size.width, size.width),
              y: clamp(point.y * size.height, size.height),
            };
          })
          // A vertex clicked twice, or two vertices clamped onto the same frame edge point, is
          // the same outline with one vertex fewer; the contract rejects the repeat.
          .filter((point, i, all) => {
            const next = all[(i + 1) % all.length]!;
            return all.length === 1 || point.x !== next.x || point.y !== next.y;
          });
        // Check what AnnotationGeometry checks before any request, so a bad polygon is named
        // here instead of failing the whole save or propagation with INVALID_ARGUMENT.
        const violation = polygonViolation(points);
        if (violation) {
          throw new Error(
            `${topic} 上第 ${index + 1} 个多边形不符合标注契约（${describeViolation(violation)}），` +
              `请修改该多边形的顶点后重试。服务端规则：${violation}`,
          );
        }
        return { id: polygonWireId(recordName, instanceName, polygon.id), points };
      });
  }

  /**
   * One observation on the wire. Checks everything AnnotationGeometry checks and what it does not
   * (mask pixel total, coordinates within the frame), so a bad observation is named here instead
   * of failing the whole save, or being stored and later unreadable.
   */
  function wireObservation(
    annotation: { instanceId: string; frameId: string } & ObservationGeometry,
    topic: string,
    size: { width: number; height: number },
    frameTime: { seconds: bigint; nanos: number },
  ): WireFrameInit {
    const instance = instanceResource(requireUuid(annotation.instanceId, "Instance"));
    const occludedValue =
      occluded.get(frameInstanceKey(annotation.frameId, annotation.instanceId)) ?? false;
    if (annotation.kind === "mask") {
      const { mask } = annotation;
      if (mask.width !== size.width || mask.height !== size.height) {
        throw new Error(
          `Mask is bound to ${mask.width}×${mask.height}, but ${topic} decodes at ${size.width}×${size.height}`,
        );
      }
      // Throws unless the counts cover exactly width × height (the backend does not check this).
      if (maskRunsFromCounts(mask.counts, size.width, size.height).area === 0) {
        throw new Error(`${topic} 上的 mask 没有前景像素，不能保存`);
      }
      return {
        instance,
        frameTime,
        occluded: occludedValue,
        geometry: { case: "mask" as const, value: { counts: mask.counts } },
      };
    }
    const polygons = wirePolygons(annotation.polygons, instance, size, topic);
    if (polygons.length === 0) {
      throw new Error(`${topic} 上的多边形观测没有完整的多边形，不能保存`);
    }
    return {
      instance,
      frameTime,
      occluded: occludedValue,
      geometry: { case: "polygons" as const, value: { polygons } },
    };
  }

  function snapshotsFor(candidate: SegmentationDocument, frameIds: Set<string>) {
    const byFrame = new Map<string, FrameInstance[]>();
    for (const annotation of Object.values(candidate.annotations)) {
      if (frameIds.has(annotation.frameId) && observationHasGeometry(annotation)) {
        const list = byFrame.get(annotation.frameId) ?? [];
        list.push(annotation);
        byFrame.set(annotation.frameId, list);
      }
    }
    const framesById = new Map(candidate.frames.map((frame) => [frame.id, frame]));
    const snapshots: WireFrameSnapshotInit[] = [];
    for (const frameId of frameIds) {
      const frame = framesById.get(frameId);
      if (!frame) {
        throw new Error(`Frame ${frameId} is not in the media index`);
      }
      const video = videoOf(frame.videoId);
      const frameTime = microsToTimestamp(indexOf(frame.videoId).frameTimeOf(frameId));
      const observations: WireFrameInit[] = (byFrame.get(frameId) ?? [])
        .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
        .map((annotation) => wireObservation(annotation, video.topic, sizeOf(video), frameTime));
      // What the editor could not read is still on the server: keep it, untouched.
      for (const [key, unreadable] of Object.entries(candidate.unreadableObservations ?? {})) {
        const wire = opaqueWires.get(key);
        if (unreadable.frameId === frameId && wire && !(key in candidate.annotations)) {
          observations.push(wire);
        }
      }
      snapshots.push({ topic: video.topic, frameTime, annotations: observations });
    }
    return snapshots;
  }

  async function createOrConverge(
    create: () => Promise<unknown>,
    update: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await create();
    } catch (error) {
      // A lost response may have created it; the contract says confirm and continue, never replay blindly.
      if (error instanceof ConnectError && error.code === Code.AlreadyExists) {
        await update();
        return;
      }
      throw error;
    }
  }

  async function deleteIfPresent(remove: () => Promise<unknown>): Promise<void> {
    try {
      await remove();
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return;
      }
      throw error;
    }
  }

  async function syncCatalog(candidate: SegmentationDocument): Promise<{
    removedInstances: SegmentationInstance[];
    removedClasses: SegmentationClass[];
  }> {
    const classesBefore = new Map(doc.classes.map((item) => [item.id, item]));
    const instancesBefore = new Map(doc.instances.map((item) => [item.id, item]));
    for (const item of candidate.classes) {
      const before = classesBefore.get(item.id);
      const name = classResource(requireUuid(item.id, "Class"));
      const updateAll = async () =>
        await client.updateClass({
          class: { name, displayName: item.name, color: item.color },
          updateMask: { paths: ["display_name", "color"] },
        });
      if (!before) {
        await createOrConverge(
          async () =>
            await client.createClass({
              parent: recordName,
              classId: item.id,
              class: { displayName: item.name, color: item.color },
            }),
          updateAll,
        );
        doc.classes = [...doc.classes, cloneSegmentation(item)];
      } else if (before.name !== item.name || before.color !== item.color) {
        const paths = [
          ...(before.name !== item.name ? ["display_name"] : []),
          ...(before.color !== item.color ? ["color"] : []),
        ];
        await client.updateClass({
          class: { name, displayName: item.name, color: item.color },
          updateMask: { paths },
        });
        doc.classes = doc.classes.map((entry) =>
          entry.id === item.id ? cloneSegmentation(item) : entry,
        );
      }
    }
    for (const item of candidate.instances) {
      const before = instancesBefore.get(item.id);
      const name = instanceResource(requireUuid(item.id, "Instance"));
      const className = classResource(item.classId);
      const updateAll = async () =>
        await client.updateInstance({
          instance: { name, class: className, displayName: item.name },
          updateMask: { paths: ["display_name", "class"] },
        });
      if (!before) {
        await createOrConverge(
          async () =>
            await client.createInstance({
              parent: recordName,
              instanceId: item.id,
              instance: { class: className, displayName: item.name },
            }),
          updateAll,
        );
        doc.instances = [...doc.instances, cloneSegmentation(item)];
      } else if (before.name !== item.name || before.classId !== item.classId) {
        const paths = [
          ...(before.name !== item.name ? ["display_name"] : []),
          ...(before.classId !== item.classId ? ["class"] : []),
        ];
        await client.updateInstance({
          instance: { name, class: className, displayName: item.name },
          updateMask: { paths },
        });
        doc.instances = doc.instances.map((entry) =>
          entry.id === item.id ? cloneSegmentation(item) : entry,
        );
      }
    }
    const keptClasses = new Set(candidate.classes.map((item) => item.id));
    const keptInstances = new Set(candidate.instances.map((item) => item.id));
    return {
      removedClasses: doc.classes.filter((item) => !keptClasses.has(item.id)),
      removedInstances: doc.instances.filter((item) => !keptInstances.has(item.id)),
    };
  }

  const service: LiveSemanticSegmentationService = {
    backend: "live",
    recordName,
    timelineSummaries: () => summaries,
    diagnostics: () => cloneSegmentation(diagnostics),
    supportsPropagationContext: true,
    supportsMultiInstanceSeeds: true,
    getPropagationCapabilities: async () => await Promise.resolve({ models: [...models] }),
    // Cancelling the RPC (the abort signal passed to `propagate`) is the STOP; there is no task to ack.
    cancelPropagation: async (context) =>
      await Promise.resolve({ requestId: context.requestId, status: "cancelled" as const }),
    subscribeTimeline: (listener) => {
      timelineListeners.add(listener);
      return () => {
        timelineListeners.delete(listener);
      };
    },
    updateSourceMetadata(metadata) {
      doc = mergeSourceMetadata(doc, metadata);
      reindex();
      rebuildSummaries();
      // Another camera joined after the document read: read its timeline once.
      if (
        doc.videos.some(
          (video) =>
            video.topic != undefined && video.topic !== "" && !timelineTopics.has(video.topic),
        )
      ) {
        void refreshTimeline(undefined, "unread").then(() => {
          for (const listener of timelineListeners) {
            listener();
          }
        });
      } else {
        for (const listener of timelineListeners) {
          listener();
        }
      }
    },
    async loadDocument(signal) {
      const [classes, instances] = await Promise.all([
        listAll(async (pageToken) => {
          const response = await client.listClasses(
            { parent: recordName, pageSize: PAGE_SIZE, pageToken },
            { signal },
          );
          return { items: response.classes, next: response.nextPageToken };
        }),
        listAll(async (pageToken) => {
          const response = await client.listInstances(
            { parent: recordName, pageSize: PAGE_SIZE, pageToken },
            { signal },
          );
          return { items: response.instances, next: response.nextPageToken };
        }),
      ]);
      doc.classes = classes.map((item) => ({
        id: idOf(item.name),
        name: item.displayName,
        color: item.color,
      }));
      doc.instances = instances.map((item) => ({
        id: idOf(item.name),
        classId: idOf(item.class),
        name: item.displayName,
      }));
      // A fresh document read starts geometry over: windows are re-read from the service.
      doc.annotations = {};
      delete doc.unreadableObservations;
      loadedFrames.clear();
      occluded.clear();
      opaqueWires.clear();
      await refreshTimeline(signal);
      return {
        ...cloneSegmentation(doc),
        annotations: {},
        annotationSummaries: { ...summaries },
      };
    },
    async loadFrameWindow(videoId, startSec, endSec, signal): Promise<FrameWindow> {
      validateFrameWindow(startSec, endSec);
      // The local window is inclusive of `endSec`; the wire window is [start, end).
      const from = windowBoundaryMicros(startNs, startSec);
      const to = windowBoundaryMicros(startNs, endSec) + 1n;
      const { annotations, unreadable } = await readRange(videoId, from, to, signal);
      rebuildSummaries();
      return {
        videoId,
        startSec,
        endSec,
        annotations: cloneSegmentation(annotations),
        ...(Object.keys(unreadable).length > 0
          ? { unreadable: cloneSegmentation(unreadable) }
          : {}),
      };
    },
    async submit(request): Promise<SubmitResult> {
      // A merge must save the source's frames on every topic of the record before DeleteInstance
      // cascades. The annotation API cannot list a record's topics and this session only knows the
      // open cameras, so a merge here could silently drop the source's other cameras. Refuse it.
      if (
        request.operations.some(
          (operation) => Object.keys(operation.patch.instanceMerges ?? {}).length > 0,
        )
      ) {
        throw new Error(
          "正式服务暂不支持合并实例：只能看到当前布局打开的相机，删除源实例会连带删掉它在其他相机上的标注",
        );
      }
      // 1. Every frame we send is a complete snapshot, so its server state must be loaded first.
      let staged = doc;
      const touchedKeys = new Set<string>();
      for (const operation of request.operations) {
        for (const key of patchAnnotationKeys(staged, operation.patch)) {
          touchedKeys.add(key);
        }
        staged = applySegmentationPatches(staged, [operation.patch]);
      }
      const surviving = new Set(staged.instances.map((item) => item.id));
      const touchedFrames = new Set<string>();
      for (const key of touchedKeys) {
        const [frameId, instanceId] = JSON.parse(key) as [string, string];
        // Deleting an instance removes its observations on the server (DeleteInstance cascades);
        // those frames are not re-sent, so unloaded frames are never overwritten.
        if (surviving.has(instanceId)) {
          touchedFrames.add(frameId);
        }
      }
      await ensureFramesLoaded(touchedFrames);
      const candidate = applySegmentationPatches(
        doc,
        request.operations.map((operation) => operation.patch),
      );
      // Validate the whole save before the first write.
      const snapshots = snapshotsFor(candidate, touchedFrames);
      // 2. Catalog first: frames may only reference existing instances.
      const { removedClasses, removedInstances } = await syncCatalog(candidate);
      // 3. One atomic save of every changed frame.
      if (snapshots.length > 0) {
        await client.saveAnnotation({ record: recordName, frames: snapshots });
        for (const frameId of touchedFrames) {
          for (const [key, annotation] of Object.entries(doc.annotations)) {
            if (annotation.frameId === frameId) {
              delete doc.annotations[key];
            }
          }
          for (const [key, annotation] of Object.entries(candidate.annotations)) {
            if (annotation.frameId === frameId && observationHasGeometry(annotation)) {
              doc.annotations[key] = cloneSegmentation(annotation);
            }
          }
        }
        diagnostics.lastSave = { frames: snapshots.length, at: Date.now() };
      }
      // 4. Deletes last. A class whose instances all go is removed atomically with force.
      const removedClassIds = new Set(removedClasses.map((item) => item.id));
      for (const item of removedInstances) {
        if (removedClassIds.has(item.classId)) {
          continue;
        }
        await deleteIfPresent(
          async () => await client.deleteInstance({ name: instanceResource(item.id) }),
        );
        doc.instances = doc.instances.filter((entry) => entry.id !== item.id);
      }
      for (const item of removedClasses) {
        const remaining = doc.instances.filter(
          (entry) => entry.classId === item.id && surviving.has(entry.id),
        );
        if (remaining.length > 0) {
          throw new Error(`类别 ${item.name} 仍有实例，不能删除`);
        }
        await deleteIfPresent(
          async () => await client.deleteClass({ name: classResource(item.id), force: true }),
        );
        doc.classes = doc.classes.filter((entry) => entry.id !== item.id);
        doc.instances = doc.instances.filter((entry) => entry.classId !== item.id);
      }
      doc = {
        ...candidate,
        classes: doc.classes,
        instances: doc.instances,
        annotations: Object.fromEntries(
          Object.entries(candidate.annotations).filter(([, annotation]) =>
            surviving.has(annotation.instanceId),
          ),
        ),
      };
      // Superseded or cascaded-away unreadable observations are gone from the server too.
      for (const key of opaqueWires.keys()) {
        if (!(key in (doc.unreadableObservations ?? {}))) {
          opaqueWires.delete(key);
        }
      }
      // Timeline presence changed with the save; refresh it for unloaded frames.
      await refreshTimeline();
      return {
        document: {
          ...cloneSegmentation(doc),
          annotationSummaries: { ...doc.annotationSummaries },
        },
      };
    },
    async *propagate(request, signal): AsyncIterable<PropagationResult> {
      const source = doc.frames.find((frame) => frame.id === request.fromFrameId);
      if (!source) {
        throw new Error("Unknown source frame");
      }
      const video = videoOf(source.videoId);
      const size = sizeOf(video);
      const index = indexOf(source.videoId);
      const seedMicros = index.frameTimeOf(source.id);
      const endMicros = truncateToMicros(request.endTimeNs);
      if (endMicros <= seedMicros) {
        throw new Error("End time must be later than the seed frame");
      }
      const seeds =
        request.seeds ??
        resolvePropagationSeeds(
          request,
          doc.annotations[frameInstanceKey(source.id, request.instanceId)],
        );
      const frameTime = microsToTimestamp(seedMicros);
      const wireSeeds = seeds.map((seed) =>
        wireObservation({ ...seed, frameId: source.id }, video.topic, size, frameTime),
      );
      const instanceIds = seeds.map((seed) => seed.instanceId);
      const stream = client.propagateAnnotation(
        {
          record: recordName,
          propagation: {
            topic: video.topic,
            seeds: wireSeeds,
            endTime: microsToTimestamp(endMicros),
            model: request.model ?? models[0]!,
          },
        },
        { signal },
      );
      let finished = false;
      for await (const response of stream) {
        const event = response.event;
        if (event.case === "frame") {
          const micros = event.value.frameTime
            ? timestampToMicros(event.value.frameTime)
            : undefined;
          const resolved = micros == undefined ? undefined : index.resolve(micros);
          if (!resolved || "missing" in resolved) {
            if (resolved?.missing === "collision") {
              diagnostics.collidingObservations++;
            } else {
              diagnostics.unregisteredObservations++;
            }
            continue;
          }
          const byInstance = new Map(
            event.value.annotations.map((wire) => [idOf(wire.instance), wire]),
          );
          // A frame event replaces every selected instance: an omitted one is cleared.
          for (const instanceId of instanceIds) {
            const wire = byInstance.get(instanceId);
            const decoded = wire ? toObservation(wire, video, size, resolved.frameId) : undefined;
            // Propagation output must decode at the source size; anything else clears the draft.
            const observation: PropagationResult =
              decoded && !("unreadable" in decoded)
                ? decoded
                : { frameId: resolved.frameId, instanceId, kind: "empty" };
            if (observation.kind === "mask") {
              observation.mask.source = "propagation";
            }
            yield {
              ...observation,
              ...(request.context ? { context: cloneSegmentation(request.context) } : {}),
            };
          }
        } else if (event.case === "error") {
          throw new Error(`传播失败（gRPC ${event.value.code}）：${event.value.message}`);
        } else if (event.case === "done") {
          finished = true;
          break;
        }
      }
      if (!finished) {
        throwIfAborted(signal);
        // Received frames stay drafts; without `done` the run is not a complete success.
        throw new Error(`传播连接在完成前断开（${microsToIso(seedMicros)} 之后）`);
      }
    },
  };
  return service;
}
