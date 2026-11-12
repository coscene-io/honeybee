// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, toNanoSec, type Time } from "@foxglove/rostime";
import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { imageFrameIdentity } from "./imageSource";
import type { SegmentationFrame } from "./types";

/** Frame times are read from the source in windows of this length. */
export const SOURCE_FRAME_WINDOW_NS = 10_000_000_000n;
const RETRY_AFTER_MS = 5000;

type Stamp = { timestamp: Time; receiveTime: Time };

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
  dispose: () => void;
};

/** The loader of each video bound to an open annotation session. */
export const sourceFrameLoaders = new Map<string, SourceFrameLoader>();

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
  const windows = new Map<bigint, Promise<void>>();
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
      if (abort.signal.aborted || stamps.length === 0) {
        return;
      }
      register(
        stamps.map((stamp) => ({
          id: `${videoId}:${imageFrameIdentity(stamp)}`,
          videoId,
          index: 0,
          timestampSec: Number(toNanoSec(stamp.receiveTime) - startNs) / 1e9,
          logTimeNs: toNanoSec(stamp.receiveTime).toString(),
          imageUrl: "",
        })),
      );
    });
    windows.set(index, pending);
    try {
      await pending;
    } catch (error) {
      // A failed read may succeed later. Hold the failure briefly so playback ticks do not retry it.
      setTimeout(() => {
        if (windows.get(index) === pending) {
          windows.delete(index);
        }
      }, RETRY_AFTER_MS);
      throw error;
    }
  };
  const windowOf = (ns: bigint) => (ns <= startNs ? 0n : (ns - startNs) / SOURCE_FRAME_WINDOW_NS);
  return {
    videoId,
    ensureRange: async (fromNs, toNs) => {
      const loads: Promise<void>[] = [];
      for (let index = windowOf(fromNs); index <= windowOf(toNs); index++) {
        loads.push(loadWindow(index));
      }
      await Promise.all(loads);
    },
    ensureFollowing: async (fromNs, count) => {
      for (let index = windowOf(fromNs); index <= lastWindow; index++) {
        await loadWindow(index);
        if (abort.signal.aborted) {
          return;
        }
        const after = knownLogTimes().filter((time) => time > fromNs).length;
        if (after >= count) {
          return;
        }
      }
    },
    dispose: () => {
      abort.abort();
    },
  };
}

/** Collects the stamps of `topic` messages received within `[start, end]`. */
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
        reject(new Error("帧时间读取已取消"));
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
        reject(new Error("当前数据源不支持按时间段读取帧"));
      });
    }
  });
}
