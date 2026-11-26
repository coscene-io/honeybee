// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, type Client } from "@connectrpc/connect";

import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import {
  PropagateAnnotationRequest_PropagateAnnotation_Direction as PropagationDirection,
  AnnotationService,
  type Frame as WireFrame,
  type FrameSchema,
  type FrameSnapshotSchema,
  type ListTimelineRangesResponse_TimelineRange as WireTimelineRange,
} from "@foxglove/studio-base/services/api/spatial-annotation";
import { expectingCodes } from "@foxglove/studio-base/util/coscene/rpcContext";

import {
  AnnotationRpcError,
  SegmentationError,
  segmentationErrorText,
  segmentationText,
} from "./errors";
import {
  FrameTimeIndex,
  microsToIso,
  microsToTimestamp,
  truncateToMicros,
  windowBoundaryMicros,
  wireFrameTimeMicros,
} from "./frameTime";
import { frameOfKey, mergeFrameWindow } from "./frameWindows";
import { inferMaskFrameSize, maskCountsCoverage, maskRunsFromCounts } from "./maskCodec";
import {
  maskObservation,
  observationHasGeometry,
  polygonObservation,
  summarizeObservation,
} from "./maskGeometry";
import { describeViolation, toContractPolygon } from "./polygonContract";
import { quickSegment } from "./quickSegment";
import { isSegmentationRecordName } from "./recordName";
import { SEGMENTATION_WINDOW_SEC } from "./segmentationWindow";
import {
  applySegmentationPatches,
  cloneSegmentation,
  frameInstanceKey,
  mergeSourceMetadata,
  patchAnnotationKeys,
  resolvePropagationSeeds,
  type SegmentationService,
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
const MAX_WINDOW_MICROS = BigInt(SEGMENTATION_WINDOW_SEC) * 1_000_000n;
const PAGE_SIZE = 1000;
/** 1000 pages of 1000: far beyond any record; only a misbehaving server reaches it. */
const MAX_PAGES = 1000;
/**
 * Models the backend accepts for mask/polygon seeds: it rejects anything but sam2.1-motion with
 * INVALID_ARGUMENT, and sam3.1 from the contract example is not deployed.
 */
const LIVE_PROPAGATION_MODELS = ["sam2.1-motion"];

export type LiveServiceDiagnostics = {
  recordName: string;
  /** Last ListTimelineRanges failure per topic (the tree then has no unloaded presence). */
  timelineErrors: Record<string, string>;
  /** Server observations whose frame_time matched no registered local frame. */
  unregisteredObservations: number;
  /** Server observations on a frame_time that two local frames truncate to. */
  collidingObservations: number;
  /** Server observations or propagation frames whose time is missing or not microsecond aligned. */
  misalignedTimes: number;
  /** Timeline ranges (in the current timeline) whose bounds are missing or not microsecond aligned. */
  misalignedRanges: number;
  /** Local microsecond collisions per topic. */
  localCollisions: Record<string, number>;
  /** Server masks whose counts do not decode at the topic's source size. */
  maskSizeMismatches: number;
  /** Frames read from the service (complete snapshots). */
  loadedFrames: number;
  lastSave?: { frames: number; at: number };
};

export type LiveSegmentationService = SegmentationService & {
  readonly backend: "live";
  readonly recordName: string;
  /** Presence from ListTimelineRanges for registered frames whose geometry is not loaded. */
  timelineSummaries: () => Record<string, AnnotationSummary>;
  /** Called after timeline presence changes outside a document read (a camera registered later). */
  subscribeTimeline: (listener: () => void) => () => void;
  diagnostics: () => LiveServiceDiagnostics;
  /**
   * Why some cameras show no annotation presence on frames whose geometry is not loaded yet, or
   * undefined. Stable between changes; `subscribeTimeline` fires when it changes.
   */
  timelineWarning: () => string | undefined;
};

export { AnnotationRpcError } from "./errors";

/** `Code.FailedPrecondition` (9) → `FAILED_PRECONDITION`; unknown numbers stay numeric. */
export function rpcCodeName(code: number): string {
  const name = (Code as unknown as Record<number, string | undefined>)[code];
  return name == undefined ? String(code) : name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
}

/**
 * A ConnectError as an AnnotationRpcError; anything else (including cancellation, which callers
 * detect through their abort signal) unchanged.
 */
function toRpcError(error: unknown): unknown {
  if (error instanceof ConnectError && error.code !== Code.Canceled) {
    return new AnnotationRpcError(rpcCodeName(error.code), describeRpcError(error), {
      cause: error,
      detail: error.rawMessage,
    });
  }
  return error;
}

/** gRPC status as a short user-facing message, e.g. "FAILED_PRECONDITION: …". */
function describeRpcError(error: unknown): string {
  if (error instanceof ConnectError) {
    return `${rpcCodeName(error.code)}: ${error.rawMessage}`;
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
    throw new SegmentationError("errorSourceSizeUnknownForTopic", {
      topic: video.topic ?? video.id,
    });
  }
  return { width: video.width, height: video.height };
}

/** Index of the first frame at or after `micros` in frames sorted by time. */
function lowerBound(frames: readonly { micros: bigint }[], micros: bigint): number {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (frames[mid]!.micros < micros) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }
}

/**
 * Adapter from the editor's service boundary to the AnnotationService
 * (coscene.dataplatform.v1alpha3). The backend keeps only current state, with no revisions or version
 * checks. Saves from other tabs or users simply overwrite the frames they send (see
 * docs/segmentation-api-integration.md).
 */
export function createSegmentationServiceForClient(options: {
  client: AnnotationClient;
  /** `warehouses/{w}/projects/{p}/records/{r}` */
  recordName: string;
  /** Recording start; frame windows are offsets from it. */
  startNs: bigint;
  /** Source metadata (record id, videos, frames) known when the session opens. */
  document: SegmentationDocument;
  models?: string[];
}): LiveSegmentationService {
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
  /**
   * Bumped by every save. A read that started before a save must not replace what that save wrote
   * (or bring back an instance it deleted): the server answered from the state before it.
   */
  let saveEpoch = 0;
  const frameSavedAt = new Map<string, number>();
  const instanceDeletedAt = new Map<string, number>();
  const ranges = new Map<string, WireTimelineRange[]>();
  let summaries: Record<string, AnnotationSummary> = {};
  const timelineListeners = new Set<() => void>();
  /** Per topic, the latest timeline request; an older answer arriving later is dropped. */
  const timelineGeneration = new Map<string, number>();
  /** Aborts reads this service starts on its own (a camera registered later); see dispose(). */
  const background = new AbortController();
  let timelineWarning: string | undefined;
  const notifyTimeline = () => {
    for (const listener of timelineListeners) {
      listener();
    }
  };
  /** Topics whose timeline was requested, so a later camera registration reads only its own. */
  const timelineTopics = new Set<string>();
  const diagnostics: LiveServiceDiagnostics = {
    recordName,
    timelineErrors: {},
    unregisteredObservations: 0,
    collidingObservations: 0,
    misalignedTimes: 0,
    misalignedRanges: 0,
    localCollisions: {},
    maskSizeMismatches: 0,
    loadedFrames: 0,
  };

  const classResource = (id: string) => `${recordName}/classes/${id}`;
  const instanceResource = (id: string) => `${recordName}/instances/${id}`;

  function requireUuid(id: string, kind: string): string {
    if (!isUuid(id)) {
      throw new SegmentationError("errorNotUuid", { kind, id });
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
    const framesByVideo = new Map<string, { id: string; micros: bigint }[]>();
    for (const frame of doc.frames) {
      if (loadedFrames.has(frame.id) || (ranges.get(frame.videoId)?.length ?? 0) === 0) {
        continue;
      }
      const list = framesByVideo.get(frame.videoId) ?? [];
      list.push({ id: frame.id, micros: truncateToMicros(frame.logTimeNs) });
      framesByVideo.set(frame.videoId, list);
    }
    let misaligned = 0;
    for (const [videoId, frames] of framesByVideo) {
      frames.sort((left, right) =>
        left.micros < right.micros ? -1 : left.micros > right.micros ? 1 : 0,
      );
      for (const range of ranges.get(videoId) ?? []) {
        const from = wireFrameTimeMicros(range.startTime);
        const to = wireFrameTimeMicros(range.endTime);
        if (from == undefined || to == undefined) {
          misaligned++;
          continue;
        }
        const instanceId = idOf(range.instance);
        // Frames are sorted: find the first at or after `from`, walk until past `to`.
        for (let i = lowerBound(frames, from); i < frames.length && frames[i]!.micros <= to; i++) {
          next[frameInstanceKey(frames[i]!.id, instanceId)] = {
            polygonCount: 0,
            pointCount: 0,
            fromTimeline: true,
          };
        }
      }
    }
    diagnostics.misalignedRanges = misaligned;
    summaries = next;
  }

  async function listAll<T>(
    page: (token: string) => Promise<{ items: T[]; next: string }>,
  ): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let token = "";
    do {
      // A server that hands back a token it already gave would otherwise loop forever.
      if (seen.size >= MAX_PAGES) {
        throw new Error(`Listing stopped after ${MAX_PAGES} pages`);
      }
      seen.add(token);
      const result = await page(token);
      items.push(...result.items);
      token = result.next;
      if (token.length > 0 && seen.has(token)) {
        throw new Error(`The service repeated page token ${token}`);
      }
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
          const generation = (timelineGeneration.get(topic) ?? 0) + 1;
          timelineGeneration.set(topic, generation);
          const current = () => timelineGeneration.get(topic) === generation;
          try {
            const items = await listAll(async (pageToken) => {
              const response = await client.listTimelineRanges(
                { parent: recordName, topic, pageSize: PAGE_SIZE, pageToken },
                { signal },
              );
              return { items: response.timelineRanges, next: response.nextPageToken };
            });
            if (!current()) {
              return;
            }
            ranges.set(video.id, items);
            delete diagnostics.timelineErrors[topic];
          } catch (error) {
            if (!current()) {
              return;
            }
            // Unread again, so the next camera registration retries it.
            timelineTopics.delete(topic);
            throwIfAborted(signal);
            // The catalog stays usable without a timeline; unloaded frames then show no presence
            // until their geometry is read. The error is kept in diagnostics().
            ranges.delete(video.id);
            diagnostics.timelineErrors[topic] = describeRpcError(error);
          }
        }),
    );
    rebuildSummaries();
    const errors = Object.entries(diagnostics.timelineErrors);
    const warning =
      errors.length === 0
        ? undefined
        : errors.map(([topic, error]) => `${topic}: ${error}`).join("; ");
    if (warning !== timelineWarning) {
      timelineWarning = warning;
      notifyTimeline();
    }
  }

  /** The frame size a mask of another size was drawn at; undefined when its counts are malformed. */
  function maskSizeOf(counts: string, size: { width: number; height: number }) {
    try {
      return inferMaskFrameSize(maskCountsCoverage(counts), size.width, size.height);
    } catch {
      return undefined;
    }
  }

  /** A wire observation as editor geometry, or why the editor cannot show it. */
  function toObservation(
    wire: WireFrame,
    video: SegmentationVideo & { topic: string },
    size: { width: number; height: number },
    frameId: string,
  ): FrameInstance | { unreadable: string; noGeometry?: true } {
    const instanceId = idOf(wire.instance);
    if (wire.geometry.case === "mask") {
      try {
        maskRunsFromCounts(wire.geometry.value.counts, size.width, size.height);
      } catch (error) {
        diagnostics.maskSizeMismatches++;
        const madeFor = maskSizeOf(wire.geometry.value.counts, size);
        if (madeFor) {
          // Same topic, another decoded size (e.g. another transcode quality): say which.
          return {
            unreadable: segmentationText("unreadableMaskOtherSize", {
              topic: video.topic,
              maskWidth: madeFor.width,
              maskHeight: madeFor.height,
              width: size.width,
              height: size.height,
            }),
          };
        }
        return {
          unreadable: segmentationText("unreadableMaskSize", {
            topic: video.topic,
            width: size.width,
            height: size.height,
            error: segmentationErrorText(error),
          }),
        };
      }
      const observation = maskObservation(frameId, instanceId, {
        counts: wire.geometry.value.counts,
        width: size.width,
        height: size.height,
      });
      return (
        observation ?? { unreadable: segmentationText("unreadableEmptyMask"), noGeometry: true }
      );
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
      return (
        observation ?? {
          unreadable: segmentationText("unreadableFewVertices"),
          noGeometry: true,
        }
      );
    }
    return { unreadable: segmentationText("unreadableNoGeometry"), noGeometry: true };
  }

  /** Reads `[fromMicros, toMicros)` of one topic and makes it the complete state of those frames. */
  async function readRange(
    videoId: string,
    fromMicros: bigint,
    toMicros: bigint,
    signal?: AbortSignal,
    onlyFrames?: ReadonlySet<string>,
  ): Promise<{
    annotations: Record<string, FrameInstance>;
    unreadable: Record<string, UnreadableObservation>;
  }> {
    const { topic } = videoOf(videoId);
    const startedAt = saveEpoch;
    const changedSince = (frameId: string, instanceId?: string) =>
      (frameSavedAt.get(frameId) ?? 0) > startedAt ||
      (instanceId != undefined && (instanceDeletedAt.get(instanceId) ?? 0) > startedAt);
    const wireFrames: WireFrame[] = [];
    for (let start = fromMicros; start < toMicros; start += MAX_WINDOW_MICROS) {
      const end = start + MAX_WINDOW_MICROS < toMicros ? start + MAX_WINDOW_MICROS : toMicros;
      wireFrames.push(
        ...(await listAll(async (pageToken) => {
          const response = await client.listFrames(
            {
              parent: recordName,
              topic,
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
    const covered = new Set<string>();
    const saved = new Set<string>();
    for (const frame of doc.frames) {
      if (frame.videoId !== videoId || (onlyFrames && !onlyFrames.has(frame.id))) {
        continue;
      }
      const micros = truncateToMicros(frame.logTimeNs);
      if (micros < fromMicros || micros >= toMicros) {
        continue;
      }
      if (changedSince(frame.id)) {
        if (!loadedFrames.has(frame.id)) {
          // The post-save state was evicted while the read was pending.
          return await readRange(videoId, fromMicros, toMicros, signal, onlyFrames);
        }
        saved.add(frame.id);
      } else {
        covered.add(frame.id);
      }
    }
    const video = videoOf(videoId);
    const index = indexOf(videoId);
    const annotations: Record<string, FrameInstance> = {};
    const unreadable: Record<string, UnreadableObservation> = {};
    const unreadableWires = new Map<string, WireFrame>();
    const size = wireFrames.length > 0 ? sizeOf(video) : undefined;
    for (const wire of wireFrames) {
      const wireMicros = wireFrameTimeMicros(wire.frameTime);
      if (wireMicros == undefined) {
        // No local frame can have this time; skip it rather than fail the whole window.
        diagnostics.misalignedTimes++;
        continue;
      }
      const resolved = index.resolve(wireMicros);
      if ("missing" in resolved) {
        if (resolved.missing === "collision") {
          diagnostics.collidingObservations++;
        } else {
          diagnostics.unregisteredObservations++;
        }
        continue;
      }
      const instanceId = idOf(wire.instance);
      if (
        (onlyFrames && !onlyFrames.has(resolved.frameId)) ||
        changedSince(resolved.frameId, instanceId)
      ) {
        continue;
      }
      const observation = toObservation(wire, video, size!, resolved.frameId);
      const key = frameInstanceKey(resolved.frameId, instanceId);
      occluded.set(key, wire.occluded);
      if ("unreadable" in observation) {
        unreadable[key] = { frameId: resolved.frameId, instanceId, reason: observation.unreadable };
        unreadableWires.set(key, wire);
      } else {
        annotations[key] = observation;
      }
    }
    // A frame saved during the read already holds its newer state. Return the whole frame.
    for (const [key, annotation] of Object.entries(doc.annotations)) {
      if (covered.has(annotation.frameId)) {
        delete doc.annotations[key];
      } else if (saved.has(annotation.frameId)) {
        annotations[key] = annotation;
      }
    }
    for (const key of Object.keys(doc.annotationSummaries)) {
      if (covered.has(frameOfKey(key))) {
        delete doc.annotationSummaries[key];
      }
    }
    for (const key of occluded.keys()) {
      if (covered.has(frameOfKey(key)) && !(key in annotations) && !(key in unreadable)) {
        occluded.delete(key);
      }
    }
    for (const [key, annotation] of Object.entries(annotations)) {
      if (covered.has(annotation.frameId)) {
        doc.annotations[key] = cloneSegmentation(annotation);
        doc.annotationSummaries[key] = summarizeObservation(annotation);
      }
    }
    const keptUnreadable = Object.entries(doc.unreadableObservations ?? {}).filter(
      ([key, item]) => {
        if (covered.has(item.frameId)) {
          opaqueWires.delete(key);
          return false;
        }
        if (saved.has(item.frameId)) {
          unreadable[key] = item;
        }
        return true;
      },
    );
    for (const [key, wire] of unreadableWires) {
      opaqueWires.set(key, wire);
    }
    const nextUnreadable = {
      ...Object.fromEntries(keptUnreadable),
      ...Object.fromEntries(
        Object.entries(unreadable).filter(([, item]) => covered.has(item.frameId)),
      ),
    };
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

  /**
   * Forgets the geometry of frames the store no longer holds. A later save of one of them reads
   * it again first (ensureFramesLoaded), so its snapshot is complete. Summaries stay, as the store
   * keeps them for its evicted frames.
   */
  function releaseFrames(frameIds: ReadonlySet<string>, options?: { forgetSummaries: true }): void {
    for (const [key, annotation] of Object.entries(doc.annotations)) {
      if (frameIds.has(annotation.frameId)) {
        delete doc.annotations[key];
      }
    }
    if (doc.unreadableObservations) {
      for (const [key, item] of Object.entries(doc.unreadableObservations)) {
        if (frameIds.has(item.frameId)) {
          delete doc.unreadableObservations[key];
          opaqueWires.delete(key);
        }
      }
      if (Object.keys(doc.unreadableObservations).length === 0) {
        delete doc.unreadableObservations;
      }
    }
    for (const key of occluded.keys()) {
      if (frameIds.has(frameOfKey(key))) {
        occluded.delete(key);
      }
    }
    for (const id of frameIds) {
      loadedFrames.delete(id);
    }
    if (options?.forgetSummaries) {
      for (const key of Object.keys(doc.annotationSummaries)) {
        if (frameIds.has(frameOfKey(key))) {
          delete doc.annotationSummaries[key];
        }
      }
    }
    diagnostics.loadedFrames = loadedFrames.size;
  }

  /**
   * Reads every frame a save will snapshot. Unloaded frames of one camera are read together, in
   * time order, as the fewest ListFrames windows that cover them; cameras are read in parallel.
   */
  async function ensureFramesLoaded(frameIds: Iterable<string>): Promise<void> {
    const framesById = new Map(doc.frames.map((frame) => [frame.id, frame]));
    const byVideo = new Map<string, { frameId: string; micros: bigint }[]>();
    for (const frameId of frameIds) {
      if (loadedFrames.has(frameId)) {
        continue;
      }
      const frame = framesById.get(frameId);
      if (!frame) {
        throw new Error(`Frame ${frameId} is not in the media index`);
      }
      const list = byVideo.get(frame.videoId) ?? [];
      list.push({ frameId, micros: indexOf(frame.videoId).frameTimeOf(frame.id) });
      byVideo.set(frame.videoId, list);
    }
    await Promise.all(
      [...byVideo].map(async ([videoId, frames]) => {
        frames.sort((left, right) =>
          left.micros < right.micros ? -1 : left.micros > right.micros ? 1 : 0,
        );
        for (let i = 0; i < frames.length;) {
          const from = frames[i]!.micros;
          let last = from;
          const requested = new Set<string>();
          // One window holds every frame within MAX_WINDOW_MICROS of the first.
          while (i < frames.length && frames[i]!.micros - from < MAX_WINDOW_MICROS) {
            last = frames[i]!.micros;
            requested.add(frames[i]!.frameId);
            i++;
          }
          await readRange(videoId, from, last + 1n, undefined, requested);
        }
      }),
    );
  }

  function wirePolygons(
    polygons: SegmentationPolygon[],
    instanceName: string,
    size: { width: number; height: number },
    topic: string,
  ) {
    return polygons.map((polygon, index) => {
      if (polygon.topic != undefined && polygon.topic !== topic) {
        throw new Error(`Polygon ${polygon.id} belongs to ${polygon.topic}, not ${topic}`);
      }
      // Drafts never reach the document; a stored polygon below the contract minimum is a bug.
      if (polygon.points.length < 3) {
        throw new Error(
          `Polygon ${polygon.id} has ${polygon.points.length} vertices; a polygon needs at least 3`,
        );
      }
      // Check what AnnotationGeometry checks before any request, so a bad polygon is named
      // here instead of failing the whole save or propagation with INVALID_ARGUMENT.
      const { points, clamped, violation } = toContractPolygon(polygon.points, size);
      if (violation) {
        // A vertex outside the frame is moved onto its edge; say so, since the editor still draws
        // it where it was and the resulting overlap or repeat is otherwise invisible.
        throw new SegmentationError("errorPolygonContract", {
          topic,
          position: index + 1,
          violation: describeViolation(violation),
          clampNote: clamped ? segmentationText("errorPolygonClamped") : "",
          rule: violation,
        });
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
        throw new SegmentationError("errorSaveEmptyMask", { topic });
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
      throw new SegmentationError("errorSavePolygonIncomplete", { topic });
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
            await client.createClass(
              {
                parent: recordName,
                classId: item.id,
                class: { displayName: item.name, color: item.color },
              },
              expectingCodes(Code.AlreadyExists),
            ),
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
            await client.createInstance(
              {
                parent: recordName,
                instanceId: item.id,
                instance: { class: className, displayName: item.name },
              },
              expectingCodes(Code.AlreadyExists),
            ),
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

  const service: LiveSegmentationService = {
    backend: "live",
    recordName,
    timelineSummaries: () => summaries,
    timelineWarning: () => timelineWarning,
    diagnostics: () => cloneSegmentation(diagnostics),
    supportsPropagationContext: true,
    supportsMultiInstanceSeeds: true,
    // See submit(): a merge could silently drop the source's frames on cameras not open here.
    supportsInstanceMerge: false,
    getPropagationCapabilities: async () => await Promise.resolve({ models: [...models] }),
    segmentFrame: async (request, signal) => {
      try {
        return await quickSegment(client, recordName, request, signal);
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.Canceled) {
          // A replaced or abandoned request, as toRpcError leaves it for every other operation.
          throw error;
        }
        throw error instanceof ConnectError
          ? new AnnotationRpcError(rpcCodeName(error.code), describeRpcError(error), {
              cause: error,
              detail: error.rawMessage,
              operation: "quickAnnotation",
            })
          : new SegmentationError(
              "errorQuickAnnotationFailed",
              { error: segmentationErrorText(error) },
              { cause: error },
            );
      }
    },
    // No cancelPropagation: aborting the stream (the signal passed to `propagate`) is the STOP,
    // and the store acknowledges it when the iterator ends rather than on a no-op reply.
    releaseFrames,
    dispose() {
      background.abort();
      timelineListeners.clear();
    },
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
        // Not awaited: metadata updates are synchronous. dispose() aborts it, and a newer read of
        // the same topic wins over it (timelineGeneration).
        void refreshTimeline(background.signal, "unread")
          .then(notifyTimeline)
          .catch(() => {
            // Aborted by dispose(); per-topic failures are in diagnostics.timelineErrors.
          });
      } else {
        notifyTimeline();
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
      doc.annotationSummaries = {};
      delete doc.unreadableObservations;
      loadedFrames.clear();
      diagnostics.loadedFrames = 0;
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
    /**
     * Not atomic across steps: catalog creates and updates, then one atomic SaveAnnotation of every
     * changed frame, then deletes. A failure stops at that step; what earlier steps wrote stays on
     * the server, and this adapter's state reflects exactly those writes, so a retry of the same
     * request converges (creates fall back to updates, deletes ignore NotFound).
     */
    async submit(request): Promise<SubmitResult> {
      // A merge must save the source's frames on every topic of the record before DeleteInstance
      // cascades. The annotation API cannot list a record's topics and this session only knows the
      // open cameras, so a merge here could silently drop the source's other cameras. Refuse it.
      if (
        request.operations.some(
          (operation) => Object.keys(operation.patch.instanceMerges ?? {}).length > 0,
        )
      ) {
        throw new SegmentationError("errorMergeUnsupportedLive");
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
        const epoch = ++saveEpoch;
        const savedWires = new Map<string, WireFrameInit>();
        let snapshotIndex = 0;
        for (const frameId of touchedFrames) {
          frameSavedAt.set(frameId, epoch);
          for (const wire of snapshots[snapshotIndex++]!.annotations ?? []) {
            if (wire.instance != undefined) {
              savedWires.set(frameInstanceKey(frameId, idOf(wire.instance)), wire);
            }
          }
        }
        const retainedFrames = new Set([...touchedFrames].filter((id) => loadedFrames.has(id)));
        // Acknowledge only the frames the RPC wrote. Other windows may have loaded or been
        // released while the request was in flight, so keep their current state.
        doc = mergeFrameWindow(
          doc,
          {
            annotations: Object.fromEntries(
              Object.entries(candidate.annotations).filter(([key]) => savedWires.has(key)),
            ),
            unreadable: Object.fromEntries(
              Object.entries(candidate.unreadableObservations ?? {}).filter(([key]) =>
                savedWires.has(key),
              ),
            ),
          },
          retainedFrames,
        );
        for (const key of occluded.keys()) {
          if (touchedFrames.has(frameOfKey(key)) && !savedWires.has(key)) {
            occluded.delete(key);
          }
        }
        for (const [key, wire] of savedWires) {
          if (retainedFrames.has(frameOfKey(key))) {
            occluded.set(key, wire.occluded === true);
          }
        }
        for (const key of opaqueWires.keys()) {
          if (!(key in (doc.unreadableObservations ?? {}))) {
            opaqueWires.delete(key);
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
          async () =>
            await client.deleteInstance(
              { name: instanceResource(item.id) },
              expectingCodes(Code.NotFound),
            ),
        );
        instanceDeletedAt.set(item.id, ++saveEpoch);
        doc.instances = doc.instances.filter((entry) => entry.id !== item.id);
      }
      for (const item of removedClasses) {
        const remaining = doc.instances.filter(
          (entry) => entry.classId === item.id && surviving.has(entry.id),
        );
        if (remaining.length > 0) {
          throw new SegmentationError("errorClassHasInstances", { name: item.name });
        }
        await deleteIfPresent(
          async () =>
            await client.deleteClass(
              { name: classResource(item.id), force: true },
              expectingCodes(Code.NotFound),
            ),
        );
        const epoch = ++saveEpoch;
        for (const entry of doc.instances) {
          if (entry.classId === item.id) {
            instanceDeletedAt.set(entry.id, epoch);
          }
        }
        doc.classes = doc.classes.filter((entry) => entry.id !== item.id);
        doc.instances = doc.instances.filter((entry) => entry.classId !== item.id);
      }
      if (removedInstances.length > 0) {
        // A delete cascades to every observation of the instance, including evicted frames.
        doc = applySegmentationPatches(doc, [
          { instances: Object.fromEntries(removedInstances.map(({ id }) => [id, undefined])) },
        ]);
      }
      // Superseded or cascaded-away unreadable observations are gone from the server too.
      for (const key of opaqueWires.keys()) {
        if (!(key in (doc.unreadableObservations ?? {}))) {
          opaqueWires.delete(key);
        }
      }
      for (const key of occluded.keys()) {
        if (!surviving.has((JSON.parse(key) as [string, string])[1])) {
          occluded.delete(key);
        }
      }
      // Timeline presence only matters for unloaded frames. A save writes loaded frames only, so
      // their presence is unchanged; a delete cascades, so drop the deleted instances' ranges.
      if (removedInstances.length > 0 || removedClasses.length > 0) {
        const kept = new Set(doc.instances.map((item) => instanceResource(item.id)));
        for (const [videoId, videoRanges] of ranges) {
          ranges.set(
            videoId,
            videoRanges.filter((range) => kept.has(range.instance)),
          );
        }
      }
      rebuildSummaries();
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
        throw new SegmentationError("errorUnknownSourceFrame");
      }
      const video = videoOf(source.videoId);
      const size = sizeOf(video);
      const index = indexOf(source.videoId);
      const seedMicros = index.frameTimeOf(source.id);
      const endMicros = truncateToMicros(request.endTimeNs);
      // Earlier than the seed propagates backward (`direction: BACKWARD`).
      if (endMicros === seedMicros) {
        throw new SegmentationError("errorEndTimeEqualsSeed");
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
            direction:
              endMicros < seedMicros ? PropagationDirection.BACKWARD : PropagationDirection.FORWARD,
          },
        },
        { signal },
      );
      let finished = false;
      /** Outputs that did not decode at the source size: left unchanged, reported at the end. */
      let undecodable = 0;
      for await (const response of stream) {
        const event = response.event;
        if (event.case === "frame") {
          const micros = wireFrameTimeMicros(event.value.frameTime);
          if (micros == undefined) {
            diagnostics.misalignedTimes++;
            continue;
          }
          const resolved = index.resolve(micros);
          if ("missing" in resolved) {
            if (resolved.missing === "collision") {
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
            if (decoded && "unreadable" in decoded && decoded.noGeometry !== true) {
              // A mask that does not decode at the source size says nothing about the object.
              // Clearing would delete the instance on that frame; keep what is there instead.
              undecodable++;
              continue;
            }
            // Omitted, or decoded with no foreground: the object left the view on this frame.
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
          const code = rpcCodeName(event.value.code);
          throw new AnnotationRpcError(
            code,
            `Propagation failed (${code}): ${event.value.message}`,
            {
              detail: event.value.message,
              operation: "propagation",
            },
          );
        } else if (event.case === "done") {
          finished = true;
          break;
        }
      }
      if (finished && undecodable > 0) {
        // Every decodable frame is already staged; fail the run so the skipped ones are seen.
        throw new SegmentationError("errorPropagationMaskSizeMismatch", {
          count: undecodable,
          topic: video.topic,
          width: size.width,
          height: size.height,
        });
      }
      if (!finished) {
        throwIfAborted(signal);
        // Received frames stay drafts; without `done` the run is not a complete success.
        throw new SegmentationError(
          endMicros < seedMicros
            ? "errorPropagationDisconnectedBefore"
            : "errorPropagationDisconnectedAfter",
          { time: microsToIso(seedMicros) },
        );
      }
    },
  };
  // Every RPC failure leaves the adapter as an AnnotationRpcError with its canonical code, so
  // callers can map it to a message without parsing text.
  const inner = service;
  return {
    ...inner,
    loadDocument: async (signal) => await withRpcErrors(inner.loadDocument(signal)),
    loadFrameWindow: async (videoId, startSec, endSec, signal) =>
      await withRpcErrors(inner.loadFrameWindow(videoId, startSec, endSec, signal)),
    submit: async (request) => await withRpcErrors(inner.submit(request)),
    async *propagate(request, signal) {
      try {
        yield* inner.propagate(request, signal);
      } catch (error) {
        throw toRpcError(error);
      }
    },
  };
}

async function withRpcErrors<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    throw toRpcError(error);
  }
}

/**
 * The live service for a cloud record; undefined for sources it cannot address (local files).
 *
 * The protocol comes from `services/api/spatial-annotation` (a local snapshot of cosceneapis
 * PR #866; its README names the commit and how to switch to the published SDK). Transport is the
 * console API's gRPC-Web client (`ConsoleApi.rpcClient`), so auth, base URL and the desktop
 * session match every other record RPC. Propagation is a server stream on it.
 */
export function createLiveSegmentationService(args: {
  /** Undefined outside the console API provider: there is then no authenticated client. */
  consoleApi: Pick<ConsoleApi, "rpcClient"> | undefined;
  recordName: string | undefined;
  startNs: bigint;
  document: SegmentationDocument;
}): LiveSegmentationService | undefined {
  if (!isSegmentationRecordName(args.recordName) || !args.consoleApi) {
    return undefined;
  }
  return createSegmentationServiceForClient({
    client: args.consoleApi.rpcClient(AnnotationService),
    recordName: args.recordName,
    startNs: args.startNs,
    document: args.document,
  });
}
