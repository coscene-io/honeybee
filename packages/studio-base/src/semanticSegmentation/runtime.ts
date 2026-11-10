// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { createStore } from "zustand/vanilla";

import { createMockSemanticSegmentationService } from "./mockService";
import { mergeSourceMetadata, type SemanticSegmentationService } from "./service";
import { createSemanticSegmentationStore } from "./store";
import type { SegmentationDocument } from "./types";

export type SegmentationRuntime = {
  store: ReturnType<typeof createSemanticSegmentationStore>;
  service: ReturnType<typeof createMockSemanticSegmentationService>;
  initialize: () => Promise<void>;
  registerSource: (source: Pick<SegmentationDocument, "videos" | "frames">) => void;
  dispose: () => void;
};

/** One runtime is shared by the canvas, Space sidebar, workflows and Moment references. */
export function createSegmentationRuntime(
  document?: SegmentationDocument,
  persistence: boolean | { storageKey: string } = false,
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
  const service = (options.service ??
    createMockSemanticSegmentationService({
      document,
      ...(options.identity ? { identity: options.identity } : {}),
      ...(persistence !== false
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
            storageKey:
              typeof persistence === "object"
                ? persistence.storageKey
                : "coStudio.semanticSegmentation.demo.v1",
          }
        : {}),
      controls: { delayMs: 500, streamDelayMs: 350 },
    })) as ReturnType<typeof createMockSemanticSegmentationService>;
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
  const originalRollback = service.rollbackRevision.bind(service);
  service.rollbackRevision = async (...args) => {
    const result = await originalRollback(...args);
    if (metadata) {
      service.updateSourceMetadata?.(metadata);
    }
    return metadata ? { ...result, document: { ...result.document, ...metadata } } : result;
  };
  // Rebuilds and submission responses may carry an older metadata snapshot. Project only the
  // lightweight presentation table; staged geometry and immutable history remain untouched.
  const detach = store.subscribe((state) => {
    if (!metadata || !state.document || state.document.frames === metadata.frames) {
      return;
    }
    store.setState({ document: { ...state.document, ...metadata } });
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
}>(() => ({
  runtime: undefined,
  previewRuntime: undefined,
  previewLoading: false,
  open: false,
  maximized: false,
  imageUrl: undefined,
  panelId: undefined,
  sourceReady: true,
  surfaces: {},
  workflow: { open: false, nonce: 0 },
}));

let demoRuntime: SegmentationRuntime | undefined;
export function getDemoRuntime(): SegmentationRuntime {
  return (demoRuntime ??= createSegmentationRuntime(undefined, true));
}

/** Opens the side workflow panel of the in-panel workbench, optionally scrolled to a section. */
export function openWorkflowPanel(target?: string): void {
  segmentationSession.setState((session) => ({
    workflow: { open: true, target, nonce: session.workflow.nonce + 1 },
  }));
}

export function activateSegmentationRuntime(runtime: SegmentationRuntime): void {
  segmentationSession.setState({ runtime });
}
