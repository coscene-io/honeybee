// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import { useStore } from "zustand";

import { segmentationErrorText } from "./errors";
import { segmentationCanvasLabel } from "./segmentationChrome";
import { useSegmentationHost, type SegmentationHost } from "./segmentationHostContext";
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
  return [...byTime.values()].sort((a, b) => compareLogTimeNs(a.logTimeNs, b.logTimeNs));
}

/**
 * Orders two log times written as canonical non-negative decimal nanoseconds without allocating
 * BigInts: a shorter string is a smaller number, and equal lengths compare as text.
 */
function compareLogTimeNs(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
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
  presorted,
}: {
  /** Every known frame of this camera, in any order unless `presorted` is set. */
  frames: readonly TimedFrame[];
  currentFrameId: string;
  isAnnotated: (frameId: string) => boolean;
  /** Whether all frames with log times in `[fromNs, toNs]` are known. Undefined: unknown everywhere. */
  isLoaded?: (fromNs: bigint, toNs: bigint) => boolean;
  radius?: number;
  /** `frames` is already the output of `sortCameraFrames`, and `center` is the current frame's position in it. */
  presorted?: { center: number };
}): CameraStripCell[] {
  const sorted = presorted ? frames : sortCameraFrames(frames);
  const center = presorted
    ? sorted[presorted.center]?.id === currentFrameId
      ? presorted.center
      : -1
    : sorted.findIndex((frame) => frame.id === currentFrameId);
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
type CameraStepCamera = { panelId: string; label: string; topic?: string };

function segmentationStepCamera(host: SegmentationHost): CameraStepCamera | undefined {
  const session = host.session.getState();
  if (!session.open || session.panelId == undefined || !session.runtime) {
    return undefined;
  }
  const topic = host.chrome
    .getState()
    .canvases.find((canvas) => canvas.panelId === session.panelId)?.topic;
  return { panelId: session.panelId, topic, label: segmentationCanvasLabel(topic) };
}

/**
 * A step requested while the canvas still showed `fromNs`, with the player clock at that moment.
 * Until another frame is shown, repeated presses continue from the requested frame instead of
 * repeating the same step.
 */
export type CameraStepState = {
  pending: { videoId: string; fromNs: bigint; ns: bigint; clockNs?: bigint } | undefined;
  /** Identifies the latest step request; an older one that resolves late is dropped. */
  latest: number;
};

export function createCameraStepState(): CameraStepState {
  return { pending: undefined, latest: 0 };
}

function busyEditing(host: SegmentationHost): boolean {
  const session = host.session.getState();
  const state = session.runtime?.store.getState();
  return (
    state == undefined ||
    state.drawing != undefined ||
    session.strokeFrameId != undefined ||
    ["running", "stopping"].includes(state.propagation.status)
  );
}

function reportStepError(host: SegmentationHost, error: unknown): void {
  host.session.getState().runtime?.store.setState({
    error: t("segmentation:frameStepFailed", {
      error: segmentationErrorText(error),
    }),
  });
}

/**
 * Steps the target camera by whole frames. Returns undefined when no annotation session is open,
 * so the caller keeps its own behavior. Otherwise resolves to the exact log time to seek to, or
 * undefined when the camera cannot move (no frame there, a stroke is in progress, or propagation
 * holds the editor).
 */
export function segmentationCameraStep(
  host: SegmentationHost,
  direction: 1 | -1,
  count = 1,
  /**
   * The player clock. While the camera shows no frame for it (after a seek, e.g. to the recording
   * start before any camera frame), the step starts here: the surface still names the last frame
   * it showed, which may be far away.
   */
  clockNs?: bigint,
  isPlaybackCurrent?: () => boolean,
): Promise<bigint | undefined> | undefined {
  const camera = segmentationStepCamera(host);
  if (!camera) {
    return undefined;
  }
  const session = host.session.getState();
  const runtime = session.runtime!;
  const state = runtime.store.getState();
  const document = state.document;
  const surface = session.surfaces[camera.panelId];
  const shown = document?.frames.find((frame) => frame.id === surface?.frameId);
  const busy = busyEditing(host);
  const videoId =
    shown?.videoId ??
    (camera.topic == undefined
      ? undefined
      : document?.videos.find((video) => video.topic === camera.topic)?.id);
  // No decoded frame for the clock: the surface's frameId is the last frame shown, not this one.
  const fromClock = clockNs != undefined && (surface?.sourceReady !== true || !shown);
  if (!document || videoId == undefined || (!shown && !fromClock) || busy) {
    return Promise.resolve(undefined);
  }
  const shownNs = shown ? BigInt(shown.logTimeNs) : undefined;
  const { cameraStep } = host;
  const pending =
    cameraStep.pending?.videoId === videoId &&
    cameraStep.pending.fromNs === shownNs &&
    (clockNs == undefined ||
      clockNs === cameraStep.pending.ns ||
      clockNs === cameraStep.pending.clockNs)
      ? cameraStep.pending
      : undefined;
  let currentNs: bigint;
  if (fromClock) {
    // A step still decoding keeps going from its target; any other clock is a seek elsewhere.
    currentNs = pending?.ns ?? clockNs;
  } else {
    currentNs = pending?.ns ?? shownNs!;
  }
  const request = ++cameraStep.latest;
  const shownFrameId = surface?.frameId;
  const loader = host.sourceFrames.get(videoId);
  const ready = loader
    ? direction > 0
      ? loader.ensureFollowing(currentNs, count)
      : loader.ensurePreceding(currentNs, count)
    : Promise.resolve();
  const stillCurrent = () => {
    const live = host.session.getState();
    const shownSurface = live.surfaces[camera.panelId];
    return (
      request === cameraStep.latest &&
      live.open &&
      live.runtime === runtime &&
      live.panelId === camera.panelId &&
      shownSurface?.frameId === shownFrameId &&
      shownSurface?.sourceReady === surface?.sourceReady &&
      isPlaybackCurrent?.() !== false &&
      !busyEditing(host)
    );
  };
  return ready
    .catch((error: unknown) => {
      // Step within the frames read so far, but say why it may stop short.
      if (stillCurrent()) {
        reportStepError(host, error);
      }
    })
    .then(() => {
      // The read can take a while. Drop the step when anything it was based on moved meanwhile:
      // a newer step, another session, runtime or edited camera, another shown frame (playback
      // or a seek), or an edit that holds the editor. A late jump would surprise the user.
      if (!stillCurrent()) {
        return undefined;
      }
      const frames = (runtime.store.getState().document?.frames ?? []).filter(
        (frame) => frame.videoId === videoId,
      );
      const target = cameraStepTarget(frames, currentNs, direction, count);
      if (target != undefined) {
        // Without a shown frame there is nothing to key a pending step on; the clock moves instead.
        cameraStep.pending =
          shownNs == undefined
            ? undefined
            : {
                videoId,
                fromNs: shownNs,
                ns: target,
                ...(clockNs != undefined ? { clockNs } : {}),
              };
      }
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
  host: SegmentationHost,
  direction: 1 | -1,
  event: StepModifiers | undefined,
  seek: (logTimeNs: bigint) => void,
  clockNs?: bigint,
  isPlaybackCurrent?: () => boolean,
): { handled: true } | { handled: false; modifiers: StepModifiers | undefined } {
  if (segmentationStepCamera(host) == undefined) {
    return { handled: false, modifiers: event };
  }
  if (event?.altKey === true) {
    return { handled: false, modifiers: { altKey: false, shiftKey: event.shiftKey } };
  }
  void segmentationCameraStep(
    host,
    direction,
    event?.shiftKey === true ? 10 : 1,
    clockNs,
    isPlaybackCurrent,
  )
    ?.then((target) => {
      if (target != undefined && isPlaybackCurrent?.() !== false) {
        seek(target);
      }
    })
    .catch((error: unknown) => {
      reportStepError(host, error);
    });
  return { handled: true };
}

/** Name of the camera the playback bar steps, or undefined outside an annotation session. */
export function useSegmentationStepLabel(): string | undefined {
  const host = useSegmentationHost();
  const panelId = useStore(host.session, (session) =>
    session.open && session.runtime ? session.panelId : undefined,
  );
  const topic = useStore(
    host.chrome,
    (chrome) => chrome.canvases.find((canvas) => canvas.panelId === panelId)?.topic,
  );
  return panelId == undefined ? undefined : segmentationCanvasLabel(topic);
}
