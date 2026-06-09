// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { H264, H265, type QueuedVideoFrame, VideoPlayer } from "@foxglove/den/video";
import Logger from "@foxglove/log";
import { isLessThan, Time, toMicroSec, toNanoSec } from "@foxglove/rostime";

import type { CompressedVideo } from "./ImageTypes";

const log = Logger.getLogger(__filename);
const TARGET_FRAME_TIMEOUT_MS = 1000;
const ANY_FRAME_TIMEOUT_MS = 2000;

let videoPlayer: VideoPlayer | undefined;
let initPromise: Promise<void> | undefined;
/** Track the last decoded frame's timestamp to detect out-of-order frames */
let lastDecodeTime: Time = { sec: 0, nsec: 0 };
let activeBatchAbort: (() => void) | undefined;
let streamBaseTimestampMicros: number | undefined;
let lastQueuedTimestampMicros: number | undefined;
let pendingTargetFrame: PendingTargetFrame | undefined;

export type DecodeVideoFrameInput = {
  frame: CompressedVideo;
  receiveTime: bigint;
};

export type DecodeVideoFramesArgs = {
  frames: DecodeVideoFrameInput[];
  requestId: number;
  targetFrameTimeoutMs?: number;
  anyFrameTimeoutMs?: number;
};

export type DecodeVideoFramesResult =
  | {
      type: "TargetFrame" | "IntermediateFrame";
      requestId: number;
      frame: VideoFrame;
      originalTimestamp: bigint;
      receiveTime: bigint;
    }
  | { type: "Timeout" | "Aborted" | "FrameOutOfOrder"; requestId: number };

export type AwaitTargetFrameArgs = {
  requestId: number;
};

export type AwaitTargetFrameResult =
  | {
      type: "TargetFrame";
      requestId: number;
      frame: VideoFrame;
      originalTimestamp: bigint;
      receiveTime: bigint;
    }
  | { type: "Aborted"; requestId: number };

type DecodedVideoFrameResult = {
  frame: VideoFrame;
  originalTimestamp: bigint;
  receiveTime: bigint;
};

type PendingTargetFrame = {
  requestId: number;
  originalTimestamp: bigint;
  receiveTime: bigint;
  retainedFrame?: DecodedVideoFrameResult;
  resolve?: (result: AwaitTargetFrameResult) => void;
};

function getVideoPlayer(): VideoPlayer {
  if (!videoPlayer) {
    videoPlayer = new VideoPlayer();
  }
  return videoPlayer;
}

/**
 * Reset the video player when we detect out-of-order frames (e.g., seek backwards, or a GOP replay
 * on seek that starts before the last decoded frame). Keep the current decoder config so deltas in
 * the replayed GOP don't arrive while the decoder is cold-starting.
 */
function resetVideoPlayerForDisorder(): void {
  log.info("Received out-of-order frame, resetting video decoder");
  videoPlayer?.resetForSeek();
  initPromise = undefined;
  lastDecodeTime = { sec: 0, nsec: 0 };
  streamBaseTimestampMicros = undefined;
  lastQueuedTimestampMicros = undefined;
}

function closeDecodedVideoFrameResult(result: DecodedVideoFrameResult | undefined): void {
  result?.frame.close();
}

function abortPendingTargetFrame(): void {
  const pending = pendingTargetFrame;
  if (pending == undefined) {
    return;
  }
  pendingTargetFrame = undefined;
  closeDecodedVideoFrameResult(pending.retainedFrame);
  pending.resolve?.({ type: "Aborted", requestId: pending.requestId });
}

function retainOrResolveTargetFrame(
  requestId: number,
  decodedFrame: DecodedVideoFrameResult,
): boolean {
  const pending = pendingTargetFrame;
  if (
    pending == undefined ||
    pending.requestId !== requestId ||
    pending.originalTimestamp !== decodedFrame.originalTimestamp ||
    pending.receiveTime !== decodedFrame.receiveTime
  ) {
    return false;
  }

  if (pending.resolve != undefined) {
    pendingTargetFrame = undefined;
    pending.resolve(
      Comlink.transfer({ type: "TargetFrame", requestId, ...decodedFrame }, [
        decodedFrame.frame,
      ]) as AwaitTargetFrameResult,
    );
  } else {
    closeDecodedVideoFrameResult(pending.retainedFrame);
    pending.retainedFrame = decodedFrame;
  }
  return true;
}

async function ensureInitialized(
  player: VideoPlayer,
  frame: CompressedVideo,
  chunkType: "key" | "delta",
): Promise<boolean> {
  if (player.isInitialized()) {
    return true;
  }

  if (initPromise != undefined) {
    await initPromise;
    return player.isInitialized();
  }

  const decoderConfig = getDecoderConfig(frame);
  if (!decoderConfig || chunkType !== "key") {
    return false;
  }

  initPromise = player.init(decoderConfig).finally(() => {
    initPromise = undefined;
  });
  await initPromise;
  return player.isInitialized();
}

async function decodeVideoFrame(frame: CompressedVideo): Promise<VideoFrame | undefined> {
  const result = await decodeVideoFrames({
    frames: [{ frame, receiveTime: 0n }],
    requestId: 0,
  });
  if (result.type === "TargetFrame" || result.type === "IntermediateFrame") {
    return result.frame;
  }
  return undefined;
}

async function decodeVideoFrames(args: DecodeVideoFramesArgs): Promise<DecodeVideoFramesResult> {
  abortPendingTargetFrame();

  const {
    frames,
    requestId,
    targetFrameTimeoutMs = TARGET_FRAME_TIMEOUT_MS,
    anyFrameTimeoutMs = ANY_FRAME_TIMEOUT_MS,
  } = args;
  if (frames.length === 0) {
    return { type: "Timeout", requestId };
  }

  const batchState = { aborted: false, finished: false };
  let finishBatch: ((result: DecodeVideoFramesResult) => void) | undefined;
  const abortThisBatch = () => {
    batchState.aborted = true;
    videoPlayer?.resetForSeek();
    streamBaseTimestampMicros = undefined;
    lastQueuedTimestampMicros = undefined;
    abortPendingTargetFrame();
    finishBatch?.({ type: "Aborted", requestId });
  };
  activeBatchAbort = abortThisBatch;

  try {
    const player = getVideoPlayer();
    const queuedFrames: Array<
      QueuedVideoFrame<{ originalTimestamp: bigint; receiveTime: bigint }>
    > = [];
    let previousBatchFrameTime: Time | undefined;

    for (const entry of frames) {
      if (isBatchAborted(batchState)) {
        return { type: "Aborted", requestId };
      }

      const frame = entry.frame;
      if (
        previousBatchFrameTime != undefined &&
        isLessThan(frame.timestamp, previousBatchFrameTime)
      ) {
        resetVideoPlayerForDisorder();
        return { type: "FrameOutOfOrder", requestId };
      }
      previousBatchFrameTime = frame.timestamp;

      // Detect out-of-order frames (e.g., from seek backwards or GOP replay).
      if (isLessThan(frame.timestamp, lastDecodeTime)) {
        resetVideoPlayerForDisorder();
      }
      lastDecodeTime = frame.timestamp;

      const frameInfo = getVideoFrameInfo(frame);
      if (frameInfo == undefined) {
        continue;
      }

      if (!(await ensureInitialized(player, frame, frameInfo.type))) {
        continue;
      }

      streamBaseTimestampMicros ??= toMicroSec(frame.timestamp);
      let timestampMicros = toMicroSec(frame.timestamp) - streamBaseTimestampMicros;
      if (timestampMicros < 0) {
        resetVideoPlayerForDisorder();
        return { type: "FrameOutOfOrder", requestId };
      }

      if (lastQueuedTimestampMicros != undefined && timestampMicros <= lastQueuedTimestampMicros) {
        timestampMicros = lastQueuedTimestampMicros + 1;
      }
      lastQueuedTimestampMicros = timestampMicros;

      const frameData =
        frame.format === "h264" && frameInfo.mayNeedRewrite
          ? H264.RewriteForLowLatencyDecoding(frame.data) ?? frame.data
          : frame.data;

      queuedFrames.push({
        data: frameData,
        timestampMicros,
        type: frameInfo.type,
        metadata: {
          originalTimestamp: toNanoSec(frame.timestamp),
          receiveTime: entry.receiveTime,
        },
      });
    }

    if (queuedFrames.length === 0) {
      return { type: "Timeout", requestId };
    }

    const targetOriginalTimestamp =
      queuedFrames[queuedFrames.length - 1]!.metadata.originalTimestamp;
    const targetReceiveTime = queuedFrames[queuedFrames.length - 1]!.metadata.receiveTime;
    pendingTargetFrame = {
      requestId,
      originalTimestamp: targetOriginalTimestamp,
      receiveTime: targetReceiveTime,
    };
    let latestFrame:
      | {
          frame: VideoFrame;
          originalTimestamp: bigint;
          receiveTime: bigint;
        }
      | undefined;
    let targetTimedOut = false;
    let targetTimer: ReturnType<typeof setTimeout> | undefined;
    let anyFrameTimer: ReturnType<typeof setTimeout> | undefined;

    const closeLatestFrame = () => {
      latestFrame?.frame.close();
      latestFrame = undefined;
    };

    const clearTimers = () => {
      if (targetTimer != undefined) {
        clearTimeout(targetTimer);
        targetTimer = undefined;
      }
      if (anyFrameTimer != undefined) {
        clearTimeout(anyFrameTimer);
        anyFrameTimer = undefined;
      }
    };

    const result = await new Promise<DecodeVideoFramesResult>((resolve) => {
      const finish = (resultToResolve: DecodeVideoFramesResult) => {
        if (batchState.finished) {
          closeDecodeResultFrame(resultToResolve);
          return;
        }
        batchState.finished = true;
        clearTimers();
        finishBatch = undefined;
        if (
          resultToResolve.type !== "TargetFrame" &&
          resultToResolve.type !== "IntermediateFrame"
        ) {
          closeLatestFrame();
        } else if (latestFrame?.frame === resultToResolve.frame) {
          latestFrame = undefined;
        }
        resolve(resultToResolve);
      };

      finishBatch = finish;
      player.queueFrames(queuedFrames, (decodedFrame) => {
        if (batchState.finished || batchState.aborted) {
          if (
            !retainOrResolveTargetFrame(requestId, {
              frame: decodedFrame.frame,
              ...decodedFrame.metadata,
            })
          ) {
            decodedFrame.frame.close();
          }
          return;
        }

        closeLatestFrame();
        latestFrame = { frame: decodedFrame.frame, ...decodedFrame.metadata };

        if (
          decodedFrame.metadata.originalTimestamp === targetOriginalTimestamp &&
          decodedFrame.metadata.receiveTime === targetReceiveTime
        ) {
          pendingTargetFrame = undefined;
          finish({ type: "TargetFrame", requestId, ...latestFrame });
          return;
        }

        if (targetTimedOut) {
          finish({ type: "IntermediateFrame", requestId, ...latestFrame });
        }
      });

      targetTimer = setTimeout(() => {
        targetTimer = undefined;
        targetTimedOut = true;
        if (latestFrame != undefined) {
          finish({ type: "IntermediateFrame", requestId, ...latestFrame });
        } else if (anyFrameTimer == undefined) {
          finish({ type: "Timeout", requestId });
        }
      }, targetFrameTimeoutMs);

      anyFrameTimer = setTimeout(() => {
        anyFrameTimer = undefined;
        if (latestFrame != undefined) {
          finish({ type: "IntermediateFrame", requestId, ...latestFrame });
        } else {
          finish({ type: "Timeout", requestId });
        }
      }, anyFrameTimeoutMs);
    });

    if (result.type === "TargetFrame" || result.type === "IntermediateFrame") {
      return Comlink.transfer(result, [result.frame]) as DecodeVideoFramesResult;
    }
    return result;
  } finally {
    if (activeBatchAbort === abortThisBatch) {
      activeBatchAbort = undefined;
    }
  }
}

function isBatchAborted(batchState: { aborted: boolean }): boolean {
  return batchState.aborted;
}

async function awaitTargetFrame(args: AwaitTargetFrameArgs): Promise<AwaitTargetFrameResult> {
  const pending = pendingTargetFrame;
  if (pending == undefined || pending.requestId !== args.requestId) {
    return { type: "Aborted", requestId: args.requestId };
  }

  const retainedFrame = pending.retainedFrame;
  if (retainedFrame != undefined) {
    pendingTargetFrame = undefined;
    return Comlink.transfer({ type: "TargetFrame", requestId: args.requestId, ...retainedFrame }, [
      retainedFrame.frame,
    ]) as AwaitTargetFrameResult;
  }

  return await new Promise<AwaitTargetFrameResult>((resolve) => {
    pending.resolve = resolve;
  });
}

function getVideoFrameInfo(
  frame: CompressedVideo,
): { type: "key" | "delta"; mayNeedRewrite: boolean } | undefined {
  switch (frame.format) {
    case "h264": {
      const info = H264.GetFrameInfo(frame.data);
      return {
        type: info.isKeyFrame ? "key" : "delta",
        mayNeedRewrite: info.mayNeedRewrite,
      };
    }
    case "h265":
      return { type: H265.IsKeyframe(frame.data) ? "key" : "delta", mayNeedRewrite: false };
    default:
      return undefined;
  }
}

function getDecoderConfig(frame: CompressedVideo): VideoDecoderConfig | undefined {
  switch (frame.format) {
    case "h264":
      return H264.ParseDecoderConfig(frame.data);
    case "h265":
      return H265.ParseDecoderConfig(frame.data);
    default:
      return undefined;
  }
}

function resetVideoDecoder(): void {
  activeBatchAbort?.();
  activeBatchAbort = undefined;
  abortPendingTargetFrame();
  videoPlayer?.resetForSeek();
  initPromise = undefined;
  lastDecodeTime = { sec: 0, nsec: 0 };
  streamBaseTimestampMicros = undefined;
  lastQueuedTimestampMicros = undefined;
}

function closeDecodeResultFrame(result: DecodeVideoFramesResult): void {
  if (result.type === "TargetFrame" || result.type === "IntermediateFrame") {
    result.frame.close();
  }
}

export const service = {
  decodeVideoFrame,
  decodeVideoFrames,
  awaitTargetFrame,
  resetVideoDecoder,
};
Comlink.expose(service);
