// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useStore } from "zustand";

import { segmentationSession } from "./runtime";
import { segmentationCanvasLabel, segmentationChrome } from "./segmentationChrome";
import { SOURCE_FRAME_WINDOW_NS, sourceFrameLoaders } from "./sourceFrames";
import type { SegmentationFrame } from "./types";

/** Frames shown on each side of the current frame in a camera's mini timeline. */
export const CAMERA_STRIP_RADIUS = 20;

type TimedFrame = Pick<SegmentationFrame, "id" | "logTimeNs">;

/**
 * One camera's frames in log-time order, one entry per log time.
 * Streams can deliver messages out of order, so array order is never trusted.
 */
export function sortCameraFrames<T extends TimedFrame>(frames: readonly T[]): T[] {
  const byTime = new Map<string, T>();
  for (const frame of frames) {
    if (!byTime.has(frame.logTimeNs)) {
      byTime.set(frame.logTimeNs, frame);
    }
  }
  return [...byTime.values()].sort((a, b) => {
    const delta = BigInt(a.logTimeNs) - BigInt(b.logTimeNs);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  });
}

export type CameraStripCell = {
  offset: number;
  frameId?: string;
  logTimeNs?: string;
  /**
   * `unloaded`: the source has not been read here yet, so presence is unknown.
   * `outside`: the recording has no frame here.
   */
  state: "annotated" | "empty" | "unloaded" | "outside";
};

/**
 * The cells of a camera's mini timeline around `currentFrameId`.
 * A neighbour is listed only when every source window between it and the current frame has
 * been read, so a gap in the cache is shown as unknown rather than skipped over.
 */
export function cameraFrameStrip({
  frames,
  currentFrameId,
  isAnnotated,
  isLoaded,
  radius = CAMERA_STRIP_RADIUS,
}: {
  /** Every known frame of this camera, in any order. */
  frames: readonly TimedFrame[];
  currentFrameId: string;
  isAnnotated: (frameId: string) => boolean;
  /** Whether all frames with log times in `[fromNs, toNs]` are known. Undefined: unknown everywhere. */
  isLoaded?: (fromNs: bigint, toNs: bigint) => boolean;
  radius?: number;
}): CameraStripCell[] {
  const sorted = sortCameraFrames(frames);
  const center = sorted.findIndex((frame) => frame.id === currentFrameId);
  const cells: CameraStripCell[] = [];
  if (center < 0) {
    return cells;
  }
  const cell = (offset: number, frame: TimedFrame): CameraStripCell => ({
    offset,
    frameId: frame.id,
    logTimeNs: frame.logTimeNs,
    state: isAnnotated(frame.id) ? "annotated" : "empty",
  });
  const side = (direction: 1 | -1): CameraStripCell[] => {
    const result: CameraStripCell[] = [];
    let previous = sorted[center]!;
    let blocked: CameraStripCell["state"] | undefined;
    for (let step = 1; step <= radius; step++) {
      const offset = step * direction;
      if (blocked) {
        result.push({ offset, state: blocked });
        continue;
      }
      const candidate = sorted[center + offset];
      const here = BigInt(previous.logTimeNs);
      if (candidate) {
        const there = BigInt(candidate.logTimeNs);
        const covered =
          isLoaded?.(direction > 0 ? here : there, direction > 0 ? there : here) ?? false;
        if (covered) {
          result.push(cell(offset, candidate));
          previous = candidate;
          continue;
        }
        blocked = "unloaded";
      } else {
        // Nothing listed beyond here. It is the recording's edge only if the rest has been read.
        const edge =
          direction > 0
            ? isLoaded?.(here, BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000_000n)
            : isLoaded?.(0n, here);
        blocked = edge === true ? "outside" : "unloaded";
      }
      result.push({ offset, state: blocked });
    }
    return direction > 0 ? result : result.reverse();
  };
  cells.push(...side(-1), cell(0, sorted[center]!), ...side(1));
  return cells;
}

/**
 * The log time `count` frames before or after `currentNs` on one camera, or undefined when the
 * camera has no frame there. `currentNs` need not be a listed frame.
 */
export function cameraStepTarget(
  frames: readonly TimedFrame[],
  currentNs: bigint,
  direction: 1 | -1,
  count: number,
): bigint | undefined {
  const times = sortCameraFrames(frames).map((frame) => BigInt(frame.logTimeNs));
  if (direction > 0) {
    const after = times.filter((time) => time > currentNs);
    return after.length === 0 ? undefined : after[Math.min(count, after.length) - 1];
  }
  const before = times.filter((time) => time < currentNs);
  return before.length === 0 ? undefined : before[Math.max(0, before.length - count)];
}

/** The camera the playback bar steps while annotating: the canvas that receives edits. */
export type CameraStepCamera = { panelId: string; label: string; topic?: string };

export function segmentationStepCamera(): CameraStepCamera | undefined {
  const session = segmentationSession.getState();
  if (!session.open || session.panelId == undefined || !session.runtime) {
    return undefined;
  }
  const topic = segmentationChrome
    .getState()
    .canvases.find((canvas) => canvas.panelId === session.panelId)?.topic;
  return { panelId: session.panelId, topic, label: segmentationCanvasLabel(topic) };
}

/**
 * A step requested while the canvas still showed `fromNs`. Until another frame is shown, repeated
 * presses continue from the requested frame instead of repeating the same step.
 */
let pendingStep: { videoId: string; fromNs: bigint; ns: bigint } | undefined;

/**
 * Steps the target camera by whole frames. Returns undefined when no annotation session is open,
 * so the caller keeps its own behavior. Otherwise resolves to the exact log time to seek to, or
 * undefined when the camera cannot move (no frame there, a stroke is in progress, or propagation
 * holds the editor).
 */
export function segmentationCameraStep(
  direction: 1 | -1,
  count = 1,
): Promise<bigint | undefined> | undefined {
  const camera = segmentationStepCamera();
  if (!camera) {
    return undefined;
  }
  const session = segmentationSession.getState();
  const state = session.runtime!.store.getState();
  const document = state.document;
  const frameId = session.surfaces[camera.panelId]?.frameId;
  const shown = document?.frames.find((frame) => frame.id === frameId);
  const busy =
    state.drawingPolygonId != undefined ||
    session.strokeFrameId != undefined ||
    ["running", "stopping"].includes(state.propagation.status);
  if (!document || !shown || busy) {
    return Promise.resolve(undefined);
  }
  const videoId = shown.videoId;
  const shownNs = BigInt(shown.logTimeNs);
  const pending =
    pendingStep?.videoId === videoId && pendingStep.fromNs === shownNs ? pendingStep.ns : undefined;
  const currentNs = pending ?? shownNs;
  const loader = sourceFrameLoaders.get(videoId);
  const ready = loader
    ? direction > 0
      ? loader.ensureFollowing(currentNs, count)
      : loader.ensureRange(currentNs - SOURCE_FRAME_WINDOW_NS, currentNs)
    : Promise.resolve();
  return ready
    .catch(() => undefined)
    .then(() => {
      const frames = (session.runtime!.store.getState().document?.frames ?? []).filter(
        (frame) => frame.videoId === videoId,
      );
      const target = cameraStepTarget(frames, currentNs, direction, count);
      pendingStep = target == undefined ? pendingStep : { videoId, fromNs: shownNs, ns: target };
      return target;
    });
}

type StepModifiers = { altKey: boolean; shiftKey: boolean };

/**
 * The playback bar's back/forward while annotating. Plain = one frame of the target camera,
 * Shift = ten frames. Alt keeps the player's fixed time step (its default length).
 * `handled: false` means the caller runs its own step with `modifiers`.
 */
export function segmentationPlaybackStep(
  direction: 1 | -1,
  event: StepModifiers | undefined,
  seek: (logTimeNs: bigint) => void,
): { handled: true } | { handled: false; modifiers: StepModifiers | undefined } {
  if (segmentationStepCamera() == undefined) {
    return { handled: false, modifiers: event };
  }
  if (event?.altKey === true) {
    return { handled: false, modifiers: { altKey: false, shiftKey: event.shiftKey } };
  }
  void segmentationCameraStep(direction, event?.shiftKey === true ? 10 : 1)?.then((target) => {
    if (target != undefined) {
      seek(target);
    }
  });
  return { handled: true };
}

/** Name of the camera the playback bar steps, or undefined outside an annotation session. */
export function useSegmentationStepLabel(): string | undefined {
  const panelId = useStore(segmentationSession, (session) =>
    session.open && session.runtime ? session.panelId : undefined,
  );
  const topic = useStore(
    segmentationChrome,
    (chrome) => chrome.canvases.find((canvas) => canvas.panelId === panelId)?.topic,
  );
  return panelId == undefined ? undefined : segmentationCanvasLabel(topic);
}

/** Test hook: forget a step that was never displayed. */
export function resetCameraStepForTests(): void {
  pendingStep = undefined;
}
