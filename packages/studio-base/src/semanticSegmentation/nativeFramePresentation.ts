// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  segmentationSession,
  type DecodedSegmentationFrame,
  type SegmentationRuntime,
} from "./runtime";
import type { FramePresentationRequest, FramePresenter } from "./types";

let presentationSequence = 0;

export type NativeFramePresentation = {
  present: FramePresenter;
  rendered: (frame: DecodedSegmentationFrame) => void;
  failed: (frame: DecodedSegmentationFrame) => void;
  dispose: () => void;
};

/** Coordinates the existing native seek with actual ImageEntry provenance and Canvas commits. */
export function createNativeFramePresentation(
  runtime: SegmentationRuntime,
  panelId: string,
  native: {
    seek: (timestampSec: number) => void;
    seekTime: () => number | undefined;
    atTime: (timestampSec: number) => boolean;
  },
): NativeFramePresentation {
  let pending:
    | {
        request: FramePresentationRequest;
        baseline: DecodedSegmentationFrame;
        marker: { id: number; signal: AbortSignal };
        alreadyDisplayed: boolean;
        finish: (status: "completed" | "failed", error?: unknown) => void;
      }
    | undefined;

  const matches = (frame: DecodedSegmentationFrame) => {
    const current = pending;
    const session = segmentationSession.getState();
    return (
      current != undefined &&
      !current.request.signal.aborted &&
      session.runtime === runtime &&
      session.open &&
      session.panelId === panelId &&
      session.sourceReady &&
      session.decodedFrame === frame &&
      frame.panelId === panelId &&
      frame.bindingKey === current.baseline.bindingKey &&
      frame.bindingGeneration === current.baseline.bindingGeneration &&
      frame.recordId === current.request.context.recordId &&
      frame.videoId === current.request.context.videoId &&
      frame.frameId === current.request.frame.id &&
      frame.presentation === current.marker &&
      (current.alreadyDisplayed || frame.decodedIdentity !== current.baseline.decodedIdentity) &&
      frame.seekTime === native.seekTime() &&
      native.atTime(current.request.frame.timestampSec) &&
      runtime.store.getState().currentFrameId === frame.frameId &&
      runtime.store.getState().document?.record.id === frame.recordId
    );
  };
  return {
    present: async (request) => {
      pending?.finish("failed", new Error("Another frame presentation replaced this request"));
      const session = segmentationSession.getState();
      const baseline = session.decodedFrame;
      if (
        !baseline ||
        session.runtime !== runtime ||
        !session.open ||
        session.panelId !== panelId ||
        baseline.recordId !== request.context.recordId ||
        baseline.videoId !== request.context.videoId
      ) {
        throw new Error(
          "Native frame source is unavailable or changed; reopen the Image Panel and retry propagation.",
        );
      }
      const marker = { id: ++presentationSequence, signal: request.signal };
      const alreadyDisplayed =
        baseline.frameId === request.frame.id && native.atTime(request.frame.timestampSec);
      await new Promise<void>((resolve, reject) => {
        let detach = () => {};
        let settled = false;
        const isCancelled = () => settled || request.signal.aborted;
        const abort = () => {
          finish("failed", request.signal.reason ?? new Error("Frame presentation cancelled"));
        };
        const finish = (status: "completed" | "failed", error?: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          detach();
          request.signal.removeEventListener("abort", abort);
          pending = undefined;
          if (status === "failed" && segmentationSession.getState().presentation === marker) {
            segmentationSession.setState({ presentation: undefined });
          }
          if (status === "failed") {
            reject(error instanceof Error ? error : new Error(String(error)));
          } else {
            resolve();
          }
        };
        pending = { request, baseline, marker, alreadyDisplayed, finish };
        detach = segmentationSession.subscribe((next) => {
          if (
            !next.open ||
            next.runtime !== runtime ||
            next.panelId !== panelId ||
            (next.decodedFrame &&
              (next.decodedFrame.bindingKey !== baseline.bindingKey ||
                next.decodedFrame.bindingGeneration !== baseline.bindingGeneration))
          ) {
            finish("failed", new Error("Native frame source/session changed before presentation"));
          }
        });
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) {
          abort();
          return;
        }
        segmentationSession.setState({ sourceReady: false, presentation: marker });
        if (isCancelled()) {
          return;
        }
        try {
          if (!alreadyDisplayed) {
            native.seek(request.frame.timestampSec);
          }
        } catch (error) {
          finish("failed", error);
        }
      });
    },
    rendered: (frame) => {
      if (matches(frame)) {
        pending?.finish("completed");
      }
    },
    failed: (frame) => {
      if (
        pending &&
        segmentationSession.getState().decodedFrame === frame &&
        frame.frameId === pending.request.frame.id
      ) {
        pending.finish(
          "failed",
          new Error(
            `Frame ${frame.frameId} image could not be rendered; retry the Image Panel. Accepted results remain drafts.`,
          ),
        );
      }
    },
    dispose: () => {
      pending?.finish(
        "failed",
        new Error("Native frame presentation panel unmounted; reopen it to retry."),
      );
    },
  };
}
