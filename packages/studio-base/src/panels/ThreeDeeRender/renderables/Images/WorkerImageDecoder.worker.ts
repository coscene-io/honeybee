// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { H264, H265, VideoPlayer } from "@foxglove/den/video";
import Logger from "@foxglove/log";
import { isLessThan, Time, toMicroSec, toNanoSec } from "@foxglove/rostime";

import type { CompressedVideo } from "./ImageTypes";

const log = Logger.getLogger(__filename);
const INTERMEDIATE_FRAME_TIMEOUT_MS = 100;
const TARGET_FRAME_TIMEOUT_MS = 1000;

let videoPlayer: VideoPlayer | undefined;
let initPromise: Promise<void> | undefined;
/** Track the last decoded frame's timestamp to detect out-of-order frames */
let lastDecodeTime: Time = { sec: 0, nsec: 0 };
let activeBatchAbort: (() => void) | undefined;

export type DecodeVideoFrameInput = {
  frame: CompressedVideo;
  receiveTime: bigint;
};

export type DecodeVideoFramesArgs = {
  frames: DecodeVideoFrameInput[];
  requestId: number;
};

export type DecodeVideoFramesResult =
  | {
      type: "TargetFrame" | "IntermediateFrame";
      requestId: number;
      frame: VideoFrame;
      originalTimestamp: bigint;
      receiveTime: bigint;
    }
  | { type: "Timeout" | "Aborted"; requestId: number };

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
  activeBatchAbort?.();

  const { frames, requestId } = args;
  if (frames.length === 0) {
    return { type: "Timeout", requestId };
  }

  const batchState = { aborted: false };
  const abortThisBatch = () => {
    batchState.aborted = true;
    videoPlayer?.resetForSeek();
  };
  activeBatchAbort = abortThisBatch;

  let intermediate:
    | {
        frame: VideoFrame;
        originalTimestamp: bigint;
        receiveTime: bigint;
      }
    | undefined;

  const closeIntermediate = () => {
    intermediate?.frame.close();
    intermediate = undefined;
  };

  try {
    const baseTimestampMicros = toMicroSec(frames[0]!.frame.timestamp);
    const player = getVideoPlayer();

    for (let i = 0; i < frames.length; i++) {
      if (isBatchAborted(batchState)) {
        closeIntermediate();
        return { type: "Aborted", requestId };
      }

      const entry = frames[i]!;
      const frame = entry.frame;

      // Detect out-of-order frames (e.g., from seek backwards or GOP replay).
      if (isLessThan(frame.timestamp, lastDecodeTime)) {
        resetVideoPlayerForDisorder();
      }
      lastDecodeTime = frame.timestamp;

      const chunkType = getChunkType(frame);
      if (!chunkType) {
        continue;
      }

      if (!(await ensureInitialized(player, frame, chunkType))) {
        continue;
      }

      const timestampMicros = toMicroSec(frame.timestamp) - baseTimestampMicros;
      if (timestampMicros < 0) {
        resetVideoPlayerForDisorder();
        closeIntermediate();
        return { type: "Timeout", requestId };
      }

      const isTargetFrame = i === frames.length - 1;
      const decodedFrame = await player.decodeAndWaitForFrame(
        frame.data,
        timestampMicros,
        chunkType,
        isTargetFrame ? TARGET_FRAME_TIMEOUT_MS : INTERMEDIATE_FRAME_TIMEOUT_MS,
      );

      if (isBatchAborted(batchState)) {
        decodedFrame?.close();
        closeIntermediate();
        return { type: "Aborted", requestId };
      }

      if (decodedFrame == undefined) {
        continue;
      }

      const resultFrame = {
        frame: decodedFrame,
        originalTimestamp: toNanoSec(frame.timestamp),
        receiveTime: entry.receiveTime,
      };

      if (isTargetFrame) {
        closeIntermediate();
        return Comlink.transfer({ type: "TargetFrame", requestId, ...resultFrame }, [
          decodedFrame,
        ]) as DecodeVideoFramesResult;
      }

      closeIntermediate();
      intermediate = resultFrame;
    }

    if (isBatchAborted(batchState)) {
      closeIntermediate();
      return { type: "Aborted", requestId };
    }

    if (intermediate != undefined) {
      const frame = intermediate.frame;
      return Comlink.transfer({ type: "IntermediateFrame", requestId, ...intermediate }, [
        frame,
      ]) as DecodeVideoFramesResult;
    }

    return { type: "Timeout", requestId };
  } finally {
    if (activeBatchAbort === abortThisBatch) {
      activeBatchAbort = undefined;
    }
  }
}

function isBatchAborted(batchState: { aborted: boolean }): boolean {
  return batchState.aborted;
}

function getChunkType(frame: CompressedVideo): "key" | "delta" | undefined {
  switch (frame.format) {
    case "h264":
      return H264.IsKeyframe(frame.data) ? "key" : "delta";
    case "h265":
      return H265.IsKeyframe(frame.data) ? "key" : "delta";
    default:
      return undefined;
  }
}

function getDecoderConfig(frame: CompressedVideo): VideoDecoderConfig | undefined {
  switch (frame.format) {
    case "h264":
      return H264.ParseDecoderConfig(frame.data) ?? { codec: "avc1.640028" };
    case "h265":
      return H265.ParseDecoderConfig(frame.data);
    default:
      return undefined;
  }
}

function resetVideoDecoder(): void {
  activeBatchAbort?.();
  activeBatchAbort = undefined;
  videoPlayer?.resetForSeek();
  initPromise = undefined;
  lastDecodeTime = { sec: 0, nsec: 0 };
}

export const service = {
  decodeVideoFrame,
  decodeVideoFrames,
  resetVideoDecoder,
};
Comlink.expose(service);
