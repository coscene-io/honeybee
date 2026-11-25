// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { v4 as uuidv4 } from "uuid";
import { createStore, StoreApi } from "zustand";

import { getLineColor } from "@foxglove/studio-base/util/plotColors";

import {
  SegmentationError,
  type OperationLabelKey,
  type SegmentationErrorCode,
  segmentationErrorText,
} from "./errors";
import { evictFrames, frameOfKey, mergeFrameWindow } from "./frameWindows";
import {
  maskObservation,
  maskOfRuns,
  maskToEditorPolygons,
  mergeObservations,
  polygonObservation,
  polygonsOf,
  runsOfPolygons,
} from "./maskGeometry";
import { normalizedPolygonProblem, type NormalizedPolygonProblem } from "./normalizedPolygon";
import { createPropagationRunner } from "./propagationRunner";
import { SEGMENTATION_WINDOW_SEC, segmentationWindow } from "./segmentationWindow";
import {
  applySegmentationPatch,
  applySegmentationPatches,
  cloneSegmentation,
  frameInstanceKey,
  SegmentationService,
  validateFrameWindow,
} from "./service";
import type { StoreInternals } from "./storeInternals";
import { createSubmissionQueue } from "./submissionQueue";
import {
  CreationTool,
  FrameInstance,
  NormalizedPoint,
  SegmentationDocument,
  SegmentationPatch,
  SegmentationNodeRef,
  SegmentationStore,
  StagedOperation,
} from "./types";

const POLYGON_PROBLEMS: Record<NormalizedPolygonProblem, SegmentationErrorCode> = {
  coordinates: "errorPolygonCoordinates",
  vertices: "errorPolygonVertices",
  area: "errorPolygonArea",
};

/** Loaded frame geometry kept in memory (a few tens of KB per mask frame at most). */
const MAX_LOADED_FRAMES = 1500;

/** A stored polygon is complete: at least three vertices enclosing a nonzero area. */
function validateCompletePolygon(points: NormalizedPoint[]) {
  const problem = normalizedPolygonProblem(points);
  if (problem) {
    throw new SegmentationError(POLYGON_PROBLEMS[problem]);
  }
}

/** Where the store keeps what outlives it. Every field is optional; tests pass none. */
export type SegmentationStoreOptions = {
  /**
   * Applied to every document the store publishes, inside the same update, so subscribers never
   * see an unprojected document. Must return its input when there is nothing to change.
   */
  projectDocument?: (document: SegmentationDocument) => SegmentationDocument;
  /** Frames whose geometry stays in memory; farther ones are read again when needed. */
  maxLoadedFrames?: number;
  /** The remembered creation tool (an app setting). Without it the choice lasts for this store. */
  creationToolSetting?: {
    get: () => unknown;
    set: (tool: CreationTool) => void;
  };
};

/** New annotations start with quick annotation; a remembered "polygon" choice is kept. */
function initialCreationTool(
  setting: SegmentationStoreOptions["creationToolSetting"],
): CreationTool {
  try {
    return setting?.get() === "polygon" ? "polygon" : "quick";
  } catch {
    return "quick";
  }
}

/** Keep only existing refs; an explicit frame limits polygon refs to that frame. */
export function filterSegmentationSelection(
  document: SegmentationDocument,
  selection: readonly SegmentationNodeRef[],
  frameId?: string,
): SegmentationNodeRef[] {
  if (selection.length === 0) {
    return [];
  }
  const classes = new Set(document.classes.map((item) => item.id));
  const instances = new Set(document.instances.map((item) => item.id));
  const polygons = new Set(
    Object.values(document.annotations)
      .filter((item) => frameId == undefined || item.frameId === frameId)
      .flatMap((item) => polygonsOf(item).map((polygon) => polygon.id)),
  );
  return selection.filter((node) =>
    node.type === "class"
      ? classes.has(node.id)
      : node.type === "instance"
        ? instances.has(node.id)
        : polygons.has(node.id),
  );
}

/** One independent vanilla Zustand store per record. React consumers use useStore(store, selector). */
export function createSegmentationStore(
  service: SegmentationService,
  options: SegmentationStoreOptions = {},
): StoreApi<SegmentationStore> {
  let base: SegmentationDocument | undefined;
  let windowController: AbortController | undefined;
  /** Background playback reads, keyed by window. Aborted when the store is disposed. */
  const prefetches = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const abortPrefetches = () => {
    for (const { controller } of prefetches.values()) {
      controller.abort();
    }
    prefetches.clear();
  };
  let loadEpoch = 0;
  let capabilityEpoch = 0;
  /** Bumped when initialize replaces the record context: reads and runs from before are void. */
  let documentEpoch = 0;
  /** Acknowledged saves, and the save that last rewrote each annotation key. */
  let saveSeq = 0;
  const savedKeys = new Map<string, number>();
  /** Keys a save rewrote after `seq`: a read that started at `seq` holds pre-save values there. */
  const savedAfter =
    (seq: number) =>
    (key: string): boolean =>
      (savedKeys.get(key) ?? 0) > seq;
  let disposed = false;
  const isDisposed = () => disposed;
  const loadedFrames = new Set<string>();
  let transaction: { id: string; labelKey: OperationLabelKey } | undefined;
  // Each entry is one immutable command (possibly several grouped operations).
  let redoStack: StagedOperation[][] = [];
  const store = createStore<SegmentationStore>((rawSet, get) => {
    const project = options.projectDocument;
    function set(partial: Partial<SegmentationStore>): void {
      rawSet(
        project && partial.document ? { ...partial, document: project(partial.document) } : partial,
      );
    }
    function assertEditable() {
      if (isDisposed()) {
        throw new SegmentationError("errorDisposed");
      }
      if (["running", "stopping"].includes(get().propagation.status)) {
        throw new SegmentationError("errorStopPropagationBeforeEditing");
      }
    }
    function document(): SegmentationDocument {
      const value = get().document;
      if (!value) {
        throw new SegmentationError("errorNotInitialized");
      }
      return value;
    }
    /**
     * The published frame table. The runtime grows it as cameras register frames, so it can be
     * newer than the base's copy from the last document read or save.
     */
    function sourceFrames(): SegmentationDocument["frames"] {
      return get().document?.frames ?? base?.frames ?? [];
    }
    function frameId(): string {
      const id = get().currentFrameId;
      if (!id) {
        throw new SegmentationError("errorSelectFrame");
      }
      return id;
    }
    function prunedRefs(next: SegmentationDocument) {
      const current = get();
      const focus = filterSegmentationSelection(next, current.focus ? [current.focus] : [])[0];
      return {
        selection: filterSegmentationSelection(next, current.selection, current.currentFrameId),
        focus,
        ...(!focus ? { editing: false, drawing: undefined } : {}),
        // A drawing session ends with its instance (deleted, merged away or undone).
        ...(current.drawing &&
        !next.instances.some((instance) => instance.id === current.drawing!.instanceId)
          ? { drawing: undefined }
          : {}),
      };
    }
    /** Frames with edits that have not been saved: their base geometry must stay. */
    function framesWithUnsavedEdits(): Set<string> {
      const frames = new Set<string>();
      const operations = [
        ...get().submissionQueue.flatMap((batch) =>
          batch.status === "succeeded" ? [] : batch.operations,
        ),
        ...get().stagedOperations,
      ];
      for (const { patch } of operations) {
        for (const key of [
          ...Object.keys(patch.annotations ?? {}),
          ...Object.keys(patch.polygonChanges ?? {}),
        ]) {
          frames.add(frameOfKey(key));
        }
      }
      return frames;
    }
    /**
     * Keeps the geometry of at most `maxLoadedFrames` frames: the ones nearest the current frame in
     * time. Frames with unsaved edits stay. Without this a long recording played through with masks
     * would hold all of its RLE geometry.
     */
    function evictDistantFrames(): void {
      const limit = options.maxLoadedFrames ?? MAX_LOADED_FRAMES;
      if (!base || loadedFrames.size <= limit) {
        return;
      }
      const frames = sourceFrames();
      const current = frames.find((frame) => frame.id === get().currentFrameId);
      if (!current) {
        return;
      }
      const protectedFrames = framesWithUnsavedEdits();
      const candidates = frames
        .filter((frame) => loadedFrames.has(frame.id) && !protectedFrames.has(frame.id))
        .sort(
          (a, b) =>
            Math.abs(b.timestampSec - current.timestampSec) -
            Math.abs(a.timestampSec - current.timestampSec),
        );
      const evicted = new Set<string>();
      for (const frame of candidates) {
        if (loadedFrames.size - evicted.size <= limit || frame.id === current.id) {
          break;
        }
        evicted.add(frame.id);
      }
      if (evicted.size === 0) {
        return;
      }
      base = evictFrames(base, evicted);
      for (const id of evicted) {
        loadedFrames.delete(id);
      }
    }
    function rebuild() {
      if (!base) {
        return;
      }
      const patches: SegmentationPatch[] = [];
      for (const batch of get().submissionQueue) {
        if (batch.status === "succeeded") {
          continue;
        }
        for (const operation of batch.operations) {
          patches.push(operation.patch);
        }
      }
      for (const operation of get().stagedOperations) {
        patches.push(operation.patch);
      }
      const next = applySegmentationPatches(base, patches);
      set({ document: next, ...prunedRefs(next) });
    }
    function stage(
      labelKey: OperationLabelKey,
      patch: SegmentationPatch,
      options?: { internal?: true; exitEditing?: true },
    ) {
      if (!options?.internal) {
        assertEditable();
      }
      const normalized = cloneSegmentation(patch);
      for (const [key, next] of Object.entries(normalized.annotations ?? {})) {
        if (!next) {
          continue;
        }
        const previous = document().annotations[key];
        if (next.kind === "mask" || previous?.kind === "mask") {
          // One authoritative representation: a mask, or a change between representations,
          // replaces the whole observation. An identical mask rewrites nothing.
          if (
            next.kind === "mask" &&
            previous?.kind === "mask" &&
            previous.mask.counts === next.mask.counts &&
            previous.mask.width === next.mask.width &&
            previous.mask.height === next.mask.height
          ) {
            delete normalized.annotations![key];
          }
          continue;
        }
        const before = polygonsOf(previous);
        const polygons = Object.fromEntries(
          next.polygons
            .filter(
              (polygon) =>
                !_.isEqual(
                  before.find((item) => item.id === polygon.id),
                  polygon,
                ),
            )
            .map((polygon) => [polygon.id, polygon]),
        );
        const changes = {
          ...Object.fromEntries(
            before
              .filter((polygon) => !next.polygons.some((item) => item.id === polygon.id))
              .map((polygon) => [polygon.id, undefined]),
          ),
          ...polygons,
        };
        normalized.polygonChanges = {
          ...normalized.polygonChanges,
          [key]: { frameId: next.frameId, instanceId: next.instanceId, polygons: changes },
        };
        delete normalized.annotations![key];
      }
      if (
        normalized.annotations &&
        Object.keys(normalized.annotations).length === 0 &&
        Object.keys(patch.annotations ?? {}).length > 0 &&
        Object.keys(normalized).every((field) => field === "annotations")
      ) {
        return;
      }
      const operation: StagedOperation = {
        id: uuidv4(),
        labelKey: transaction?.labelKey ?? labelKey,
        ...(transaction ? { groupId: transaction.id } : {}),
        patch: normalized,
      };
      redoStack = [];
      // The document already is base + queue + staging: apply the new command on top of it
      // instead of replaying everything (undo, saves and window reads still rebuild).
      const next = applySegmentationPatch(document(), normalized);
      set({
        canRedo: false,
        stagedOperations: [...get().stagedOperations, operation],
        error: undefined,
        document: next,
        ...prunedRefs(next),
        ...(options?.exitEditing === true ? { editing: false, drawing: undefined } : {}),
      });
    }
    /** The instance's observation on the current frame (a private clone), once its geometry is loaded. */
    function observation(instanceId: string): FrameInstance | undefined {
      if (!loadedFrames.has(frameId())) {
        throw new SegmentationError("errorFrameGeometryLoading");
      }
      if (!document().instances.some((instance) => instance.id === instanceId)) {
        throw new SegmentationError("errorUnknownInstance");
      }
      const value = document().annotations[frameInstanceKey(frameId(), instanceId)];
      return value ? cloneSegmentation(value) : undefined;
    }
    function topicOf(targetFrameId: string): string | undefined {
      const frame = document().frames.find((item) => item.id === targetFrameId);
      return document().videos.find((video) => video.id === frame?.videoId)?.topic;
    }
    /** The decoded source size of a frame's topic; geometry is never bound to a guessed size. */
    function sourceSize(targetFrameId: string): { width: number; height: number } {
      const frame = document().frames.find((item) => item.id === targetFrameId);
      const video = document().videos.find((item) => item.id === frame?.videoId);
      if (
        video?.width == undefined ||
        video.height == undefined ||
        video.width <= 0 ||
        video.height <= 0
      ) {
        throw new SegmentationError("errorSourceSizeUnknown");
      }
      return { width: video.width, height: video.height };
    }
    function findPolygon(polygonId: string): FrameInstance & { kind: "polygons" } {
      const found = Object.values(document().annotations).find(
        (item) =>
          item.frameId === frameId() &&
          polygonsOf(item).some((polygon) => polygon.id === polygonId),
      );
      if (found?.kind !== "polygons") {
        throw new SegmentationError("errorUnknownPolygon");
      }
      return cloneSegmentation(found);
    }
    function stageObservation(
      labelKey: OperationLabelKey,
      targetFrameId: string,
      instanceId: string,
      next: FrameInstance | undefined,
      options?: { exitEditing?: true },
    ) {
      stage(
        labelKey,
        { annotations: { [frameInstanceKey(targetFrameId, instanceId)]: next } },
        options,
      );
    }
    function checkedName(name: string, kind: "Class" | "Instance"): string {
      const value = name.trim();
      if (value.length === 0 || value.length > 100) {
        throw new SegmentationError(
          kind === "Class" ? "errorClassNameLength" : "errorInstanceNameLength",
        );
      }
      return value;
    }
    /** A mask is bound to the size the current frame's camera decodes at; never rescaled. */
    function assertMaskFitsFrame(mask: { width: number; height: number }): void {
      const size = sourceSize(frameId());
      if (mask.width !== size.width || mask.height !== size.height) {
        throw new SegmentationError("errorMaskSizeMismatch", {
          maskWidth: mask.width,
          maskHeight: mask.height,
          width: size.width,
          height: size.height,
        });
      }
    }
    // Instances are numbered "#N" across the whole record; the next one is max(existing N) + 1.
    function nextInstanceName(instances: readonly { name: string }[]): string {
      let highest = 0;
      for (const instance of instances) {
        const match = /^#(\d+)$/.exec(instance.name.trim());
        if (match?.[1] != undefined) {
          highest = Math.max(highest, Number(match[1]));
        }
      }
      return `#${highest + 1}`;
    }
    function exitEditing() {
      set({ editing: false, drawing: undefined });
    }
    function assertNavigation() {
      if (["running", "stopping"].includes(get().propagation.status)) {
        throw new SegmentationError("errorStopPropagationBeforeContext");
      }
      if (isDisposed()) {
        throw new SegmentationError("errorDisposed");
      }
    }
    const context: StoreInternals = {
      service,
      get,
      set,
      subscribe: (listener) => store.subscribe(listener),
      isDisposed,
      base: () => base,
      setBase: (next) => {
        base = next;
      },
      loadedFrames,
      documentEpoch: () => documentEpoch,
      saveSeq: () => saveSeq,
      savedAfter,
      recordSave: (keys) => {
        ++saveSeq;
        for (const key of keys) {
          savedKeys.set(key, saveSeq);
        }
      },
      rebuild,
      prunedRefs,
      clearRedo: () => {
        redoStack = [];
      },
      assertEditable,
      document,
      inTransaction: () => transaction != undefined,
    };
    const queue = createSubmissionQueue(context);
    const propagation = createPropagationRunner(context);
    return {
      document: undefined,
      currentFrameId: undefined,
      viewMode: "all",
      focus: undefined,
      selection: [],
      editing: false,
      drawing: undefined,
      creationTool: initialCreationTool(options.creationToolSetting),
      interactionResetVersion: 0,
      stagedOperations: [],
      canRedo: false,
      submissionQueue: [],
      loading: false,
      frameWindowError: undefined,
      error: undefined,
      supportsInstanceMerge: service.supportsInstanceMerge === true,
      propagationCapabilities: undefined,
      propagationCapabilitiesError: undefined,
      propagationCapabilitiesLoading: false,
      propagation: { status: "idle", processedFrames: 0 },
      async refreshPropagationCapabilities() {
        if (isDisposed()) {
          return;
        }
        const epoch = ++capabilityEpoch;
        set({
          propagationCapabilities: undefined,
          propagationCapabilitiesError: undefined,
          propagationCapabilitiesLoading: service.getPropagationCapabilities != undefined,
        });
        if (!service.getPropagationCapabilities) {
          return;
        }
        try {
          const capabilities = await service.getPropagationCapabilities();
          if (!isDisposed() && epoch === capabilityEpoch) {
            set({ propagationCapabilities: cloneSegmentation(capabilities) });
          }
        } catch (error) {
          if (!isDisposed() && epoch === capabilityEpoch) {
            set({ propagationCapabilitiesError: segmentationErrorText(error) });
          }
        } finally {
          if (!isDisposed() && epoch === capabilityEpoch) {
            set({ propagationCapabilitiesLoading: false });
          }
        }
      },
      async initialize() {
        if (isDisposed()) {
          return;
        }
        const epoch = ++loadEpoch;
        const readStart = saveSeq;
        set({ loading: true, error: undefined });
        void get().refreshPropagationCapabilities();
        try {
          const loaded = await service.loadDocument();
          // A read that raced a save may predate it; the acknowledged document is newer.
          if (isDisposed() || epoch !== loadEpoch || readStart !== saveSeq) {
            return;
          }
          // A document read omits geometry. Keep redo, and loaded geometry as a placeholder until
          // its window is read again, only when the authoritative metadata is unchanged. Every
          // window is re-read either way: the server may have changed since it was loaded.
          const metadata = (doc: SegmentationDocument) => {
            const { annotations: _annotations, unreadableObservations: _unreadable, ...rest } = doc;
            return rest;
          };
          const sameBase = base != undefined && _.isEqual(metadata(base), metadata(loaded));
          loadedFrames.clear();
          if (!sameBase) {
            redoStack = [];
            ++documentEpoch;
          }
          base = sameBase
            ? {
                ...loaded,
                annotations: { ...base!.annotations, ...loaded.annotations },
                ...(base!.unreadableObservations
                  ? { unreadableObservations: base!.unreadableObservations }
                  : {}),
              }
            : loaded;
          const first =
            (sameBase
              ? loaded.frames.find((frame) => frame.id === get().currentFrameId)
              : undefined) ?? loaded.frames[0];
          set({
            currentFrameId: first?.id,
            canRedo: redoStack.length > 0,
          });
          rebuild();
          if (first && !loadedFrames.has(first.id)) {
            const { startSec, endSec } = segmentationWindow(
              first.timestampSec,
              loaded.videos.find((video) => video.id === first.videoId)?.durationSec ??
                SEGMENTATION_WINDOW_SEC,
            );
            await get().loadFrameWindow(first.videoId, startSec, endSec);
          }
        } catch (error) {
          if (!isDisposed() && epoch === loadEpoch) {
            set({ error: segmentationErrorText(error) });
          }
        } finally {
          if (!isDisposed() && epoch === loadEpoch) {
            set({ loading: false });
          }
        }
      },
      isFrameReady(id) {
        return (
          !isDisposed() &&
          get().document?.frames.some((frame) => frame.id === id) === true &&
          loadedFrames.has(id)
        );
      },
      async retryCurrentFrameWindow() {
        assertNavigation();
        const frame = get().document?.frames.find((item) => item.id === get().currentFrameId);
        if (!frame) {
          return;
        }
        const failure = get().frameWindowError;
        const sameRange =
          failure?.videoId === frame.videoId &&
          frame.timestampSec >= failure.startSec &&
          frame.timestampSec <= failure.endSec;
        const duration = document().videos.find((video) => video.id === frame.videoId)!.durationSec;
        const { startSec, endSec } = sameRange
          ? failure
          : segmentationWindow(frame.timestampSec, duration);
        await get().loadFrameWindow(frame.videoId, startSec, endSec);
      },
      async prefetchFrameWindow(videoId, startSec, endSec) {
        validateFrameWindow(startSec, endSec);
        // Not narrowed: `base` is reassigned across the await below.
        const current: SegmentationDocument | undefined = base;
        if (isDisposed() || !current) {
          return;
        }
        const inWindow = (frame: { videoId: string; timestampSec: number }) =>
          frame.videoId === videoId &&
          frame.timestampSec >= startSec &&
          frame.timestampSec <= endSec;
        if (sourceFrames().every((frame) => !inWindow(frame) || loadedFrames.has(frame.id))) {
          return;
        }
        const key = JSON.stringify([videoId, startSec, endSec])!;
        const running = prefetches.get(key);
        if (running) {
          await running.done;
          return;
        }
        const controller = new AbortController();
        const epoch = documentEpoch;
        const readStart = saveSeq;
        const done = (async () => {
          try {
            const frameWindow = await service.loadFrameWindow(
              videoId,
              startSec,
              endSec,
              controller.signal,
            );
            if (isDisposed() || controller.signal.aborted || !base || epoch !== documentEpoch) {
              return;
            }
            // A frame loaded meanwhile, by the foreground or by an edit, keeps what it has.
            const filled = new Set(
              sourceFrames()
                .filter((frame) => inWindow(frame) && !loadedFrames.has(frame.id))
                .map((frame) => frame.id),
            );
            base = mergeFrameWindow(base, frameWindow, filled, savedAfter(readStart));
            for (const id of filled) {
              loadedFrames.add(id);
            }
            evictDistantFrames();
            rebuild();
          } catch {
            // Playback keeps going; the foreground load on pause reports any error.
          } finally {
            if (prefetches.get(key)?.controller === controller) {
              prefetches.delete(key);
            }
          }
        })();
        prefetches.set(key, { controller, done });
        await done;
      },
      async loadFrameWindow(videoId, startSec, endSec) {
        assertNavigation();
        validateFrameWindow(startSec, endSec);
        windowController?.abort();
        const controller = new AbortController();
        const epoch = documentEpoch;
        const readStart = saveSeq;
        windowController = controller;
        set({ loading: true, error: undefined, frameWindowError: undefined });
        try {
          const frameWindow = await service.loadFrameWindow(
            videoId,
            startSec,
            endSec,
            controller.signal,
          );
          if (isDisposed() || controller.signal.aborted || !base || epoch !== documentEpoch) {
            return;
          }
          // Loaded geometry is the authority for its own summary (tree and frame-strip counts).
          // A save acknowledged while this read was in flight keeps what it wrote.
          const windowFrames = new Set(
            sourceFrames()
              .filter(
                (frame) =>
                  frame.videoId === videoId &&
                  frame.timestampSec >= startSec &&
                  frame.timestampSec <= endSec,
              )
              .map((frame) => frame.id),
          );
          base = mergeFrameWindow(base, frameWindow, windowFrames, savedAfter(readStart));
          for (const id of windowFrames) {
            loadedFrames.add(id);
          }
          evictDistantFrames();
          rebuild();
        } catch (error) {
          if (!isDisposed() && !controller.signal.aborted) {
            set({
              error: segmentationErrorText(error),
              frameWindowError: {
                videoId,
                startSec,
                endSec,
                message: segmentationErrorText(error),
              },
            });
          }
        } finally {
          if (!isDisposed() && windowController === controller) {
            set({ loading: false });
          }
        }
      },
      setCurrentFrame(id) {
        assertNavigation();
        const frame = document().frames.find((item) => item.id === id);
        if (!frame) {
          throw new SegmentationError("errorUnknownFrame");
        }
        set({
          currentFrameId: id,
          drawing: undefined,
          selection: filterSegmentationSelection(document(), get().selection, id),
        });
        if (!loadedFrames.has(id)) {
          const duration = document().videos.find(
            (video) => video.id === frame.videoId,
          )!.durationSec;
          const { startSec, endSec } = segmentationWindow(frame.timestampSec, duration);
          void get().loadFrameWindow(frame.videoId, startSec, endSec);
        }
      },
      setViewMode(mode) {
        assertNavigation();
        set({ viewMode: mode });
      },
      setFocus(focus) {
        assertNavigation();
        const current = get();
        // Moving focus to another object completes an edit in progress. Narrowing or widening it
        // within one instance (the instance, or one of its polygons) keeps editing.
        const owner = (ref: SegmentationNodeRef | undefined): string | undefined => {
          if (ref?.type === "instance") {
            return ref.id;
          }
          if (ref?.type === "polygon") {
            return Object.values(current.document?.annotations ?? {}).find(
              (item) =>
                item.frameId === current.currentFrameId &&
                polygonsOf(item).some((polygon) => polygon.id === ref.id),
            )?.instanceId;
          }
          return undefined;
        };
        const sameInstance = owner(focus) != undefined && owner(focus) === owner(current.focus);
        const switching =
          current.editing &&
          !sameInstance &&
          (focus?.type !== current.focus?.type || focus?.id !== current.focus?.id);
        set({
          focus,
          ...(switching || (current.drawing && owner(focus) !== current.drawing.instanceId)
            ? { drawing: undefined }
            : {}),
          ...(switching ? { editing: false } : {}),
        });
      },
      setSelection(selection) {
        assertNavigation();
        set({ selection: cloneSegmentation(selection) });
      },
      setEditing(editing) {
        assertEditable();
        set({ editing, drawing: undefined });
      },
      startDrawing(instanceId, tool) {
        assertEditable();
        if (!document().instances.some((instance) => instance.id === instanceId)) {
          throw new SegmentationError("errorUnknownInstance");
        }
        if (tool) {
          get().setCreationTool(tool);
        }
        set({
          drawing: { instanceId, frameId: frameId() },
          editing: true,
          focus: { type: "instance", id: instanceId },
          ...(get().viewMode === "original" ? { viewMode: "all" as const } : {}),
        });
      },
      retargetDrawing(targetFrameId) {
        assertEditable();
        const drawing = get().drawing;
        if (!drawing) {
          throw new SegmentationError("errorNothingDrawn");
        }
        if (!document().frames.some((frame) => frame.id === targetFrameId)) {
          throw new SegmentationError("errorUnknownFrame");
        }
        if (!loadedFrames.has(targetFrameId)) {
          throw new SegmentationError("errorFrameGeometryLoading");
        }
        set({
          currentFrameId: targetFrameId,
          drawing: { ...drawing, frameId: targetFrameId },
          editing: true,
          selection: filterSegmentationSelection(document(), get().selection, targetFrameId),
        });
      },
      cancelDrawing() {
        set({ drawing: undefined });
      },
      setCreationTool(tool) {
        try {
          options.creationToolSetting?.set(tool);
        } catch {
          // The setting may be unavailable; the choice still applies to this session.
        }
        set({ creationTool: tool });
      },
      addClass(name = "New class") {
        assertEditable();
        const trimmed = checkedName(name, "Class");
        const existing = document().classes.find((item) => item.name === trimmed);
        if (existing) {
          return existing.id;
        }
        const id = uuidv4();
        // The app's categorical palette, the same colours plots use for series.
        stage("opLabelCreateClass", {
          classes: {
            [id]: { id, name: trimmed, color: getLineColor(undefined, document().classes.length) },
          },
        });
        exitEditing();
        return id;
      },
      renameClass(id, name) {
        const item = document().classes.find((value) => value.id === id);
        if (!item) {
          throw new SegmentationError("errorUnknownClass");
        }
        const trimmed = checkedName(name, "Class");
        if (document().classes.some((value) => value.id !== id && value.name === trimmed)) {
          throw new SegmentationError("errorClassNameExists");
        }
        stage("opLabelRenameClass", { classes: { [id]: { ...item, name: trimmed } } });
        exitEditing();
      },
      deleteClass(id) {
        if (!document().classes.some((item) => item.id === id)) {
          throw new SegmentationError("errorUnknownClass");
        }
        const instances = Object.fromEntries(
          document()
            .instances.filter((instance) => instance.classId === id)
            .map((instance) => [instance.id, undefined]),
        );
        stage(
          "opLabelDeleteClassAndInstances",
          { classes: { [id]: undefined }, instances },
          { exitEditing: true },
        );
      },
      renameInstance(id, name) {
        const instance = document().instances.find((item) => item.id === id);
        if (!instance) {
          throw new SegmentationError("errorUnknownInstance");
        }
        stage("opLabelRenameInstance", {
          instances: { [id]: { ...instance, name: checkedName(name, "Instance") } },
        });
        exitEditing();
      },
      mergeClasses(sourceIds, targetClassId) {
        if (!document().classes.some((item) => item.id === targetClassId)) {
          throw new SegmentationError("errorUnknownTargetClass");
        }
        const sources = sourceIds.filter((id) => id !== targetClassId);
        if (sources.some((id) => !document().classes.some((item) => item.id === id))) {
          throw new SegmentationError("errorUnknownSourceClass");
        }
        stage(
          "opLabelMoveClassInstances",
          {
            instances: Object.fromEntries(
              document()
                .instances.filter((instance) => sources.includes(instance.classId))
                .map((instance) => [instance.id, { ...instance, classId: targetClassId }]),
            ),
          },
          { exitEditing: true },
        );
      },
      addInstance(classId, name) {
        if (!document().classes.some((item) => item.id === classId)) {
          throw new SegmentationError("errorUnknownClass");
        }
        const id = uuidv4();
        stage("opLabelCreateInstance", {
          instances: {
            [id]: { id, classId, name: name ?? nextInstanceName(document().instances) },
          },
        });
        exitEditing();
        return id;
      },
      moveInstance(id, classId) {
        const item = document().instances.find((value) => value.id === id);
        if (!item || !document().classes.some((value) => value.id === classId)) {
          throw new SegmentationError("errorUnknownInstanceOrClass");
        }
        stage(
          "opLabelMoveInstance",
          { instances: { [id]: { ...item, classId } } },
          { exitEditing: true },
        );
      },
      deleteInstance(id, scope = "all") {
        if (!document().instances.some((item) => item.id === id)) {
          throw new SegmentationError("errorUnknownInstance");
        }
        stage(
          "opLabelDeleteInstance",
          scope === "frame"
            ? { annotations: { [frameInstanceKey(frameId(), id)]: undefined } }
            : { instances: { [id]: undefined } },
          { exitEditing: true },
        );
      },
      addPolygon(instanceId, points) {
        validateCompletePolygon(points);
        const current = observation(instanceId);
        const id = uuidv4();
        const topic = topicOf(frameId());
        const added: FrameInstance = {
          frameId: frameId(),
          instanceId,
          kind: "polygons",
          polygons: [
            { id, points: cloneSegmentation(points), ...(topic == undefined ? {} : { topic }) },
          ],
        };
        stageObservation(
          "opLabelCreatePolygon",
          frameId(),
          instanceId,
          mergeObservations(current, added, instanceId),
        );
        set({ focus: { type: "instance", id: instanceId }, editing: true, drawing: undefined });
        return id;
      },
      addMask(instanceId, mask, labelKey = "opLabelQuickAnnotate") {
        assertMaskFitsFrame(mask);
        const added = maskObservation(frameId(), instanceId, cloneSegmentation(mask));
        if (!added) {
          throw new SegmentationError("errorEmptyMask");
        }
        stageObservation(
          labelKey,
          frameId(),
          instanceId,
          mergeObservations(observation(instanceId), added, instanceId),
        );
        set({ focus: { type: "instance", id: instanceId }, editing: true, drawing: undefined });
      },
      replaceMask(instanceId, mask, labelKey = "opLabelBrush") {
        assertMaskFitsFrame(mask);
        observation(instanceId);
        stageObservation(
          labelKey,
          frameId(),
          instanceId,
          maskObservation(frameId(), instanceId, cloneSegmentation(mask)),
        );
      },
      convertToMask(instanceId) {
        const current = observation(instanceId);
        if (current?.kind !== "polygons") {
          throw new SegmentationError("errorConvertNeedsPolygon");
        }
        const size = sourceSize(frameId());
        const mask = maskOfRuns(runsOfPolygons(current.polygons, size.width, size.height), "merge");
        const next = maskObservation(frameId(), instanceId, mask);
        if (!next) {
          throw new SegmentationError("errorPolygonsCoverNoPixel");
        }
        stageObservation("opLabelConvertToMask", frameId(), instanceId, next);
      },
      convertToPolygons(instanceId) {
        const current = observation(instanceId);
        if (current?.kind !== "mask") {
          throw new SegmentationError("errorConvertNeedsMask");
        }
        const next = polygonObservation(
          frameId(),
          instanceId,
          maskToEditorPolygons(current.mask, topicOf(frameId())),
        );
        if (!next) {
          throw new SegmentationError("errorMaskTooThin");
        }
        stageObservation("opLabelConvertToPolygons", frameId(), instanceId, next);
      },
      setPolygonPoints(id, points) {
        validateCompletePolygon(points);
        const current = findPolygon(id);
        current.polygons = current.polygons.map((polygon) =>
          polygon.id === id ? { ...polygon, points: cloneSegmentation(points) } : polygon,
        );
        stageObservation("opLabelEditPolygon", current.frameId, current.instanceId, current);
      },
      deletePolygon(id) {
        const current = findPolygon(id);
        stageObservation(
          "opLabelDeletePolygon",
          current.frameId,
          current.instanceId,
          polygonObservation(
            current.frameId,
            current.instanceId,
            current.polygons.filter((polygon) => polygon.id !== id),
          ),
          { exitEditing: true },
        );
      },
      mergeInstances(sourceIds, targetInstanceId) {
        if (service.supportsInstanceMerge !== true) {
          throw new SegmentationError("errorInstanceMergeUnsupported");
        }
        observation(targetInstanceId);
        const sources = sourceIds.filter((id) => id !== targetInstanceId);
        if (sources.some((id) => !document().instances.some((item) => item.id === id))) {
          throw new SegmentationError("errorUnknownSourceInstance");
        }
        stage(
          "opLabelMergeInstances",
          {
            instances: Object.fromEntries(sources.map((id) => [id, undefined])),
            instanceMerges: Object.fromEntries(sources.map((id) => [id, targetInstanceId])),
          },
          { exitEditing: true },
        );
      },
      mergePolygons(polygonIds, targetInstanceId) {
        const target = observation(targetInstanceId);
        const remaining = new Map<string, FrameInstance & { kind: "polygons" }>();
        const moved: FrameInstance & { kind: "polygons" } = {
          frameId: frameId(),
          instanceId: targetInstanceId,
          kind: "polygons",
          polygons: [],
        };
        for (const id of polygonIds) {
          const found = findPolygon(id);
          if (found.instanceId === targetInstanceId) {
            continue;
          }
          const key = frameInstanceKey(found.frameId, found.instanceId);
          const source = remaining.get(key) ?? found;
          moved.polygons.push(source.polygons.find((polygon) => polygon.id === id)!);
          source.polygons = source.polygons.filter((polygon) => polygon.id !== id);
          remaining.set(key, source);
        }
        const changes: Record<string, FrameInstance | undefined> = {};
        for (const [key, source] of remaining) {
          changes[key] = polygonObservation(source.frameId, source.instanceId, source.polygons);
        }
        if (moved.polygons.length > 0) {
          // Polygons moved onto a mask are rasterized into it (one representation).
          changes[frameInstanceKey(frameId(), targetInstanceId)] = mergeObservations(
            target,
            moved,
            targetInstanceId,
          );
        }
        stage("opLabelMovePolygons", { annotations: changes }, { exitEditing: true });
      },
      runTransaction(labelKey, command) {
        assertEditable();
        if (transaction) {
          command();
          return;
        }
        const previous = get();
        const previousRedoStack = redoStack;
        transaction = { id: uuidv4(), labelKey };
        try {
          command();
        } catch (error) {
          redoStack = previousRedoStack;
          // A snapshot of published state, already projected.
          rawSet(previous, true);
          throw error;
        } finally {
          transaction = undefined;
        }
      },
      undo() {
        assertEditable();
        const operations = get().stagedOperations;
        const groupId = operations.at(-1)?.groupId;
        let keep = Math.max(0, operations.length - 1);
        if (groupId) {
          while (keep > 0 && operations[keep - 1]?.groupId === groupId) {
            keep--;
          }
        }
        const undone = operations.slice(keep);
        if (undone.length > 0) {
          redoStack = [...redoStack, undone];
        }
        set({ stagedOperations: operations.slice(0, keep), canRedo: redoStack.length > 0 });
        exitEditing();
        rebuild();
      },
      redo() {
        assertEditable();
        const operations = redoStack.at(-1);
        if (!operations) {
          return;
        }
        redoStack = redoStack.slice(0, -1);
        set({
          stagedOperations: [...get().stagedOperations, ...operations],
          canRedo: redoStack.length > 0,
        });
        exitEditing();
        rebuild();
      },
      revertStaging() {
        assertEditable();
        redoStack = [];
        set({
          canRedo: false,
          stagedOperations: [],
          editing: false,
          drawing: undefined,
          interactionResetVersion: get().interactionResetVersion + 1,
        });
        rebuild();
      },
      ...queue,
      startPropagation: propagation.startPropagation,
      stopPropagation: propagation.stopPropagation,
      async segmentFrame(request, signal) {
        if (!service.segmentFrame) {
          throw new SegmentationError("errorQuickAnnotationNeedsCloudRecord");
        }
        return await service.segmentFrame(request, signal);
      },
      clearError() {
        set({ error: undefined });
      },
      dispose() {
        disposed = true;
        redoStack = [];
        // Teardown is silent: keep the last public snapshot for mounted consumers.
        // The disposed guard prevents replay even if that snapshot advertised redo.
        ++capabilityEpoch;
        ++loadEpoch;
        windowController?.abort();
        abortPrefetches();
        propagation.dispose();
      },
    };
  });
  return store;
}
