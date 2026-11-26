// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { SegmentationError } from "./errors";
import type { LiveSegmentationService } from "./liveService";
import type { NativeImageView } from "./nativeImageTransform";
import { mergeSourceMetadata, sourceMetadataChanges, type SegmentationService } from "./service";
import { createSegmentationStore, type SegmentationStoreOptions } from "./store";
import type { SegmentationDocument, SubmitRequest } from "./types";

export type SegmentationRuntime = {
  store: ReturnType<typeof createSegmentationStore>;
  service: SegmentationService;
  initialize: () => Promise<void>;
  registerSource: (source: Pick<SegmentationDocument, "videos" | "frames">) => void;
  dispose: () => void;
};

export type SegmentationRuntimeOptions = Pick<SegmentationStoreOptions, "creationToolSetting"> & {
  /** Moves the player clock to an exact log time (the session's mounted image panels). */
  seek?: (logTimeNs: bigint) => void;
};

/** One runtime is shared by the canvas, Space sidebar and workflows. */
export function createSegmentationRuntime(
  /** The live AnnotationService adapter; tests pass the in-memory mock. Never modified. */
  service: SegmentationService,
  /** Source metadata (record, videos, frames) known when the session opens. */
  document?: SegmentationDocument,
  options: SegmentationRuntimeOptions = {},
): SegmentationRuntime {
  // Replaced, never changed in place: its arrays are part of published store state.
  let metadata: Pick<SegmentationDocument, "videos" | "frames"> | undefined = document
    ? { videos: document.videos, frames: document.frames }
    : undefined;
  // The live service also knows, from ListTimelineRanges, which unloaded frames have geometry.
  const timelineSummaries = (service as Partial<LiveSegmentationService>).timelineSummaries;
  let projected:
    | {
        summaries: SegmentationDocument["annotationSummaries"];
        timeline: SegmentationDocument["annotationSummaries"];
      }
    | undefined;
  /**
   * Rebuilds and submission responses may carry an older metadata snapshot: project the source
   * tables, and the timeline's presence for unloaded frames (loaded geometry wins). Staged
   * geometry is untouched. Returns the same document when it is already projected.
   */
  const project = (doc: SegmentationDocument): SegmentationDocument => {
    const framesStale =
      metadata != undefined && (doc.frames !== metadata.frames || doc.videos !== metadata.videos);
    const timeline = timelineSummaries?.();
    const summariesStale =
      timeline != undefined &&
      (doc.annotationSummaries !== projected?.summaries || timeline !== projected.timeline);
    if (!framesStale && !summariesStale) {
      return doc;
    }
    let annotationSummaries = doc.annotationSummaries;
    if (summariesStale) {
      const loaded = Object.fromEntries(
        Object.entries(annotationSummaries).filter(([, summary]) => summary.fromTimeline !== true),
      );
      annotationSummaries = { ...timeline, ...loaded };
      projected = { summaries: annotationSummaries, timeline };
    }
    return { ...doc, ...metadata, annotationSummaries };
  };
  // The store reads the service through this view, which adds the known source metadata. The
  // required methods are forwarded to `service` when they are called. Optional members (flags and
  // methods a service may not offer) are taken as the service has them now: the runtime is created
  // once the service is complete.
  const storeService: SegmentationService = {
    supportsPropagationContext: service.supportsPropagationContext,
    supportsMultiInstanceSeeds: service.supportsMultiInstanceSeeds,
    supportsInstanceMerge: service.supportsInstanceMerge,
    updateSourceMetadata: service.updateSourceMetadata?.bind(service),
    getPropagationCapabilities: service.getPropagationCapabilities?.bind(service),
    cancelPropagation: service.cancelPropagation?.bind(service),
    dispose: service.dispose?.bind(service),
    releaseFrames: service.releaseFrames?.bind(service),
    segmentFrame: service.segmentFrame?.bind(service),
    loadFrameWindow: async (videoId, startSec, endSec, signal) =>
      await service.loadFrameWindow(videoId, startSec, endSec, signal),
    propagate: (request, signal) => service.propagate(request, signal),
    loadDocument: async (signal?: AbortSignal) => {
      const loaded = await service.loadDocument(signal);
      if (!metadata) {
        return loaded;
      }
      const merged = mergeSourceMetadata(loaded, metadata);
      metadata = { videos: merged.videos, frames: merged.frames };
      service.updateSourceMetadata?.(metadata);
      return { ...merged, ...metadata };
    },
    submit: async (request: SubmitRequest) => {
      const result = await service.submit(request);
      return metadata ? { ...result, document: { ...result.document, ...metadata } } : result;
    },
  };
  const { seek: _seek, ...storeOptions } = options;
  const store = createSegmentationStore(storeService, {
    ...storeOptions,
    projectDocument: project,
  });
  const reproject = () => {
    const current = store.getState().document;
    const next = current ? project(current) : undefined;
    if (next && next !== current) {
      store.setState({ document: next });
    }
  };
  // Timeline presence that arrives later (a camera registered after the read) re-runs the overlay.
  const detachTimeline = (service as Partial<LiveSegmentationService>).subscribeTimeline?.(
    reproject,
  );
  // While propagating, the store moves its current frame to each result; move the player too,
  // so every camera shows the frame being filled in. At most one seek per second: results arrive
  // in bursts, and an H.264 seek needs time to find a keyframe and decode before it shows a mask.
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFollowAt = 0;
  const followPropagation = () => {
    followTimer = undefined;
    lastFollowAt = performance.now();
    const state = store.getState();
    const frame = state.document?.frames.find((item) => item.id === state.currentFrameId);
    if (frame) {
      options.seek?.(BigInt(frame.logTimeNs));
    }
  };
  const detachFollow = store.subscribe((state, previous) => {
    const running = state.propagation.status === "running";
    const justEnded = previous.propagation.status === "running" && !running;
    if (justEnded) {
      // Seek to the last result now. A throttled seek still waiting would fire after the
      // unlocked image panel has already pulled the current frame back to the picture it shows,
      // so a run whose results arrive in one burst would end a frame from its seed.
      if (followTimer != undefined) {
        clearTimeout(followTimer);
      }
      followPropagation();
      return;
    }
    if (!running || state.currentFrameId === previous.currentFrameId) {
      return;
    }
    if (followTimer != undefined) {
      return;
    }
    const wait = Math.max(0, 1000 - (performance.now() - lastFollowAt));
    followTimer = setTimeout(followPropagation, wait);
  });
  let initialized: Promise<void> | undefined;
  return {
    store,
    service,
    initialize: async () => {
      await (initialized ??= store
        .getState()
        .initialize()
        .then(() => {
          if (!store.getState().document) {
            const failure = store.getState().error;
            throw failure != undefined
              ? new Error(failure)
              : new SegmentationError("errorInitializeFailed");
          }
        })
        .catch((error: unknown) => {
          initialized = undefined;
          throw error;
        }));
    },
    registerSource: (source: Pick<SegmentationDocument, "videos" | "frames">) => {
      const current = store.getState().document ?? document;
      if (!current) {
        return;
      }
      // Image panels register on every rendered frame. Publishing an unchanged table would replace
      // the document, redraw every mask layer and so render again: a frame loop for the session.
      if (
        current.frames === metadata?.frames &&
        current.videos === metadata.videos &&
        !sourceMetadataChanges(metadata, source)
      ) {
        return;
      }
      const merged = mergeSourceMetadata(current, source);
      // Masks are bound to the size they were read at; a camera that now decodes at another size
      // must have its loaded frames read and classified again.
      const resized = current.videos.some((video) => {
        const next = merged.videos.find((item) => item.id === video.id);
        return (
          video.width != undefined &&
          video.height != undefined &&
          (next?.width !== video.width || next.height !== video.height)
        );
      });
      metadata = { videos: merged.videos, frames: merged.frames };
      service.updateSourceMetadata?.(metadata);
      reproject();
      if (resized && store.getState().document != undefined) {
        void store.getState().initialize();
      }
    },
    dispose: () => {
      detachFollow();
      if (followTimer != undefined) {
        clearTimeout(followTimer);
      }
      detachTimeline?.();
      store.getState().dispose();
      service.dispose?.();
    },
  };
}

/** Provenance of pixels accepted by the real Image Panel bridge, not a relabelled frame URL. */
export type DecodedSegmentationFrame = {
  recordId: string;
  videoId: string;
  frameId: string;
  panelId: string;
  bindingKey: string;
  bindingGeneration: number;
  seekTime: number;
  decodedIdentity: object;
  imageUrl: string;
  nativeView?: NativeImageView;
  nativeCanvas?: HTMLCanvasElement;
  presentation?: { id: number; signal: AbortSignal };
};

/** One image panel's view of the shared record session. */
export type SegmentationSurface = {
  frameId?: string;
  imageUrl?: string;
  sourceReady: boolean;
  decodedFrame?: DecodedSegmentationFrame;
};

export type SegmentationSessionState = {
  runtime: SegmentationRuntime | undefined;
  /** Read-only annotations for the open recording. Editing still uses `runtime`. */
  previewRuntime: SegmentationRuntime | undefined;
  previewLoading: boolean;
  /** Exact displayed frame per topic for the read-only overview. */
  previewFrames: Record<string, string | undefined>;
  open: boolean;
  /** Canvas that receives new edits. Other open canvases stay visible. */
  panelId: string | undefined;
  /** The panel holding the edit: its frame is ready to edit. Mirrors its surface. */
  sourceReady: boolean;
  /** Live image panels, keyed by panel id. The instance tree reads every frame listed here. */
  surfaces: Record<string, SegmentationSurface>;
  /** Frame that received the first vertex. Unset while the stroke can still start on any canvas. */
  strokeFrameId?: string;
  presentation?: { id: number; signal: AbortSignal };
  /** The side workflow panel of the in-panel workbench, driven from the panel header menu. */
  workflow: { open: boolean; target?: string; nonce: number };
  /** Moves the player clock to an exact log time. Set by mounted image panels. */
  seek?: (logTimeNs: bigint) => void;
};

export type SegmentationSession = StoreApi<SegmentationSessionState>;

/** A fresh session: nothing open, no runtime. One per `SegmentationHost`. */
export function createSegmentationSession(): SegmentationSession {
  return createStore<SegmentationSessionState>(() => ({
    runtime: undefined,
    previewRuntime: undefined,
    previewLoading: false,
    previewFrames: {},
    open: false,
    panelId: undefined,
    sourceReady: true,
    surfaces: {},
    workflow: { open: false, nonce: 0 },
  }));
}

/** Opens the side workflow panel of the in-panel workbench, optionally scrolled to a section. */
export function openWorkflowPanel(session: SegmentationSession, target?: string): void {
  session.setState((state) => ({
    workflow: { open: true, target, nonce: state.workflow.nonce + 1 },
  }));
}

/** Leaves segmentation: every canvas closes; staged edits stay in the runtime. */
export function endSegmentationSession(session: SegmentationSession): void {
  session.setState({ open: false, sourceReady: false });
}

export function activateSegmentationRuntime(
  session: SegmentationSession,
  runtime: SegmentationRuntime,
): void {
  session.setState({ runtime });
}

/** Work the user would lose if the runtime went away: staged or unsaved edits, or a running run. */
function holdsUnsavedWork(runtime: SegmentationRuntime): boolean {
  const state = runtime.store.getState();
  return (
    state.stagedOperations.length > 0 ||
    state.submissionQueue.some((batch) => batch.status !== "succeeded") ||
    state.propagation.status === "running" ||
    state.propagation.status === "stopping"
  );
}

type HeldRuntime = {
  runtime: SegmentationRuntime;
  holders: Set<string>;
  /** Stops forwarding the runtime's changes to the registry's subscribers. */
  unwatch: () => void;
  /** Set while the runtime has no holder but unsaved work: collects it once that is saved. */
  awaitClean?: () => void;
};

/**
 * The runtimes of a session, shared between image panels. A runtime is keyed by user, recording and
 * backend; panels (holders) acquire and release it, and it is disposed once nobody holds it and it
 * has no unsaved work. One registry per `SegmentationHost`.
 */
export type SegmentationRegistry = {
  /**
   * The shared runtime for `key`, created on first use. `holder` (an image panel) holds it until it
   * releases it or acquires another key. A runtime nobody holds is disposed, once it has no unsaved
   * work; until then a holder that comes back gets it again.
   */
  acquire: (
    key: string,
    holder: string,
    create: () => SegmentationRuntime,
  ) => { runtime: SegmentationRuntime; created: boolean };
  /**
   * Drop what `holder` holds. Collection waits a microtask, so a panel that remounts in the same
   * commit (a layout change, StrictMode) keeps its runtime.
   */
  release: (holder: string) => void;
  /**
   * Whether any runtime holds work the user has not saved: staged edits, a batch that has not
   * succeeded, or a running propagation. A page unload would lose it.
   */
  hasUnsavedWork: () => boolean;
  /** Calls `listener` whenever `hasUnsavedWork` may answer differently; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** Runtimes alive in the registry, for diagnostics and tests. */
  heldCount: () => number;
  /** Disposes every runtime, unsaved work included: the registry's owner is going away. */
  dispose: () => void;
};

export function createSegmentationRegistry(session: SegmentationSession): SegmentationRegistry {
  const heldRuntimes = new Map<string, HeldRuntime>();
  const holderKeys = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  function collect(key: string): void {
    const held = heldRuntimes.get(key);
    if (!held) {
      return;
    }
    if (held.holders.size > 0) {
      held.awaitClean?.();
      held.awaitClean = undefined;
      return;
    }
    if (holdsUnsavedWork(held.runtime)) {
      // Staged edits outlive their canvases (see endSegmentationSession); keep them until saved.
      held.awaitClean ??= held.runtime.store.subscribe(() => {
        if (!holdsUnsavedWork(held.runtime)) {
          collect(key);
        }
      });
      return;
    }
    discard(key, held);
  }

  function discard(key: string, held: HeldRuntime): void {
    held.awaitClean?.();
    held.awaitClean = undefined;
    heldRuntimes.delete(key);
    const current = session.getState();
    if (current.runtime === held.runtime || current.previewRuntime === held.runtime) {
      session.setState({
        ...(current.runtime === held.runtime ? { runtime: undefined, open: false } : {}),
        ...(current.previewRuntime === held.runtime ? { previewRuntime: undefined } : {}),
      });
    }
    held.unwatch();
    held.runtime.dispose();
    notify();
  }

  const release = (holder: string): void => {
    const key = holderKeys.get(holder);
    if (key == undefined) {
      return;
    }
    holderKeys.delete(holder);
    heldRuntimes.get(key)?.holders.delete(holder);
    queueMicrotask(() => {
      collect(key);
    });
  };

  return {
    acquire(key, holder, create) {
      if (holderKeys.has(holder) && holderKeys.get(holder) !== key) {
        release(holder);
      }
      let held = heldRuntimes.get(key);
      const created = held == undefined;
      if (!held) {
        const runtime = create();
        held = { runtime, holders: new Set(), unwatch: runtime.store.subscribe(notify) };
        heldRuntimes.set(key, held);
        notify();
      }
      held.holders.add(holder);
      holderKeys.set(holder, key);
      collect(key);
      return { runtime: held.runtime, created };
    },
    release,
    hasUnsavedWork: () => [...heldRuntimes.values()].some((held) => holdsUnsavedWork(held.runtime)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    heldCount: () => heldRuntimes.size,
    dispose() {
      holderKeys.clear();
      for (const [key, held] of [...heldRuntimes]) {
        held.holders.clear();
        discard(key, held);
      }
    },
  };
}
