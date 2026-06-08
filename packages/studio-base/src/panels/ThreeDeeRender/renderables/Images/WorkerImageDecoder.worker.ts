// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { H264, H265, VideoPlayer } from "@foxglove/den/video";
import Logger from "@foxglove/log";
import { isLessThan, Time, toMicroSec } from "@foxglove/rostime";

import type { CompressedVideo } from "./ImageTypes";

const log = Logger.getLogger(__filename);

let videoPlayer: VideoPlayer | undefined;
/** Track the last decoded frame's timestamp to detect out-of-order frames */
let lastDecodeTime: Time = { sec: 0, nsec: 0 };

function getVideoPlayer(): VideoPlayer {
  if (!videoPlayer) {
    videoPlayer = new VideoPlayer();
  }
  return videoPlayer;
}

/**
 * Reset the video player when we detect out-of-order frames (e.g., seek backwards).
 * This ensures the decoder starts fresh from the next keyframe.
 */
function resetVideoPlayerForDisorder(): void {
  log.info("Received out-of-order frame, resetting video decoder");
  videoPlayer?.close();
  videoPlayer = undefined;
  lastDecodeTime = { sec: 0, nsec: 0 };
}

async function decodeVideoFrame(frame: CompressedVideo, firstMessageTime: bigint): Promise<void> {
  // Detect out-of-order frames (e.g., from seek backwards)
  // This is critical for proper decoder state management
  if (isLessThan(frame.timestamp, lastDecodeTime)) {
    resetVideoPlayerForDisorder();
  }
  lastDecodeTime = frame.timestamp;

  const player = getVideoPlayer();

  const chunkType = getChunkType(frame);
  if (!chunkType) {
    return undefined;
  }

  if (!player.isInitialized()) {
    const decoderConfig = getDecoderConfig(frame);
    if (!decoderConfig || chunkType !== "key") {
      return undefined;
    }
    await player.init(decoderConfig);
  }

  const firstTimestampMicros = Number(firstMessageTime / 1000n);
  const timestampMicros = toMicroSec(frame.timestamp) - firstTimestampMicros;

  // Submit the frame for async decoding (non-blocking)
  player.decodeAsync(frame.data, timestampMicros, chunkType);
}

function getLatestVideoFrame(): VideoFrame | undefined {
  const player = getVideoPlayer();

  if (!player.isInitialized()) {
    return undefined;
  }

  const videoFrame = player.getLatestFrame();
  if (!videoFrame) {
    return undefined;
  }
  return Comlink.transfer(videoFrame, [videoFrame]);
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
      // return H264.ParseDecoderConfig(frame.data);
      return {
        codec: "avc1.640028",
        optimizeForLatency: true,
      };
    case "h265":
      return H265.ParseDecoderConfig(frame.data);
    default:
      return undefined;
  }
}

function resetVideoDecoder(): void {
  videoPlayer?.resetForSeek();
  lastDecodeTime = { sec: 0, nsec: 0 };
}

export const service = {
  decodeVideoFrame,
  resetVideoDecoder,
  getLatestVideoFrame,
};
Comlink.expose(service);
