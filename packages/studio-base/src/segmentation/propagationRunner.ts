// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { v4 as uuidv4 } from "uuid";

import { SegmentationError, segmentationText, segmentationErrorText } from "./errors";
import { mergeFrameWindow } from "./frameWindows";
import { maskObservation, maskOf, polygonObservation, polygonsOf } from "./maskGeometry";
import { segmentationWindow } from "./segmentationWindow";
import {
  applySegmentationPatch,
  cloneSegmentation,
  frameInstanceKey,
  propagationTargets,
  resolvePropagationSeeds,
  validatePropagationCapabilities,
} from "./service";
import type { StoreInternals } from "./storeInternals";
import type {
  FrameInstance,
  PropagationContext,
  SegmentationStore,
  StagedOperation,
} from "./types";

/**
 * Propagation runs for the store: streams inferred frames into staging (one undo step per run),
 * moves playback along with them, and stops on request or when the context changes.
 */
export function createPropagationRunner(shared: StoreInternals): Pick<
  SegmentationStore,
  "startPropagation" | "stopPropagation"
> & {
  /** After the store is disposed: cancel a running run on the server, abort its stream. */
  dispose: () => void;
} {
  const { service, get, set, isDisposed, rebuild, assertEditable, loadedFrames, document } = shared;
  let propagationController: AbortController | undefined;
  type PropagationSession = {
    context: PropagationContext;
    controller: AbortController;
    iteratorDone: boolean;
    stopRequested: boolean;
    cancelPending: boolean;
  };
  let propagationSession: PropagationSession | undefined;
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
        if (ack.requestId !== session.context.requestId || acknowledgementStatus !== "cancelled") {
          throw new SegmentationError("errorCancelAckMismatch");
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
              error: segmentationErrorText(error),
            },
            error: segmentationErrorText(error),
          });
        }
      });
  }
  return {
    async startPropagation(request) {
      assertEditable();
      if (get().propagationCapabilitiesLoading === true) {
        throw new SegmentationError("errorCapabilitiesPending");
      }
      if (get().propagationCapabilitiesError != undefined) {
        throw new SegmentationError("errorCapabilitiesUnavailable", {
          error: get().propagationCapabilitiesError!,
        });
      }
      validatePropagationCapabilities(request, get().propagationCapabilities);
      const initial = document();
      const source = initial.annotations[frameInstanceKey(request.fromFrameId, request.instanceId)];
      const sourceFrame = initial.frames.find((frame) => frame.id === request.fromFrameId);
      if (!sourceFrame || (!request.seeds && !source)) {
        throw new SegmentationError("errorSourceAnnotationNotLoaded");
      }
      // Forward or backward from the seed, in the order results arrive and playback follows.
      const targets = propagationTargets(initial.frames, sourceFrame, request.endTimeNs);
      const seeds = resolvePropagationSeeds(request, source);
      for (const seed of seeds) {
        const annotation =
          initial.annotations[frameInstanceKey(request.fromFrameId, seed.instanceId)];
        if (
          !initial.instances.some((instance) => instance.id === seed.instanceId) ||
          (seed.kind === "mask"
            ? maskOf(annotation)?.counts !== seed.mask.counts
            : // The same polygon id can hold edited points: compare the geometry, not only ids.
              seed.polygons.some(
                (polygon) =>
                  !polygonsOf(annotation).some(
                    (item) => item.id === polygon.id && _.isEqual(item.points, polygon.points),
                  ),
              ))
        ) {
          throw new SegmentationError("errorSeedMismatch");
        }
      }
      if (seeds.length > 1 && service.supportsMultiInstanceSeeds !== true) {
        throw new SegmentationError("errorMultiInstanceSeedsUnsupported");
      }
      const instanceIds = seeds.map((seed) => seed.instanceId);
      const epoch = shared.documentEpoch();
      const context = Object.freeze({
        requestId: uuidv4(),
        recordId: initial.record.id,
        videoId: sourceFrame.videoId,
        instanceId: seeds[0]!.instanceId,
        instanceIds,
        seedSnapshotId: uuidv4(),
        fromFrameId: sourceFrame.id,
        generation: epoch,
      });
      const snapshot = cloneSegmentation({
        ...request,
        context,
        seeds,
        instanceId: seeds[0]!.instanceId,
      });
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
          // A save acknowledged mid-run (submit, then propagate) is not a context change.
          shared.documentEpoch() === epoch &&
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
              const { startSec, endSec } = segmentationWindow(frame.timestampSec, duration);
              const readStart = shared.saveSeq();
              try {
                const geometryWindow = await service.loadFrameWindow(
                  context.videoId,
                  startSec,
                  endSec,
                  controller.signal,
                );
                const base = shared.base();
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
                  throw new SegmentationError("errorWindowContextMismatch");
                }
                // This complete adapter window, not one inferred instance, establishes readiness.
                shared.setBase(
                  mergeFrameWindow(base, geometryWindow, frameIds, shared.savedAfter(readStart)),
                );
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
                      message: segmentationErrorText(error),
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
        drawing: undefined,
        error: undefined,
      });
      const detachContext = shared.subscribe(() => {
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
          if (currentContext() && (++chunkResults >= 8 || performance.now() - chunkStarted >= 4)) {
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
          // An empty result clears the instance on that frame: the object left the view.
          const annotation: FrameInstance | undefined =
            result.kind === "mask"
              ? maskObservation(result.frameId, result.instanceId, cloneSegmentation(result.mask))
              : result.kind === "polygons"
                ? polygonObservation(
                    result.frameId,
                    result.instanceId,
                    cloneSegmentation(result.polygons),
                  )
                : undefined;
          const key = frameInstanceKey(result.frameId, result.instanceId);
          // Keep a full inference replacement before the target's old geometry is loaded.
          // A delta against an unloaded frame would retain hidden old components on re-read.
          // One run is one undo step, however many frames it filled.
          const operation: StagedOperation = {
            id: uuidv4(),
            labelKey: "opLabelPropagateFrame",
            groupId: context.requestId,
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
          shared.clearRedo();
          set({
            canRedo: false,
            stagedOperations: [...get().stagedOperations, operation],
            document: next,
            ...shared.prunedRefs(next),
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
          const failure = segmentationText("errorPropagationRequestFailed", {
            requestId: context.requestId,
            error: segmentationErrorText(error),
          });
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
    dispose() {
      // The server keeps inferring a run nobody will read; tell it to stop (best effort).
      const session = propagationSession;
      if (
        session &&
        !session.cancelPending &&
        ["running", "stopping"].includes(get().propagation.status) &&
        service.cancelPropagation
      ) {
        session.cancelPending = true;
        void service.cancelPropagation(cloneSegmentation(session.context)).catch(() => undefined);
      }
      propagationController?.abort();
    },
  };
}
