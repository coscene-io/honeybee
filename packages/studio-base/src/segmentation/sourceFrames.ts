// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, toNanoSec, type Time } from "@foxglove/rostime";
import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { SegmentationError } from "./errors";
import { imageFrameIdentity } from "./imageSource";
import { SEGMENTATION_WINDOW_SEC } from "./segmentationWindow";
import type { SegmentationFrame } from "./types";

/** Frame times are read from the source in windows of this length. */
export const SOURCE_FRAME_WINDOW_NS = BigInt(SEGMENTATION_WINDOW_SEC) * 1_000_000_000n;
const RETRY_AFTER_MS = 5000;

type Stamp = { timestamp: Time; receiveTime: Time };

/**
 * One source frame per message stamp of a camera, in log-time order. The id is the message's own
 * times, so the same message is the same frame whichever path listed it.
 */
export function framesFromStamps(
  videoId: string,
  startNs: bigint,
  stamps: Iterable<Stamp>,
): SegmentationFrame[] {
  return [...stamps]
    .sort((a, b) => Number(toNanoSec(a.receiveTime) - toNanoSec(b.receiveTime)))
    .map((stamp, index) => ({
      id: `${videoId}:${imageFrameIdentity(stamp)}`,
      videoId,
      index,
      timestampSec: Number(toNanoSec(stamp.receiveTime) - startNs) / 1e9,
      logTimeNs: toNanoSec(stamp.receiveTime).toString(),
      imageUrl: "",
    }));
}

/**
 * Lists the frames of one camera from the data source, so stepping, snapping and propagation
 * do not depend on which frames the player happened to display. Reads message times only.
 */
export type SourceFrameLoader = {
  readonly videoId: string;
  /** Registers every frame in the windows that overlap `[fromNs, toNs]`. */
  ensureRange: (fromNs: bigint, toNs: bigint) => Promise<void>;
  /** Reads later windows until `count` frames after `fromNs` are known or the recording ends. */
  ensureFollowing: (fromNs: bigint, count: number) => Promise<void>;
  /**
   * True when every window overlapping `[fromNs, toNs]` has been read, so the document lists all
   * frames there. Times outside the recording count as read: there is nothing more to list.
   */
  isLoaded: (fromNs: bigint, toNs: bigint) => boolean;
  /** Calls `listener` after another window has been read; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

/** The loader of each video bound to an open annotation session (`SegmentationHost.sourceFrames`). */
export type SourceFrameLoaders = {
  get: (videoId: string) => SourceFrameLoader | undefined;
  /**
   * Binds the loader to its video. The latest registration answers `get`; the returned function
   * unbinds it, and the loader registered before it (another panel showing the same video) answers
   * again.
   */
  register: (loader: SourceFrameLoader) => () => void;
  /** Changes whenever `get`, or a bound loader's `isLoaded`, may answer differently. */
  version: () => number;
  /** Calls `listener` after each change of `version`; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
};

export function createSourceFrameLoaders(): SourceFrameLoaders {
  /** Per video, every registered loader in registration order; only the last one is watched. */
  const bound = new Map<string, { loader: SourceFrameLoader; unwatch?: () => void }[]>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version++;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    get: (videoId) => bound.get(videoId)?.at(-1)?.loader,
    register(loader) {
      const stack = bound.get(loader.videoId) ?? [];
      const top = stack.at(-1);
      top?.unwatch?.();
      if (top) {
        top.unwatch = undefined;
      }
      const entry: { loader: SourceFrameLoader; unwatch?: () => void } = {
        loader,
        unwatch: loader.subscribe(changed),
      };
      stack.push(entry);
      bound.set(loader.videoId, stack);
      changed();
      return () => {
        const index = stack.indexOf(entry);
        if (index < 0) {
          return;
        }
        stack.splice(index, 1);
        if (!entry.unwatch) {
          return;
        }
        entry.unwatch();
        entry.unwatch = undefined;
        const next = stack.at(-1);
        if (next) {
          next.unwatch = next.loader.subscribe(changed);
        } else {
          bound.delete(loader.videoId);
        }
        changed();
      };
    },
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createSourceFrameLoader({
  subscribeMessageRange,
  topic,
  videoId,
  startNs,
  endNs,
  register,
  knownLogTimes,
}: {
  subscribeMessageRange: SubscribeMessageRange;
  topic: string;
  videoId: string;
  startNs: bigint;
  endNs: bigint;
  register: (frames: SegmentationFrame[]) => void;
  /** Log times already in the document for this video. */
  knownLogTimes: () => bigint[];
}): SourceFrameLoader {
  const abort = new AbortController();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  const windows = new Map<bigint, Promise<void>>();
  const loaded = new Set<bigint>();
  const listeners = new Set<() => void>();
  const lastWindow = endNs > startNs ? (endNs - startNs) / SOURCE_FRAME_WINDOW_NS : 0n;
  const loadWindow = async (index: bigint): Promise<void> => {
    if (index < 0n || index > lastWindow) {
      return;
    }
    const existing = windows.get(index);
    if (existing) {
      await existing;
      return;
    }
    const from = startNs + index * SOURCE_FRAME_WINDOW_NS;
    const to = from + SOURCE_FRAME_WINDOW_NS - 1n;
    const pending = readStamps(
      subscribeMessageRange,
      topic,
      fromNanoSec(from),
      fromNanoSec(to < endNs ? to : endNs),
      abort.signal,
    ).then((stamps) => {
      if (abort.signal.aborted) {
        return;
      }
      // Marked before registering, so views that re-render on the new frames see the window as read.
      loaded.add(index);
      if (stamps.length > 0) {
        register(framesFromStamps(videoId, startNs, stamps));
      }
      // Also for an empty window: it is now known to hold no frames.
      for (const listener of listeners) {
        listener();
      }
    });
    windows.set(index, pending);
    try {
      await pending;
    } catch (error) {
      // A failed read may succeed later. Hold the failure briefly so playback ticks do not retry it.
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        if (windows.get(index) === pending) {
          windows.delete(index);
        }
      }, RETRY_AFTER_MS);
      retryTimers.add(timer);
      throw error;
    }
  };
  const windowOf = (ns: bigint) => (ns <= startNs ? 0n : (ns - startNs) / SOURCE_FRAME_WINDOW_NS);
  const overlapsRecording = (fromNs: bigint, toNs: bigint) =>
    fromNs <= toNs && fromNs <= endNs && toNs >= startNs;
  return {
    videoId,
    ensureRange: async (fromNs, toNs) => {
      if (!overlapsRecording(fromNs, toNs)) {
        return;
      }
      const loads: Promise<void>[] = [];
      const last = toNs > endNs ? lastWindow : windowOf(toNs);
      for (let index = windowOf(fromNs); index <= last; index++) {
        loads.push(loadWindow(index));
      }
      await Promise.all(loads);
    },
    ensureFollowing: async (fromNs, count) => {
      for (let index = windowOf(fromNs); index <= lastWindow; index++) {
        // Read the next window while this one is read: a step that crosses into it is common, and
        // a serial scan would wait for each read in turn. Its error surfaces when it is awaited.
        if (index + 1n <= lastWindow) {
          loadWindow(index + 1n).catch(() => undefined);
        }
        await loadWindow(index);
        if (abort.signal.aborted) {
          return;
        }
        // Only frames up to the end of this window count: every window from the first to this one
        // is read, while frames known further on (a part visited earlier) may follow a gap.
        const readUntil = startNs + (index + 1n) * SOURCE_FRAME_WINDOW_NS;
        const after = knownLogTimes().filter(
          (time) => time > fromNs && time >= startNs && time <= endNs && time < readUntil,
        ).length;
        if (after >= count) {
          return;
        }
      }
    },
    isLoaded: (fromNs, toNs) => {
      if (!overlapsRecording(fromNs, toNs)) {
        return true;
      }
      const last = toNs > endNs ? lastWindow : windowOf(toNs);
      for (let index = windowOf(fromNs); index <= last; index++) {
        if (!loaded.has(index)) {
          return false;
        }
      }
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      listeners.clear();
      abort.abort();
      for (const timer of retryTimers) {
        clearTimeout(timer);
      }
      retryTimers.clear();
    },
  };
}

/**
 * Collects the stamps of `topic` messages received within `[start, end]`. The source still
 * deserializes each message; field slicing keeps the image bytes from being copied out to here.
 */
export async function readStamps(
  subscribeMessageRange: SubscribeMessageRange,
  topic: string,
  start: Time,
  end: Time,
  signal: AbortSignal,
): Promise<Stamp[]> {
  return await new Promise<Stamp[]>((resolve, reject) => {
    let settled = false;
    // The callback can finish before subscription setup returns.
    const subscription: { unsubscribe?: () => void } = {};
    const listeners = { abort: () => {} };
    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", listeners.abort);
      subscription.unsubscribe?.();
      settle();
    };
    listeners.abort = () => {
      finish(() => {
        reject(new SegmentationError("errorStampReadCancelled"));
      });
    };
    if (signal.aborted) {
      listeners.abort();
      return;
    }
    signal.addEventListener("abort", listeners.abort);
    const startNs = toNanoSec(start);
    const endNs = toNanoSec(end);
    subscription.unsubscribe = subscribeMessageRange({
      topic,
      timeRange: { start, end },
      // Only the stamps: the source drops the image payload before it leaves its worker.
      payload: { fields: ["header", "timestamp"] },
      onNewRangeIterator: async (iterator) => {
        const stamps: Stamp[] = [];
        try {
          for await (const batch of iterator) {
            for (const message of batch) {
              const receiveNs = toNanoSec(message.receiveTime);
              if (message.topic !== topic || receiveNs < startNs || receiveNs > endNs) {
                continue;
              }
              const value = message.message as {
                timestamp?: Time;
                header?: { stamp: Time };
              };
              stamps.push({
                timestamp: value.header?.stamp ?? value.timestamp ?? message.receiveTime,
                receiveTime: message.receiveTime,
              });
            }
            if (settled) {
              return;
            }
          }
          finish(() => {
            resolve(stamps);
          });
        } catch (error) {
          finish(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }
      },
    });
    if (subscription.unsubscribe == undefined) {
      finish(() => {
        reject(new SegmentationError("errorRangeReadUnsupported"));
      });
    }
  });
}
