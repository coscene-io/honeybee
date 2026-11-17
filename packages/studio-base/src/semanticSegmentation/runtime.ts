// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

import type { LiveSemanticSegmentationService } from "./liveService";
import { mockMaskProfileFromLocation } from "./mockMasks";
import { createMockSemanticSegmentationService } from "./mockService";
import {
  mergeSourceMetadata,
  sourceMetadataChanges,
  type SemanticSegmentationService,
} from "./service";
import { createSemanticSegmentationStore } from "./store";
import type { SegmentationDocument } from "./types";

export type SegmentationRuntime = {
  store: ReturnType<typeof createSemanticSegmentationStore>;
  service: SemanticSegmentationService;
  initialize: () => Promise<void>;
  registerSource: (source: Pick<SegmentationDocument, "videos" | "frames">) => void;
  dispose: () => void;
};

/** One runtime is shared by the canvas, Space sidebar, workflows and Moment references. */
export function createSegmentationRuntime(
  document?: SegmentationDocument,
  persistence?: { storageKey: string },
  options: {
    identity?: { userId: string; sessionId?: string };
    /**
     * Live client once `createLiveSemanticSegmentationService` returns one.
     * Omitting it keeps annotations for the captured recording in the browser.
     * That store is not the published annotation service.
     */
    service?: SemanticSegmentationService;
  } = {},
): SegmentationRuntime {
  // MOCK masks: only on localhost with an explicit `segMockMasks` URL parameter.
  const mockMasks = options.service ? undefined : mockMaskProfileFromLocation();
  const service: SemanticSegmentationService =
    options.service ??
    createMockSemanticSegmentationService({
      document,
      ...(options.identity ? { identity: options.identity } : {}),
      ...(persistence
        ? {
            storage: {
              getItem: (key: string) => window.localStorage.getItem(key),
              setItem: (key: string, value: string) => {
                window.localStorage.setItem(key, value);
              },
              removeItem: (key: string) => {
                window.localStorage.removeItem(key);
              },
            },
            storageKey: persistence.storageKey,
          }
        : {}),
      ...(mockMasks ? { mockMasks } : {}),
      controls: { delayMs: 500, streamDelayMs: 350 },
    });
  const store = createSemanticSegmentationStore(service);
  let metadata = document ? { videos: document.videos, frames: document.frames } : undefined;
  const originalLoad = service.loadDocument.bind(service);
  service.loadDocument = async (signal) => {
    const loaded = await originalLoad(signal);
    if (metadata) {
      const merged = mergeSourceMetadata(loaded, metadata);
      metadata.videos.splice(0, metadata.videos.length, ...merged.videos);
      metadata.frames.splice(0, metadata.frames.length, ...merged.frames);
      service.updateSourceMetadata?.(metadata);
      return { ...merged, ...metadata };
    }
    return loaded;
  };
  const originalSubmit = service.submit.bind(service);
  service.submit = async (request) => {
    const result = await originalSubmit(request);
    return metadata ? { ...result, document: { ...result.document, ...metadata } } : result;
  };
  // Rebuilds and submission responses may carry an older metadata snapshot. Project only the
  // lightweight presentation table; staged geometry remains untouched.
  // The live service also knows, from ListTimelineRanges, which unloaded frames have geometry.
  // Rebuilds replace the document, so overlay that presence again; loaded geometry wins.
  const timelineSummaries = (service as Partial<LiveSemanticSegmentationService>).timelineSummaries;
  let projectedSummaries: SegmentationDocument["annotationSummaries"] | undefined;
  let projectedTimeline: SegmentationDocument["annotationSummaries"] | undefined;
  const detach = store.subscribe((state) => {
    if (!state.document) {
      return;
    }
    const framesStale = metadata != undefined && state.document.frames !== metadata.frames;
    const timeline = timelineSummaries?.();
    const summariesStale =
      timeline != undefined &&
      (state.document.annotationSummaries !== projectedSummaries || timeline !== projectedTimeline);
    if (!framesStale && !summariesStale) {
      return;
    }
    let annotationSummaries = state.document.annotationSummaries;
    if (summariesStale) {
      const base = Object.fromEntries(
        Object.entries(annotationSummaries).filter(([, summary]) => summary.fromTimeline !== true),
      );
      annotationSummaries = { ...timeline, ...base };
      projectedSummaries = annotationSummaries;
      projectedTimeline = timeline;
    }
    store.setState({ document: { ...state.document, ...metadata, annotationSummaries } });
  });
  // Timeline presence that arrives later (a camera registered after the read) re-runs the overlay.
  const detachTimeline = (service as Partial<LiveSemanticSegmentationService>).subscribeTimeline?.(
    () => {
      const current = store.getState().document;
      if (current) {
        store.setState({ document: { ...current } });
      }
    },
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
      segmentationSession.getState().seek?.(BigInt(frame.logTimeNs));
    }
  };
  const detachFollow = store.subscribe((state, previous) => {
    const running = state.propagation.status === "running";
    const justEnded = previous.propagation.status === "running" && !running;
    if ((!running && !justEnded) || state.currentFrameId === previous.currentFrameId) {
      if (justEnded && followTimer == undefined) {
        followPropagation();
      }
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
            throw new Error(store.getState().error ?? "Unable to initialize source annotations");
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
      if (metadata) {
        metadata.videos.splice(0, metadata.videos.length, ...merged.videos);
        metadata.frames.splice(0, metadata.frames.length, ...merged.frames);
      } else {
        metadata = { videos: merged.videos, frames: merged.frames };
      }
      service.updateSourceMetadata?.(metadata);
      if (store.getState().document) {
        store.setState({ document: { ...store.getState().document!, ...metadata } });
      }
    },
    dispose: () => {
      detach();
      detachFollow();
      if (followTimer != undefined) {
        clearTimeout(followTimer);
      }
      detachTimeline?.();
      store.getState().dispose();
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
  nativeView?: import("./nativeImageTransform").NativeImageView;
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

export const segmentationSession = createStore<{
  runtime: SegmentationRuntime | undefined;
  /** Read-only annotations for the open recording. Editing still uses `runtime`. */
  previewRuntime: SegmentationRuntime | undefined;
  previewLoading: boolean;
  /** Exact displayed frame per topic for the read-only overview. */
  previewFrames: Record<string, string | undefined>;
  open: boolean;
  maximized: boolean;
  imageUrl: string | undefined;
  /** Canvas that receives new edits. Other open canvases stay visible. */
  panelId: string | undefined;
  sourceReady: boolean;
  decodedFrame?: DecodedSegmentationFrame;
  /** Live image panels, keyed by panel id. The instance tree reads every frame listed here. */
  surfaces: Record<string, SegmentationSurface>;
  /** Frame that received the first vertex. Unset while the stroke can still start on any canvas. */
  strokeFrameId?: string;
  presentation?: { id: number; signal: AbortSignal };
  /** The side workflow panel of the in-panel workbench, driven from the panel header menu. */
  workflow: { open: boolean; target?: string; nonce: number };
  /** Moves the player clock to an exact log time. Set by mounted image panels. */
  seek?: (logTimeNs: bigint) => void;
}>(() => ({
  runtime: undefined,
  previewRuntime: undefined,
  previewLoading: false,
  previewFrames: {},
  open: false,
  maximized: false,
  imageUrl: undefined,
  panelId: undefined,
  sourceReady: true,
  surfaces: {},
  workflow: { open: false, nonce: 0 },
}));

/** Opens the side workflow panel of the in-panel workbench, optionally scrolled to a section. */
export function openWorkflowPanel(target?: string): void {
  segmentationSession.setState((session) => ({
    workflow: { open: true, target, nonce: session.workflow.nonce + 1 },
  }));
}

export function activateSegmentationRuntime(runtime: SegmentationRuntime): void {
  segmentationSession.setState({ runtime });
}
