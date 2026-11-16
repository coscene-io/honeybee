// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { v4 as uuidv4 } from "uuid";
import { createStore, StoreApi } from "zustand";

import { ANNOTATION_WINDOW_SEC, annotationWindow } from "./annotationFrames";
import { maskToEditorPolygons, mergeObservations, summarizeObservation } from "./maskGeometry";
import { createMockSemanticSegmentationService } from "./mockService";
import {
  applySegmentationPatch,
  applySegmentationPatches,
  cloneSegmentation,
  frameInstanceKey,
  resolvePropagationSeeds,
  SemanticSegmentationService,
  validateFrameWindow,
  validatePropagationCapabilities,
} from "./service";
import {
  FrameInstance,
  MaskEditState,
  NormalizedPoint,
  PropagationContext,
  SegmentationDocument,
  SegmentationPatch,
  SegmentationNodeRef,
  SemanticSegmentationStore,
  StagedOperation,
  SubmissionBatch,
} from "./types";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validatePoints(points: NormalizedPoint[]) {
  if (
    points.some(
      ({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1,
    )
  ) {
    throw new Error("Polygon points must be finite normalized coordinates in [0, 1]");
  }
}

/** Keep only existing refs; an explicit frame limits polygon refs to that frame. */
export function filterSegmentationSelection(
  document: SegmentationDocument,
  selection: readonly SegmentationNodeRef[],
  frameId?: string,
): SegmentationNodeRef[] {
  const classes = new Set(document.classes.map((item) => item.id));
  const instances = new Set(document.instances.map((item) => item.id));
  const polygons = new Set(
    Object.values(document.annotations)
      .filter((item) => frameId == undefined || item.frameId === frameId)
      .flatMap((item) => item.polygons.map((polygon) => polygon.id)),
  );
  return selection.filter((node) =>
    node.type === "class"
      ? classes.has(node.id)
      : node.type === "instance"
        ? instances.has(node.id)
        : polygons.has(node.id),
  );
}

/** One independent vanilla Zustand store per record/workbench. React consumers use useStore(store, selector). */
export function createSemanticSegmentationStore(
  service: SemanticSegmentationService = createMockSemanticSegmentationService(),
): StoreApi<SemanticSegmentationStore> {
  let base: SegmentationDocument | undefined;
  let windowController: AbortController | undefined;
  /** Background playback reads, keyed by window. Aborted with every foreground reset. */
  const prefetches = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const abortPrefetches = () => {
    for (const { controller } of prefetches.values()) {
      controller.abort();
    }
    prefetches.clear();
  };
  let propagationController: AbortController | undefined;
  type PropagationSession = {
    context: PropagationContext;
    controller: AbortController;
    iteratorDone: boolean;
    stopRequested: boolean;
    cancelPending: boolean;
  };
  let propagationSession: PropagationSession | undefined;
  let loadEpoch = 0;
  let capabilityEpoch = 0;
  let baseGeneration = 0;
  let disposed = false;
  const isDisposed = () => disposed;
  const loadedFrames = new Set<string>();
  let pumpPromise: Promise<void> | undefined;
  let transaction: { id: string; label: string } | undefined;
  // Each entry is one immutable command (possibly several grouped operations).
  let redoStack: StagedOperation[][] = [];
  const store = createStore<SemanticSegmentationStore>((rawSet, get) => {
    /** The mask edit view follows every state change: it ends with editing or a frame switch. */
    const set: typeof rawSet = (...args: unknown[]) => {
      (rawSet as (...forwarded: unknown[]) => void)(...args);
      reconcileMaskEdit();
    };
    function maskEditView(doc: SegmentationDocument, edit: MaskEditState): SegmentationDocument {
      const observation = doc.annotations[edit.key];
      if (observation?.mask?.counts !== edit.counts) {
        return doc;
      }
      const { mask: _mask, ...rest } = observation;
      return {
        ...doc,
        annotations: { ...doc.annotations, [edit.key]: { ...rest, polygons: edit.polygons } },
      };
    }
    function reconcileMaskEdit(): void {
      const state = get();
      const edit = state.maskEdit;
      if (!edit) {
        return;
      }
      const doc = state.document;
      const observation = doc?.annotations[edit.key];
      const ended = !doc || !state.editing || state.currentFrameId !== edit.frameId;
      if (ended) {
        // Restore the untouched mask unless the transient polygons were promoted by an edit.
        const restored =
          doc && observation?.polygons === edit.polygons
            ? { ...doc, annotations: { ...doc.annotations, [edit.key]: edit.original } }
            : doc;
        rawSet({ maskEdit: undefined, ...(restored ? { document: restored } : {}) });
        return;
      }
      if (observation?.mask) {
        if (observation.mask.counts === edit.counts) {
          rawSet({ document: maskEditView(doc, edit) });
        } else {
          rawSet({ maskEdit: undefined });
        }
      }
    }
    function acknowledgeStop(session: PropagationSession): void {
      session.cancelPending = false;
      if (
        isDisposed() ||
        propagationSession !== session ||
        propagationController !== session.controller
      ) {
        return;
      }
      set({
        propagation: {
          ...get().propagation,
          status: "cancelled",
          cancellationPending: false,
          error: undefined,
        },
        error: undefined,
      });
    }
    function requestStop(session: PropagationSession): void {
      if (
        session.cancelPending ||
        isDisposed() ||
        propagationSession !== session ||
        !["running", "stopping"].includes(get().propagation.status)
      ) {
        return;
      }
      session.stopRequested = true;
      session.cancelPending = true;
      session.controller.abort();
      set({
        propagation: {
          ...get().propagation,
          status: "stopping",
          cancellationPending: true,
          error: undefined,
        },
        error: undefined,
      });
      if (!service.cancelPropagation) {
        if (session.iteratorDone) {
          acknowledgeStop(session);
        }
        return;
      }
      void Promise.resolve()
        .then(async () => await service.cancelPropagation!(cloneSegmentation(session.context)))
        .then((ack) => {
          const acknowledgementStatus: unknown = ack.status;
          if (
            ack.requestId !== session.context.requestId ||
            acknowledgementStatus !== "cancelled"
          ) {
            throw new Error(
              "Cancellation acknowledgement belongs to another request; retry stopping",
            );
          }
          acknowledgeStop(session);
        })
        .catch((error: unknown) => {
          session.cancelPending = false;
          if (
            !isDisposed() &&
            propagationSession === session &&
            propagationController === session.controller
          ) {
            set({
              propagation: {
                ...get().propagation,
                status: "stopping",
                cancellationPending: false,
                error: message(error),
              },
              error: message(error),
            });
          }
        });
    }
    function assertEditable() {
      if (isDisposed()) {
        throw new Error("Workbench is disposed");
      }
      if (["running", "stopping"].includes(get().propagation.status)) {
        throw new Error("Stop propagation before editing");
      }
    }
    function document(): SegmentationDocument {
      const value = get().document;
      if (!value) {
        throw new Error("Initialize the workbench first");
      }
      return value;
    }
    function frameId(): string {
      const id = get().currentFrameId;
      if (!id) {
        throw new Error("Select a frame first");
      }
      return id;
    }
    function prunedRefs(next: SegmentationDocument) {
      const current = get();
      const focus = filterSegmentationSelection(next, current.focus ? [current.focus] : [])[0];
      return {
        selection: filterSegmentationSelection(next, current.selection, current.currentFrameId),
        focus,
        ...(!focus ? { editing: false, drawingPolygonId: undefined } : {}),
      };
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
      label: string,
      patch: SegmentationPatch,
      options?: { internal?: true; exitEditing?: true },
    ) {
      if (!options?.internal) {
        assertEditable();
      }
      const normalized = cloneSegmentation(patch);
      const maskEdit = get().maskEdit;
      for (const [key, next] of Object.entries(normalized.annotations ?? {})) {
        if (!next) {
          continue;
        }
        const previous = document().annotations[key];
        if (key === maskEdit?.key || previous?.mask != undefined || next.mask != undefined) {
          // One authoritative representation: a mask or a mask-to-polygon edit replaces the
          // whole observation. Opening a mask without changing its polygons rewrites nothing.
          const unchanged =
            key === maskEdit?.key && next.mask == undefined
              ? _.isEqual(next.polygons, maskEdit.polygons)
              : next.mask != undefined &&
                previous?.mask?.counts === next.mask.counts &&
                previous.mask.width === next.mask.width &&
                previous.mask.height === next.mask.height;
          if (unchanged) {
            delete normalized.annotations![key];
          } else if (next.mask) {
            normalized.annotations![key] = { ...next, polygons: [] };
          }
          continue;
        }
        const polygons = Object.fromEntries(
          next.polygons
            .filter(
              (polygon) =>
                !_.isEqual(
                  previous?.polygons.find((item) => item.id === polygon.id),
                  polygon,
                ),
            )
            .map((polygon) => [polygon.id, polygon]),
        );
        const changes = {
          ...Object.fromEntries(
            (previous?.polygons ?? [])
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
        label: transaction?.label ?? label,
        ...(transaction ? { groupId: transaction.id } : {}),
        patch: normalized,
      };
      redoStack = [];
      set({
        canRedo: false,
        stagedOperations: [...get().stagedOperations, operation],
        error: undefined,
        ...(options?.exitEditing === true ? { editing: false, drawingPolygonId: undefined } : {}),
      });
      rebuild();
    }
    function updateBatch(id: string, changes: Partial<SubmissionBatch>) {
      set({
        submissionQueue: get().submissionQueue.map((batch) =>
          batch.id === id ? { ...batch, ...changes } : batch,
        ),
      });
    }
    async function pump() {
      for (;;) {
        const batch = get().submissionQueue.find((item) => item.status === "queued");
        if (!batch || isDisposed() || !base) {
          return;
        }
        updateBatch(batch.id, { status: "submitting" });
        try {
          const result = await service.submit({
            id: batch.id,
            message: batch.message,
            operations: batch.operations,
          });
          if (isDisposed()) {
            return;
          }
          base = cloneSegmentation(result.document);
          ++baseGeneration;
          // An acknowledgement may arrive after a later local command was undone.
          redoStack = [];
          set({ canRedo: false });
          updateBatch(batch.id, { status: "succeeded", error: undefined });
          if (result.warning) {
            set({ error: result.warning });
          }
        } catch (error) {
          if (isDisposed()) {
            return;
          }
          updateBatch(batch.id, { status: "failed", error: message(error) });
          set({ error: message(error) });
        }
        rebuild();
      }
    }
    function startPump() {
      if (pumpPromise) {
        return;
      }
      const completion: Promise<void> = Promise.resolve()
        .then(pump)
        .finally(() => {
          if (pumpPromise === completion) {
            pumpPromise = undefined;
            if (!isDisposed() && get().submissionQueue.some((batch) => batch.status === "queued")) {
              startPump();
            }
          }
        });
      pumpPromise = completion;
    }
    function annotation(instanceId: string): FrameInstance {
      if (!loadedFrames.has(frameId())) {
        throw new Error("Wait for frame geometry to load");
      }
      if (!document().instances.some((instance) => instance.id === instanceId)) {
        throw new Error("Unknown instance");
      }
      const value = cloneSegmentation(
        document().annotations[frameInstanceKey(frameId(), instanceId)] ?? {
          frameId: frameId(),
          instanceId,
          polygons: [],
        },
      );
      if (value.mask) {
        // A polygon edit on a mask observation replaces it with its polygon conversion.
        const frame = document().frames.find((item) => item.id === value.frameId);
        const topic = document().videos.find((video) => video.id === frame?.videoId)?.topic;
        value.polygons = maskToEditorPolygons(value.mask, topic);
        delete value.mask;
      }
      return value;
    }
    function findPolygon(polygonId: string): FrameInstance {
      const found = Object.values(document().annotations).find(
        (item) =>
          item.frameId === frameId() && item.polygons.some((polygon) => polygon.id === polygonId),
      );
      if (!found) {
        throw new Error("Unknown polygon in current frame");
      }
      return cloneSegmentation(found);
    }
    function checkedName(name: string): string {
      const value = name.trim();
      if (value.length === 0 || value.length > 100) {
        throw new Error("Class names must contain 1–100 characters");
      }
      return value;
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
      set({ editing: false, drawingPolygonId: undefined });
    }
    function assertNavigation() {
      if (["running", "stopping"].includes(get().propagation.status)) {
        throw new Error("Stop propagation before changing context");
      }
      if (isDisposed()) {
        throw new Error("Workbench is disposed");
      }
    }
    return {
      document: undefined,
      currentFrameId: undefined,
      viewMode: "all",
      focus: undefined,
      selection: [],
      editing: false,
      drawingPolygonId: undefined,
      maskEdit: undefined,
      interactionResetVersion: 0,
      stagedOperations: [],
      canRedo: false,
      submissionQueue: [],
      loading: false,
      frameWindowError: undefined,
      error: undefined,
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
            set({ propagationCapabilitiesError: message(error) });
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
        const generation = baseGeneration;
        set({ loading: true, error: undefined });
        void get().refreshPropagationCapabilities();
        try {
          const loaded = await service.loadDocument();
          if (isDisposed() || epoch !== loadEpoch || generation !== baseGeneration) {
            return;
          }
          // A document read omits geometry. Keep loaded windows and redo only when
          // the authoritative metadata is unchanged.
          const sameBase =
            base != undefined &&
            _.isEqual({ ...base, annotations: {} }, { ...loaded, annotations: {} });
          if (!sameBase) {
            redoStack = [];
            loadedFrames.clear();
          }
          base = sameBase
            ? { ...loaded, annotations: { ...base!.annotations, ...loaded.annotations } }
            : loaded;
          ++baseGeneration;
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
            const { startSec, endSec } = annotationWindow(
              first.timestampSec,
              loaded.videos.find((video) => video.id === first.videoId)?.durationSec ??
                ANNOTATION_WINDOW_SEC,
            );
            await get().loadFrameWindow(first.videoId, startSec, endSec);
          }
          const persistenceError = service.getPersistenceError?.();
          if (persistenceError) {
            set({ error: persistenceError });
          }
        } catch (error) {
          if (!isDisposed() && epoch === loadEpoch) {
            set({ error: message(error) });
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
          : annotationWindow(frame.timestampSec, duration);
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
        if (current.frames.every((frame) => !inWindow(frame) || loadedFrames.has(frame.id))) {
          return;
        }
        const key = JSON.stringify([videoId, startSec, endSec])!;
        const running = prefetches.get(key);
        if (running) {
          await running.done;
          return;
        }
        const controller = new AbortController();
        const generation = baseGeneration;
        const done = (async () => {
          try {
            const frameWindow = await service.loadFrameWindow(
              videoId,
              startSec,
              endSec,
              controller.signal,
            );
            if (
              isDisposed() ||
              controller.signal.aborted ||
              !base ||
              generation !== baseGeneration
            ) {
              return;
            }
            // A frame loaded meanwhile, by the foreground or by an edit, keeps what it has.
            const unloaded = (annotationKey: string) => {
              const [frameId] = JSON.parse(annotationKey) as [string, string];
              return !loadedFrames.has(frameId);
            };
            const annotations = Object.fromEntries(
              Object.entries(frameWindow.annotations).filter(([item]) => unloaded(item)),
            );
            base = {
              ...base,
              annotations: { ...base.annotations, ...annotations },
              annotationSummaries: {
                ...base.annotationSummaries,
                ...Object.fromEntries(
                  Object.entries(annotations).map(([item, annotation]) => [
                    item,
                    summarizeObservation(annotation),
                  ]),
                ),
              },
            };
            for (const frame of base.frames) {
              if (inWindow(frame)) {
                loadedFrames.add(frame.id);
              }
            }
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
        const generation = baseGeneration;
        windowController = controller;
        set({ loading: true, error: undefined, frameWindowError: undefined });
        try {
          const frameWindow = await service.loadFrameWindow(
            videoId,
            startSec,
            endSec,
            controller.signal,
          );
          if (isDisposed() || controller.signal.aborted || !base || generation !== baseGeneration) {
            return;
          }
          // Loaded geometry is the authority for its own summary (tree and frame-strip counts).
          const loadedSummaries = Object.fromEntries(
            Object.entries(frameWindow.annotations).map(([key, annotation]) => [
              key,
              summarizeObservation(annotation),
            ]),
          );
          base = {
            ...base,
            annotations: { ...base.annotations, ...frameWindow.annotations },
            annotationSummaries: { ...base.annotationSummaries, ...loadedSummaries },
          };
          for (const frame of base.frames) {
            if (
              frame.videoId === videoId &&
              frame.timestampSec >= startSec &&
              frame.timestampSec <= endSec
            ) {
              loadedFrames.add(frame.id);
            }
          }
          rebuild();
        } catch (error) {
          if (!isDisposed() && !controller.signal.aborted) {
            set({
              error: message(error),
              frameWindowError: { videoId, startSec, endSec, message: message(error) },
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
          throw new Error("Unknown frame");
        }
        set({
          currentFrameId: id,
          drawingPolygonId: undefined,
          selection: filterSegmentationSelection(document(), get().selection, id),
        });
        if (!loadedFrames.has(id)) {
          const duration = document().videos.find(
            (video) => video.id === frame.videoId,
          )!.durationSec;
          const { startSec, endSec } = annotationWindow(frame.timestampSec, duration);
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
        // Moving focus to another class/instance/polygon completes an edit in progress.
        const switching =
          current.editing &&
          (focus?.type !== current.focus?.type || focus?.id !== current.focus?.id);
        set({ focus, drawingPolygonId: undefined, ...(switching ? { editing: false } : {}) });
      },
      setSelection(selection) {
        assertNavigation();
        set({ selection: cloneSegmentation(selection) });
      },
      setEditing(editing) {
        assertEditable();
        set({ editing, drawingPolygonId: undefined });
      },
      setDrawingPolygonId(id) {
        assertEditable();
        set({ drawingPolygonId: id, editing: id != undefined || get().editing });
      },
      beginMaskEdit(targetFrameId, instanceId) {
        assertEditable();
        if (!loadedFrames.has(targetFrameId)) {
          throw new Error("Wait for frame geometry to load");
        }
        const current = get().maskEdit;
        const key = frameInstanceKey(targetFrameId, instanceId);
        if (current?.key === key) {
          return current;
        }
        if (current) {
          set({ editing: false });
        }
        const doc = document();
        const observation = doc.annotations[key];
        if (!observation?.mask) {
          throw new Error("This observation is not a mask");
        }
        const frame = doc.frames.find((item) => item.id === targetFrameId);
        const topic = doc.videos.find((video) => video.id === frame?.videoId)?.topic;
        const edit: MaskEditState = {
          key,
          frameId: targetFrameId,
          instanceId,
          counts: observation.mask.counts,
          original: observation,
          polygons: maskToEditorPolygons(observation.mask, topic),
        };
        rawSet({
          maskEdit: edit,
          document: maskEditView(doc, edit),
          currentFrameId: targetFrameId,
          focus: { type: "instance", id: instanceId },
          selection: [{ type: "instance", id: instanceId }],
          editing: true,
          drawingPolygonId: undefined,
          ...(get().viewMode === "original" ? { viewMode: "all" as const } : {}),
        });
        return edit;
      },
      addClass(name = "New class") {
        assertEditable();
        const trimmed = checkedName(name);
        const existing = document().classes.find((item) => item.name === trimmed);
        if (existing) {
          return existing.id;
        }
        const id = uuidv4();
        const colors = ["#55b8de", "#edaa59", "#b28ee8", "#7ccf92", "#ed7e98"];
        stage("Create class", {
          classes: {
            [id]: { id, name: trimmed, color: colors[document().classes.length % colors.length]! },
          },
        });
        exitEditing();
        return id;
      },
      renameClass(id, name) {
        const item = document().classes.find((value) => value.id === id);
        if (!item) {
          throw new Error("Unknown class");
        }
        const trimmed = checkedName(name);
        if (document().classes.some((value) => value.id !== id && value.name === trimmed)) {
          throw new Error("Class name already exists");
        }
        stage("Rename class", { classes: { [id]: { ...item, name: trimmed } } });
        exitEditing();
      },
      deleteClass(id) {
        if (!document().classes.some((item) => item.id === id)) {
          throw new Error("Unknown class");
        }
        const instances = Object.fromEntries(
          document()
            .instances.filter((instance) => instance.classId === id)
            .map((instance) => [instance.id, undefined]),
        );
        stage(
          "Delete class and instances",
          { classes: { [id]: undefined }, instances },
          { exitEditing: true },
        );
      },
      renameInstance(id, name) {
        const instance = document().instances.find((item) => item.id === id);
        if (!instance) {
          throw new Error("Unknown instance");
        }
        stage("Rename instance", { instances: { [id]: { ...instance, name: checkedName(name) } } });
        exitEditing();
      },
      mergeClasses(sourceIds, targetClassId) {
        if (!document().classes.some((item) => item.id === targetClassId)) {
          throw new Error("Unknown target class");
        }
        const sources = sourceIds.filter((id) => id !== targetClassId);
        if (sources.some((id) => !document().classes.some((item) => item.id === id))) {
          throw new Error("Unknown source class");
        }
        stage(
          "Move class instances",
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
          throw new Error("Unknown class");
        }
        const id = uuidv4();
        stage("Create instance", {
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
          throw new Error("Unknown instance or class");
        }
        stage(
          "Move instance",
          { instances: { [id]: { ...item, classId } } },
          { exitEditing: true },
        );
      },
      deleteInstance(id, scope = "all") {
        if (!document().instances.some((item) => item.id === id)) {
          throw new Error("Unknown instance");
        }
        stage(
          "Delete instance",
          scope === "frame"
            ? { annotations: { [frameInstanceKey(frameId(), id)]: undefined } }
            : { instances: { [id]: undefined } },
          { exitEditing: true },
        );
      },
      addPolygon(instanceId, points = []) {
        validatePoints(points);
        const current = annotation(instanceId);
        const id = uuidv4();
        const frame = document().frames.find((item) => item.id === current.frameId);
        const topic = document().videos.find((item) => item.id === frame?.videoId)?.topic;
        current.polygons.push({
          id,
          points: cloneSegmentation(points),
          ...(topic == undefined ? {} : { topic }),
        });
        stage("Create polygon", {
          annotations: { [frameInstanceKey(current.frameId, instanceId)]: current },
        });
        set({
          focus: { type: "instance", id: instanceId },
          editing: true,
          drawingPolygonId: points.length === 0 ? id : undefined,
        });
        return id;
      },
      retargetEmptyDrawing(targetFrameId) {
        assertEditable();
        const drawingId = get().drawingPolygonId;
        if (drawingId == undefined) {
          throw new Error("No polygon is being drawn");
        }
        const doc = document();
        const target = doc.frames.find((frame) => frame.id === targetFrameId);
        if (!target) {
          throw new Error("Unknown frame");
        }
        if (!loadedFrames.has(targetFrameId)) {
          throw new Error("Wait for frame geometry to load");
        }
        const source = Object.values(doc.annotations).find((item) =>
          item.polygons.some((polygon) => polygon.id === drawingId),
        );
        const polygon = source?.polygons.find((item) => item.id === drawingId);
        if (!source || !polygon) {
          throw new Error("Unknown polygon");
        }
        if (polygon.points.length > 0) {
          throw new Error("Finish the polygon on the current canvas before switching.");
        }
        if (source.frameId !== targetFrameId) {
          const topic = doc.videos.find((video) => video.id === target.videoId)?.topic;
          const { topic: _previous, ...rest } = polygon;
          const moved = topic == undefined ? rest : { ...rest, topic };
          const sourceNext = {
            ...source,
            polygons: source.polygons.filter((item) => item.id !== drawingId),
          };
          const key = frameInstanceKey(targetFrameId, source.instanceId);
          const existing = doc.annotations[key];
          const targetNext = existing
            ? { ...cloneSegmentation(existing), polygons: [...existing.polygons, moved] }
            : {
                frameId: targetFrameId,
                instanceId: source.instanceId,
                polygons: [moved],
              };
          set({ currentFrameId: targetFrameId });
          stage("Choose canvas", {
            annotations: {
              [frameInstanceKey(source.frameId, source.instanceId)]: sourceNext,
              [key]: targetNext,
            },
          });
        } else if (get().currentFrameId !== targetFrameId) {
          set({ currentFrameId: targetFrameId });
        }
        const next = get().document;
        if (next) {
          set({
            drawingPolygonId: drawingId,
            editing: true,
            selection: filterSegmentationSelection(next, get().selection, targetFrameId),
          });
        }
      },
      setPolygonPoints(id, points) {
        validatePoints(points);
        const current = findPolygon(id);
        current.polygons = current.polygons.map((polygon) =>
          polygon.id === id ? { ...polygon, points: cloneSegmentation(points) } : polygon,
        );
        stage("Edit polygon", {
          annotations: { [frameInstanceKey(current.frameId, current.instanceId)]: current },
        });
      },
      commitDrawingMask(mask) {
        const drawingId = get().drawingPolygonId;
        if (drawingId == undefined) {
          throw new Error("No polygon is being drawn");
        }
        const current = findPolygon(drawingId);
        const rest = {
          ...current,
          polygons: current.polygons.filter((polygon) => polygon.id !== drawingId),
        };
        // The clicked mask joins whatever this instance already has on the frame (one geometry).
        const merged = mergeObservations(
          rest.mask || rest.polygons.length > 0 ? rest : undefined,
          { frameId: current.frameId, instanceId: current.instanceId, polygons: [], mask },
          current.instanceId,
        );
        stage("Quick annotate", {
          annotations: {
            [frameInstanceKey(current.frameId, current.instanceId)]: merged,
          },
        });
        set({ drawingPolygonId: undefined });
      },
      deletePolygon(id) {
        const current = findPolygon(id);
        current.polygons = current.polygons.filter((polygon) => polygon.id !== id);
        stage(
          "Delete polygon",
          {
            annotations: { [frameInstanceKey(current.frameId, current.instanceId)]: current },
          },
          { exitEditing: true },
        );
      },
      mergeInstances(sourceIds, targetInstanceId) {
        annotation(targetInstanceId);
        const sources = sourceIds.filter((id) => id !== targetInstanceId);
        if (sources.some((id) => !document().instances.some((item) => item.id === id))) {
          throw new Error("Unknown source instance");
        }
        stage(
          "Merge instances",
          {
            instances: Object.fromEntries(sources.map((id) => [id, undefined])),
            instanceMerges: Object.fromEntries(sources.map((id) => [id, targetInstanceId])),
          },
          { exitEditing: true },
        );
      },
      mergePolygons(polygonIds, targetInstanceId) {
        const target = annotation(targetInstanceId);
        const changes: Record<string, FrameInstance> = {};
        for (const id of polygonIds) {
          const found = findPolygon(id);
          if (found.instanceId === targetInstanceId) {
            continue;
          }
          const key = frameInstanceKey(found.frameId, found.instanceId);
          const source = changes[key] ?? found;
          target.polygons.push(source.polygons.find((polygon) => polygon.id === id)!);
          source.polygons = source.polygons.filter((polygon) => polygon.id !== id);
          changes[key] = source;
        }
        changes[frameInstanceKey(target.frameId, targetInstanceId)] = target;
        stage("Move polygons to instance", { annotations: changes }, { exitEditing: true });
      },
      runTransaction(label, command) {
        assertEditable();
        if (transaction) {
          command();
          return;
        }
        const previous = get();
        const previousRedoStack = redoStack;
        transaction = { id: uuidv4(), label };
        try {
          command();
        } catch (error) {
          redoStack = previousRedoStack;
          set(previous, true);
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
          drawingPolygonId: undefined,
          interactionResetVersion: get().interactionResetVersion + 1,
        });
        rebuild();
      },
      submit(commitMessage = "Update annotations") {
        if (transaction) {
          throw new Error("Submit after the local command completes");
        }
        assertEditable();
        redoStack = [];
        set({ canRedo: false });
        if (get().stagedOperations.length === 0) {
          return undefined;
        }
        const id = uuidv4();
        set({
          submissionQueue: [
            ...get().submissionQueue,
            {
              id,
              message: commitMessage,
              // Stage owns immutable operation/patch values; detach this exact click snapshot first.
              operations: get().stagedOperations,
              status: "queued",
            },
          ],
          stagedOperations: [],
          editing: false,
          drawingPolygonId: undefined,
        });
        startPump();
        return id;
      },
      async waitForSubmissions() {
        while (pumpPromise) {
          await pumpPromise;
        }
      },
      retrySubmission(id) {
        assertEditable();
        const batch = get().submissionQueue.find((item) => item.id === id);
        if (batch?.status !== "failed") {
          throw new Error("Only failed submissions can be retried");
        }
        updateBatch(id, { status: "queued", error: undefined });
        startPump();
      },
      async startPropagation(request) {
        assertEditable();
        if (get().propagationCapabilitiesLoading === true) {
          throw new Error("Wait for propagation capabilities before starting inference");
        }
        if (get().propagationCapabilitiesError != undefined) {
          throw new Error(
            `Propagation capabilities unavailable: ${get().propagationCapabilitiesError}`,
          );
        }
        validatePropagationCapabilities(request, get().propagationCapabilities);
        const initial = document();
        // An opened-but-unedited mask seeds as the mask itself, not its transient polygons.
        const openMask = get().maskEdit;
        const authoritative = (key: string) => {
          const viewed = initial.annotations[key];
          return openMask?.key === key && viewed?.polygons === openMask.polygons
            ? openMask.original
            : viewed;
        };
        const source = authoritative(frameInstanceKey(request.fromFrameId, request.instanceId));
        const sourceFrame = initial.frames.find((frame) => frame.id === request.fromFrameId);
        if (!sourceFrame || (!request.seeds && !source)) {
          throw new Error("Source annotation is not loaded");
        }
        if (
          !/^\d+$/.test(request.endTimeNs) ||
          BigInt(request.endTimeNs) <= BigInt(sourceFrame.logTimeNs)
        ) {
          throw new Error("End time must be later than the seed frame");
        }
        const seeds = resolvePropagationSeeds(request, source?.polygons, source?.mask);
        for (const seed of seeds) {
          const annotation = authoritative(frameInstanceKey(request.fromFrameId, seed.instanceId));
          if (
            !initial.instances.some((instance) => instance.id === seed.instanceId) ||
            (seed.mask != undefined && annotation?.mask?.counts !== seed.mask.counts) ||
            seed.polygons.some(
              (polygon) => annotation?.polygons.some((item) => item.id === polygon.id) !== true,
            )
          ) {
            throw new Error("Selected seed does not belong to the source frame and instance");
          }
        }
        if (seeds.length > 1 && service.supportsMultiInstanceSeeds !== true) {
          throw new Error(
            "This propagation adapter does not support seeds from multiple instances",
          );
        }
        const instanceIds = seeds.map((seed) => seed.instanceId);
        const generation = baseGeneration;
        const context = Object.freeze({
          requestId: uuidv4(),
          recordId: initial.record.id,
          videoId: sourceFrame.videoId,
          instanceId: seeds[0]!.instanceId,
          instanceIds,
          seedSnapshotId: uuidv4(),
          fromFrameId: sourceFrame.id,
          generation,
        });
        const snapshot = cloneSegmentation({
          ...request,
          context,
          seeds,
          instanceId: seeds[0]!.instanceId,
          seedPolygons: seeds[0]!.polygons,
          ...(seeds[0]!.mask ? { seedMask: seeds[0]!.mask } : {}),
        });
        const targets = initial.frames
          .filter(
            (frame) =>
              frame.videoId === sourceFrame.videoId &&
              BigInt(frame.logTimeNs) > BigInt(sourceFrame.logTimeNs) &&
              BigInt(frame.logTimeNs) <= BigInt(request.endTimeNs),
          )
          .sort((a, b) => a.index - b.index);
        const targetIds = new Set(targets.map((frame) => frame.id));
        const received = new Set<string>();
        const receivedFrames = new Map<string, Set<string>>();
        let playbackIndex = 0;
        const controller = new AbortController();
        propagationController = controller;
        const session: PropagationSession = {
          context,
          controller,
          iteratorDone: false,
          stopRequested: false,
          cancelPending: false,
        };
        propagationSession = session;
        const currentContext = () => {
          const current = get();
          return (
            !isDisposed() &&
            !controller.signal.aborted &&
            propagationController === controller &&
            baseGeneration === generation &&
            current.document?.record.id === context.recordId &&
            current.document.frames.some(
              (frame) => frame.id === current.currentFrameId && frame.videoId === context.videoId,
            )
          );
        };
        // Staging is keyed by frame ID; playback waits for missing earlier frames instead of reversing.
        const advancePlayback = async (mode: "contiguous" | "terminal" = "contiguous") => {
          while (playbackIndex < targets.length) {
            const frame = targets[playbackIndex]!;
            if (
              (receivedFrames.get(frame.id)?.size ?? 0) < instanceIds.length &&
              mode !== "terminal"
            ) {
              break;
            }
            if (receivedFrames.has(frame.id)) {
              if (!loadedFrames.has(frame.id)) {
                const duration = initial.videos.find(
                  (video) => video.id === context.videoId,
                )!.durationSec;
                const { startSec, endSec } = annotationWindow(frame.timestampSec, duration);
                try {
                  const geometryWindow = await service.loadFrameWindow(
                    context.videoId,
                    startSec,
                    endSec,
                    controller.signal,
                  );
                  if (!currentContext() || !base) {
                    return;
                  }
                  const frameIds = new Set(
                    initial.frames
                      .filter(
                        (item) =>
                          item.videoId === context.videoId &&
                          item.timestampSec >= startSec &&
                          item.timestampSec <= endSec,
                      )
                      .map((item) => item.id),
                  );
                  if (
                    geometryWindow.videoId !== context.videoId ||
                    geometryWindow.startSec !== startSec ||
                    geometryWindow.endSec !== endSec ||
                    Object.entries(geometryWindow.annotations).some(
                      ([key, annotation]) =>
                        !frameIds.has(annotation.frameId) ||
                        key !== frameInstanceKey(annotation.frameId, annotation.instanceId),
                    )
                  ) {
                    throw new Error("Propagation geometry window belongs to a different context");
                  }
                  // This complete adapter window, not one inferred instance, establishes readiness.
                  base = {
                    ...base,
                    annotations: {
                      ...base.annotations,
                      ...cloneSegmentation(geometryWindow.annotations),
                    },
                  };
                  for (const id of frameIds) {
                    loadedFrames.add(id);
                  }
                  rebuild();
                } catch (error) {
                  if (currentContext()) {
                    set({
                      frameWindowError: {
                        videoId: context.videoId,
                        startSec,
                        endSec,
                        message: message(error),
                      },
                    });
                  }
                  throw error;
                }
              }
              if (!currentContext()) {
                return;
              }
              set({ currentFrameId: frame.id });
              if (!currentContext()) {
                return;
              }
            }
            ++playbackIndex;
          }
        };
        set({
          propagation: { status: "running", processedFrames: 0 },
          editing: false,
          drawingPolygonId: undefined,
          error: undefined,
        });
        const detachContext = store.subscribe(() => {
          if (!currentContext() && !session.stopRequested) {
            requestStop(session);
          }
        });
        let chunkStarted = performance.now();
        let chunkResults = 0;
        try {
          for await (const result of service.propagate(snapshot, controller.signal)) {
            // Async iterators can stay entirely in microtasks. Give STOP and rendering a turn,
            // including during a flood of rejected results, then revalidate before any write.
            if (
              currentContext() &&
              (++chunkResults >= 8 || performance.now() - chunkStarted >= 4)
            ) {
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
              });
              chunkStarted = performance.now();
              chunkResults = 0;
            }
            if (!currentContext()) {
              if (!session.stopRequested) {
                requestStop(session);
              }
              break;
            }
            if (
              !targetIds.has(result.frameId) ||
              !instanceIds.includes(result.instanceId) ||
              (service.supportsPropagationContext === true && !result.context) ||
              (result.context && !_.isEqual(result.context, context)) ||
              received.has(frameInstanceKey(result.frameId, result.instanceId))
            ) {
              continue;
            }
            const annotation: FrameInstance = {
              frameId: result.frameId,
              instanceId: result.instanceId,
              polygons: result.mask ? [] : cloneSegmentation(result.polygons),
              ...(result.mask ? { mask: cloneSegmentation(result.mask) } : {}),
            };
            const key = frameInstanceKey(result.frameId, result.instanceId);
            // Keep a full inference replacement before the target's old geometry is loaded.
            // A delta against an unloaded frame would retain hidden old components on re-read.
            const operation: StagedOperation = {
              id: uuidv4(),
              label: "Propagate frame",
              patch: { annotations: { [key]: annotation } },
            };
            // The current document already includes every surviving queued/staged operation.
            // Rebase, complete window reads and undo still rebuild from the authoritative base.
            const next = applySegmentationPatch(document(), operation.patch);
            received.add(frameInstanceKey(result.frameId, result.instanceId));
            const instances = receivedFrames.get(result.frameId) ?? new Set<string>();
            instances.add(result.instanceId);
            receivedFrames.set(result.frameId, instances);
            // Publish the accepted result atomically: a subscriber may synchronously STOP or
            // change context. Nothing from this result may be written after that callback.
            redoStack = [];
            set({
              canRedo: false,
              stagedOperations: [...get().stagedOperations, operation],
              document: next,
              ...prunedRefs(next),
              propagation: { status: "running", processedFrames: receivedFrames.size },
              error: undefined,
            });
            if (!currentContext()) {
              if (!session.stopRequested) {
                requestStop(session);
              }
              break;
            }
            await advancePlayback();
          }
          if (!isDisposed() && propagationController === controller) {
            if (!currentContext()) {
              if (!session.stopRequested) {
                requestStop(session);
              }
            }
            if (!controller.signal.aborted) {
              await advancePlayback("terminal");
            }
            if (!controller.signal.aborted) {
              set({
                propagation: {
                  ...get().propagation,
                  status: "completed",
                },
              });
            }
            if (!controller.signal.aborted && get().currentFrameId) {
              get().setCurrentFrame(get().currentFrameId!);
            }
          }
        } catch (error) {
          if (!isDisposed() && propagationController === controller && !controller.signal.aborted) {
            const failure = `传播请求 ${context.requestId} 失败：${message(error)}。已接收的部分结果保留在本地暂存，尚未提交；控件已解锁，可检查后提交或清除暂存。`;
            set({
              propagation: {
                ...get().propagation,
                status: "failed",
                error: failure,
              },
              error: failure,
            });
          }
        } finally {
          detachContext();
          session.iteratorDone = true;
          if (session.stopRequested && !service.cancelPropagation) {
            acknowledgeStop(session);
          }
        }
      },
      stopPropagation() {
        if (propagationSession) {
          requestStop(propagationSession);
        }
      },
      addMomentReference(momentId, targetType, targetId) {
        const exists =
          targetType === "class"
            ? document().classes.some((item) => item.id === targetId)
            : document().instances.some((item) => item.id === targetId);
        if (!exists) {
          throw new Error("Reference target does not exist");
        }
        const id = uuidv4();
        const videoId = document().frames.find((frame) => frame.id === frameId())!.videoId;
        stage("Reference annotation in moment", {
          momentReferences: {
            [id]: { id, momentId, targetType, targetId, recordId: document().record.id, videoId },
          },
        });
        return id;
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
        propagationController?.abort();
      },
    };
  });
  return store;
}
