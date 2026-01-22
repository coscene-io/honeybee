// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { H264, H265, VideoPlayer } from "@foxglove/den/video";
import { toMicroSec } from "@foxglove/rostime";
import type { RawImage } from "@foxglove/schemas";

import type { CompressedVideo } from "./ImageTypes";
import { decodeRawImage, RawImageOptions } from "./decodeImage";
import type { Image as RosImage } from "../../ros";

function decode(image: RosImage | RawImage, options: Partial<RawImageOptions>): ImageData {
  const result = new ImageData(image.width, image.height);
  decodeRawImage(image, options, result.data);
  return Comlink.transfer(result, [result.data.buffer]);
}

let videoPlayer: VideoPlayer | undefined;

function getVideoPlayer(): VideoPlayer {
  if (!videoPlayer) {
    videoPlayer = new VideoPlayer();
  }
  return videoPlayer;
}

async function decodeVideoFrame(
  frame: CompressedVideo,
  firstMessageTime: bigint,
): Promise<VideoFrame | undefined> {
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

  const videoFrame = await player.decode(frame.data, timestampMicros, chunkType);
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
      return H264.ParseDecoderConfig(frame.data);
    case "h265":
      return H265.ParseDecoderConfig(frame.data);
    default:
      return undefined;
  }
}

function resetVideoDecoder(): void {
  videoPlayer?.resetForSeek();
}

export const service = {
  decode,
  decodeVideoFrame,
  resetVideoDecoder,
};
Comlink.expose(service);
