// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { v4 as uuidv4 } from "uuid";
import { createStore, StoreApi } from "zustand";

import { waitForFramePresentation } from "./framePresentation";
import {
  createMockSemanticSegmentationService,
  GPU_IDLE_TIMEOUT_MS,
  MEDIA_CACHE_LIMIT_BYTES,
} from "./mockService";
import {
  applySegmentationPatch,
  applySegmentationPatches,
  cloneSegmentation,
  frameInstanceKey,
  MediaCacheMissError,
  patchAnnotationKeys,
  resolvePropagationSeeds,
  SemanticSegmentationService,
  validateFrameWindow,
  validatePropagationCapabilities,
} from "./service";
import { prepareSubmission } from "./submissionPreparation";
import {
  FrameInstance,
  NormalizedPoint,
  MediaCacheSource,
  PropagationRequest,
  PropagationContext,
  SegmentationDocument,
  SegmentationPatch,
  SegmentationNodeRef,
  SemanticSegmentationStore,
  StagedOperation,
  SubmissionBatch,
  FramePresenter,
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
  let propagationController: AbortController | undefined;
  let framePresenter: FramePresenter | undefined;
  let presentationController: AbortController | undefined;
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
  let revisionEpoch = 0;
  let baseGeneration = 0;
  let rollbackInFlight = false;
  let disposed = false;
  const isDisposed = () => disposed;
  const loadedFrames = new Set<string>();
  const appliedTaskIds = new Set<string>();
  const editVersions = new Map<string, number>();
  let pumpPromise: Promise<void> | undefined;
  let transaction: { id: string; label: string } | undefined;
  // Each entry is one immutable command (possibly several grouped CAS deltas).
  let redoStack: StagedOperation[][] = [];
  const store = createStore<SemanticSegmentationStore>((set, get) => {
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
    function mediaRequest(request: PropagationRequest, source: MediaCacheSource) {
      const entry = get().mediaCache.entries.find(
        (item) =>
          item.videoId === source.videoId &&
          (item.recordId == undefined || item.recordId === source.recordId),
      );
      const cacheKey = request.cacheKey ?? entry?.cacheKey;
      return {
        ...(cacheKey != undefined ? { cacheKey } : {}),
        cacheSource: cloneSegmentation(
          request.cacheSource ?? {
            ...source,
            ...(entry?.sourceKey != undefined ? { sourceKey: entry.sourceKey } : {}),
          },
        ),
      };
    }
    function invalidateMissingMedia(error: unknown): void {
      if (
        !(error instanceof MediaCacheMissError) ||
        get().document?.record.id !== error.source.recordId
      ) {
        return;
      }
      const previous = get().mediaCache;
      const removed = previous.entries.filter(
        (entry) =>
          entry.videoId === error.source.videoId &&
          (entry.recordId == undefined || entry.recordId === error.source.recordId) &&
          (error.cacheKey == undefined || entry.cacheKey === error.cacheKey),
      );
      set({
        mediaCache: {
          ...previous,
          entries: previous.entries.filter((entry) => !removed.includes(entry)),
          usedBytes: Math.max(
            0,
            previous.usedBytes - removed.reduce((total, entry) => total + entry.sizeBytes, 0),
          ),
        },
        ...(get().upload.videoId === error.source.videoId
          ? { upload: { status: "idle", progress: 0, videoId: error.source.videoId } as const }
          : {}),
      });
    }
    function assertEditable() {
      if (isDisposed()) {
        throw new Error("Workbench is disposed");
      }
      if (get().readonly) {
        throw new Error("Historical revisions are read-only");
      }
      if (rollbackInFlight) {
        throw new Error("Wait for revision rollback to finish");
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
      if (!base || get().readonly) {
        return;
      }
      const patches: SegmentationPatch[] = [];
      for (const batch of get().submissionQueue) {
        if (batch.status === "succeeded" || batch.status === "conflict") {
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
      for (const [key, next] of Object.entries(normalized.annotations ?? {})) {
        if (!next) {
          continue;
        }
        const previous = document().annotations[key];
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
      const expectedVersions = Object.fromEntries(
        patchAnnotationKeys(document(), normalized).map((key) => [key, base?.versions[key] ?? 0]),
      );
      const operation: StagedOperation = {
        id: uuidv4(),
        label: transaction?.label ?? label,
        ...(transaction ? { groupId: transaction.id } : {}),
        patch: normalized,
        expectedVersions,
      };
      for (const key of Object.keys(expectedVersions)) {
        editVersions.set(key, (editVersions.get(key) ?? 0) + 1);
      }
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
        let batch = get().submissionQueue.find(
          (item) => item.status === "preparing" || item.status === "queued",
        );
        if (!batch || isDisposed() || !base) {
          return;
        }
        let expectedVersions: Record<string, number>;
        try {
          const id = batch.id;
          updateBatch(id, { status: "preparing", preparationProgress: 0 });
          const prepared = await prepareSubmission(
            batch.operations,
            base,
            (preparationProgress) => {
              if (!isDisposed()) {
                updateBatch(id, { status: "preparing", preparationProgress });
              }
            },
            isDisposed,
          );
          if (isDisposed()) {
            return;
          }
          updateBatch(id, {
            operations: prepared.operations,
            status: "submitting",
            preparationProgress: 1,
          });
          batch = get().submissionQueue.find((item) => item.id === id)!;
          expectedVersions = prepared.expectedVersions;
        } catch (error) {
          if (isDisposed()) {
            return;
          }
          updateBatch(batch.id, { status: "failed", error: message(error) });
          set({ error: message(error) });
          rebuild();
          continue;
        }
        try {
          const result = await service.submit({
            id: batch.id,
            message: batch.message,
            operations: batch.operations,
            expectedVersions,
          });
          if (isDisposed()) {
            return;
          }
          const previousVersions = base.versions;
          base = cloneSegmentation(result.document);
          const nextVersions = base.versions;
          ++baseGeneration;
          // An acknowledgement may arrive after a later local command was undone.
          redoStack = [];
          set({ canRedo: false });
          updateBatch(batch.id, {
            status: result.status,
            conflicts: result.conflicts,
            revisionId: result.revision?.id,
            error:
              result.status === "conflict"
                ? "Frame-instance conflict; this submission was discarded"
                : undefined,
          });
          // Rebase surviving local deltas after this authoritative boundary, never after a background read.
          const rebaseOperation = (operation: StagedOperation): StagedOperation => ({
            ...operation,
            expectedVersions: Object.fromEntries(
              Object.entries(operation.expectedVersions).map(([key, version]) => [
                key,
                version === (previousVersions[key] ?? 0) ? (nextVersions[key] ?? 0) : version,
              ]),
            ),
          });
          set({
            stagedOperations: get().stagedOperations.map(rebaseOperation),
            submissionQueue: get().submissionQueue.map((item) =>
              item.id === batch.id || item.status === "conflict" || item.status === "succeeded"
                ? item
                : { ...item, operations: item.operations.map(rebaseOperation) },
            ),
          });
          if (result.status === "conflict") {
            set({ error: "Frame-instance conflict; only the rejected batch was discarded" });
          }
          if (result.warning) {
            set({ error: result.warning });
          }
          if (result.revision) {
            set({ revisions: [result.revision, ...get().revisions] });
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
            if (
              !isDisposed() &&
              get().submissionQueue.some(
                (batch) => batch.status === "preparing" || batch.status === "queued",
              )
            ) {
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
      return cloneSegmentation(
        document().annotations[frameInstanceKey(frameId(), instanceId)] ?? {
          frameId: frameId(),
          instanceId,
          polygons: [],
          version: 0,
        },
      );
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
      interactionResetVersion: 0,
      stagedOperations: [],
      canRedo: false,
      submissionQueue: [],
      revisions: [],
      viewingRevisionId: undefined,
      readonly: false,
      loading: false,
      frameWindowError: undefined,
      error: undefined,
      gpu: {
        status: "stopped",
        allocated: 0,
        quota: 4,
        connected: false,
        lastActivityAt: 0,
        idleTimeoutMs: GPU_IDLE_TIMEOUT_MS,
      },
      mediaCache: { limitBytes: MEDIA_CACHE_LIMIT_BYTES, usedBytes: 0, entries: [] },
      propagationCapabilities: undefined,
      propagationCapabilitiesError: undefined,
      propagationCapabilitiesLoading: false,
      upload: { status: "idle", progress: 0 },
      propagation: { status: "idle", processedFrames: 0 },
      tasks: [],
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
          const [loaded, revisions] = await Promise.all([
            service.loadDocument(),
            service.listRevisions(),
          ]);
          if (isDisposed() || epoch !== loadEpoch || generation !== baseGeneration) {
            return;
          }
          // A document read omits geometry. Keep loaded windows and redo only when
          // the authoritative metadata, versions and revision head are unchanged.
          const sameBase =
            base != undefined &&
            revisions[0]?.id === get().revisions[0]?.id &&
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
            revisions,
            currentFrameId: first?.id,
            canRedo: redoStack.length > 0,
          });
          rebuild();
          if (first && !loadedFrames.has(first.id)) {
            const startSec = Math.floor(first.timestampSec / 10) * 10;
            await get().loadFrameWindow(
              first.videoId,
              startSec,
              Math.min(
                startSec + 10,
                loaded.videos.find((video) => video.id === first.videoId)?.durationSec ?? 10,
              ),
            );
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
          (get().readonly || loadedFrames.has(id))
        );
      },
      async retryCurrentFrameWindow() {
        assertNavigation();
        if (get().readonly) {
          return;
        }
        const frame = get().document?.frames.find((item) => item.id === get().currentFrameId);
        if (!frame) {
          return;
        }
        const failure = get().frameWindowError;
        const sameRange =
          failure?.videoId === frame.videoId &&
          frame.timestampSec >= failure.startSec &&
          frame.timestampSec <= failure.endSec;
        const start = sameRange ? failure.startSec : Math.floor(frame.timestampSec / 10) * 10;
        const duration = document().videos.find((video) => video.id === frame.videoId)!.durationSec;
        await get().loadFrameWindow(
          frame.videoId,
          start,
          sameRange ? failure.endSec : Math.min(start + 10, duration),
        );
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
          if (
            isDisposed() ||
            controller.signal.aborted ||
            !base ||
            get().readonly ||
            generation !== baseGeneration
          ) {
            return;
          }
          // Refreshes with the same versions are reads, not history boundaries.
          // A changed baseline must never replay an old snapshot with fresh CAS versions.
          if (
            Object.entries(frameWindow.versions).some(
              ([key, version]) => version !== (base!.versions[key] ?? 0),
            )
          ) {
            redoStack = [];
            set({ canRedo: false });
          }
          base = {
            ...base,
            annotations: { ...base.annotations, ...frameWindow.annotations },
            versions: { ...base.versions, ...frameWindow.versions },
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
        if (!get().readonly && !loadedFrames.has(id)) {
          const start = Math.floor(frame.timestampSec / 10) * 10;
          const duration = document().videos.find(
            (video) => video.id === frame.videoId,
          )!.durationSec;
          void get().loadFrameWindow(frame.videoId, start, Math.min(start + 10, duration));
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
                version: 0,
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
        const previousEditVersions = new Map(editVersions);
        const previousAppliedTaskIds = new Set(appliedTaskIds);
        const previousRedoStack = redoStack;
        transaction = { id: uuidv4(), label };
        try {
          command();
        } catch (error) {
          redoStack = previousRedoStack;
          set(previous, true);
          appliedTaskIds.clear();
          for (const id of previousAppliedTaskIds) {
            appliedTaskIds.add(id);
          }
          editVersions.clear();
          for (const [key, value] of previousEditVersions) {
            editVersions.set(key, value);
          }
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
        for (const operation of undone) {
          for (const key of Object.keys(operation.expectedVersions)) {
            editVersions.set(key, (editVersions.get(key) ?? 0) + 1);
          }
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
        for (const operation of operations) {
          for (const key of Object.keys(operation.expectedVersions)) {
            editVersions.set(key, (editVersions.get(key) ?? 0) + 1);
          }
        }
        set({
          stagedOperations: [...get().stagedOperations, ...operations],
          canRedo: redoStack.length > 0,
        });
        exitEditing();
        rebuild();
      },
      revertStaging() {
        assertEditable();
        for (const operation of get().stagedOperations) {
          for (const key of Object.keys(operation.expectedVersions)) {
            editVersions.set(key, (editVersions.get(key) ?? 0) + 1);
          }
        }
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
              status: "preparing",
              preparationProgress: 0,
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
      async viewRevision(id) {
        assertNavigation();
        const epoch = ++revisionEpoch;
        redoStack = [];
        windowController?.abort();
        exitEditing();
        set({
          canRedo: false,
          readonly: id != undefined,
          viewingRevisionId: id,
          loading: true,
          frameWindowError: undefined,
        });
        try {
          if (id) {
            const snapshot = await service.loadRevision(id);
            if (!isDisposed() && epoch === revisionEpoch) {
              set({ document: snapshot, ...prunedRefs(snapshot) });
            }
          } else {
            rebuild();
          }
        } catch (error) {
          if (!isDisposed() && epoch === revisionEpoch) {
            set({ error: message(error), readonly: false, viewingRevisionId: undefined });
            rebuild();
          }
        } finally {
          if (!isDisposed() && epoch === revisionEpoch) {
            set({ loading: false });
          }
        }
      },
      async rollbackRevision(id, expectedHeadRevisionId = get().revisions[0]?.id) {
        assertNavigation();
        if (
          get().stagedOperations.length > 0 ||
          get().submissionQueue.some((batch) =>
            ["preparing", "queued", "submitting", "failed"].includes(batch.status),
          )
        ) {
          throw new Error("Submit or revert local edits before rollback");
        }
        if (rollbackInFlight) {
          throw new Error("A rollback is already running");
        }
        rollbackInFlight = true;
        redoStack = [];
        set({ canRedo: false });
        try {
          const result = await service.rollbackRevision(id, expectedHeadRevisionId);
          if (isDisposed()) {
            return;
          }
          ++revisionEpoch;
          ++baseGeneration;
          base = result.document;
          set({
            readonly: false,
            viewingRevisionId: undefined,
            revisions: result.revision ? [result.revision, ...get().revisions] : get().revisions,
            error: result.warning,
          });
          rebuild();
        } finally {
          rollbackInFlight = false;
        }
      },
      async startGpu() {
        throw new Error("GPU sessions are not part of the annotation contract");
      },
      async stopGpu() {
        throw new Error("GPU sessions are not part of the annotation contract");
      },
      async refreshGpu() {
        throw new Error("GPU sessions are not part of the annotation contract");
      },
      async reconnectGpuStatus() {
        throw new Error("GPU sessions are not part of the annotation contract");
      },
      async uploadMedia() {
        throw new Error("Media upload is not part of the annotation contract");
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
        const source =
          initial.annotations[frameInstanceKey(request.fromFrameId, request.instanceId)];
        const sourceFrame = initial.frames.find((frame) => frame.id === request.fromFrameId);
        if (!sourceFrame || (!request.seeds && !source)) {
          throw new Error("Source annotation is not loaded");
        }
        if (!Number.isInteger(request.frameCount) || request.frameCount < 1) {
          throw new Error("Frame count must be a positive integer");
        }
        const seeds = resolvePropagationSeeds(request, source?.polygons);
        for (const seed of seeds) {
          const annotation =
            initial.annotations[frameInstanceKey(request.fromFrameId, seed.instanceId)];
          if (
            !initial.instances.some((instance) => instance.id === seed.instanceId) ||
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
        const revisionId = get().revisions[0]?.id;
        const context = Object.freeze({
          requestId: uuidv4(),
          recordId: initial.record.id,
          videoId: sourceFrame.videoId,
          instanceId: seeds[0]!.instanceId,
          instanceIds,
          seedSnapshotId: uuidv4(),
          fromFrameId: sourceFrame.id,
          generation,
          ...(revisionId != undefined ? { revisionId } : {}),
        });
        const snapshot = cloneSegmentation({
          ...request,
          context,
          seeds,
          instanceId: seeds[0]!.instanceId,
          seedPolygons: seeds[0]!.polygons,
          ...mediaRequest(request, { recordId: initial.record.id, videoId: sourceFrame.videoId }),
        });
        const targets = initial.frames
          .filter(
            (frame) => frame.videoId === sourceFrame.videoId && frame.index > sourceFrame.index,
          )
          .sort((a, b) => a.index - b.index)
          .slice(0, request.frameCount);
        const targetIds = new Set(targets.map((frame) => frame.id));
        const received = new Set<string>();
        const receivedFrames = new Map<string, Set<string>>();
        let playbackIndex = 0;
        const controller = new AbortController();
        const presenter = framePresenter;
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
            !current.readonly &&
            current.document?.record.id === context.recordId &&
            current.revisions[0]?.id === revisionId &&
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
                const startSec = Math.floor(frame.timestampSec / 10) * 10;
                const duration = initial.videos.find(
                  (video) => video.id === context.videoId,
                )!.durationSec;
                const endSec = Math.min(startSec + 10, duration);
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
                    versions: {
                      ...base.versions,
                      ...Object.fromEntries(
                        Object.entries(geometryWindow.versions).filter(([key]) =>
                          frameIds.has((JSON.parse(key) as [string, string])[0]),
                        ),
                      ),
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
              if (presenter) {
                if (framePresenter !== presenter) {
                  throw new Error(
                    "Native presentation adapter changed during propagation; reopen the Image Panel and retry.",
                  );
                }
                const presentation = new AbortController();
                presentationController = presentation;
                const abort = () => {
                  presentation.abort(controller.signal.reason);
                };
                controller.signal.addEventListener("abort", abort, { once: true });
                try {
                  if (controller.signal.aborted) {
                    abort();
                  }
                  await waitForFramePresentation(presenter, {
                    context: cloneSegmentation(context),
                    frame: cloneSegmentation(frame),
                    signal: presentation.signal,
                  });
                } finally {
                  controller.signal.removeEventListener("abort", abort);
                  presentation.abort();
                  if (presentationController === presentation) {
                    presentationController = undefined;
                  }
                }
                if (!currentContext()) {
                  return;
                }
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
              version: result.version,
              polygons: cloneSegmentation(result.polygons),
            };
            const key = frameInstanceKey(result.frameId, result.instanceId);
            // Keep a full inference replacement before the target's old geometry is loaded.
            // A delta against an unloaded frame would retain hidden old components on re-read.
            const operation: StagedOperation = {
              id: uuidv4(),
              label: "Propagate frame",
              patch: { annotations: { [key]: annotation } },
              expectedVersions: { [key]: base?.versions[key] ?? 0 },
            };
            editVersions.set(key, (editVersions.get(key) ?? 0) + 1);
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
            if (currentContext()) {
              invalidateMissingMedia(error);
            }
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
      registerFramePresenter(presenter) {
        if (
          framePresenter !== presenter &&
          propagationSession &&
          get().propagation.status === "running"
        ) {
          requestStop(propagationSession);
        }
        presentationController?.abort(
          new Error("Frame presentation adapter changed; reopen the Image Panel and retry."),
        );
        framePresenter = presenter;
        return () => {
          if (framePresenter === presenter) {
            framePresenter = undefined;
            if (propagationSession && get().propagation.status === "running") {
              requestStop(propagationSession);
            }
            presentationController?.abort(
              new Error(
                "Frame presentation panel closed; reopen it and retry. Accepted results remain drafts.",
              ),
            );
          }
        };
      },
      async enqueueTask() {
        throw new Error("Offline propagation and export are not part of the annotation contract");
      },
      async refreshTasks() {
        await Promise.resolve();
      },
      async cancelTask() {
        throw new Error("Offline propagation and export are not part of the annotation contract");
      },
      applyTaskResult() {
        throw new Error("Offline propagation and export are not part of the annotation contract");
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
        ++revisionEpoch;
        windowController?.abort();
        propagationController?.abort();
      },
    };
  });
  return store;
}
