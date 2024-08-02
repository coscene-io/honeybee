// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "comlink";

import Logger from "@foxglove/log";
import type { RawImage } from "@foxglove/schemas";

import { decodeRawImage, RawImageOptions } from "./decodeImage";
import type { Image as RosImage } from "../../ros";

const log = Logger.getLogger(__filename);

let h264Decoder: VideoDecoder | undefined;

let H264Frames: VideoFrame[] = [];

function decode(image: RosImage | RawImage, options: Partial<RawImageOptions>): ImageData {
  const result = new ImageData(image.width, image.height);
  decodeRawImage(image, options, result.data);
  return Comlink.transfer(result, [result.data.buffer]);
}

function isKeyFrame(frame: Uint8Array): boolean {
  if (frame.length < 5) {
    return false; // 帧太短，无法判断
  }

  // 查找 NAL 单元的起始位置
  let nalStart: number = 0;
  if (frame[0] === 0 && frame[1] === 0 && frame[2] === 0 && frame[3] === 1) {
    nalStart = 4; // 4 字节起始码
  } else if (frame[0] === 0 && frame[1] === 0 && frame[2] === 1) {
    nalStart = 3; // 3 字节起始码
  }

  if (nalStart >= frame.length) {
    return false; // NAL 单元起始位置无效
  }

  // 获取 NAL 单元类型
  const nalType = frame[nalStart]! & 0x1f;

  // IDR 帧 (type 5) 始终是关键帧
  // SPS (type 7) 和 PPS (type 8) 也被视为关键帧，因为它们对解码至关重要
  return nalType === 5 || nalType === 7 || nalType === 8;
}

function getH264Decoder(): VideoDecoder {
  if (!h264Decoder) {
    h264Decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        H264Frames.push(frame);
      },
      error: (error: Error) => {
        log.error(error.message);
      },
    });

    h264Decoder.configure({
      codec: "avc1.42001E",
      hardwareAcceleration: "prefer-software",
    });
  }
  return h264Decoder;
}

function decodeH264Frame(data: Uint8Array | Int8Array, sequenceNumber: number): void {
  let type: "delta" | "key" = "delta";
  if (data.length > 4) {
    if (isKeyFrame(data as Uint8Array)) {
      type = "key";
    } else {
      type = "delta";
    }
  }

  const chunk = new EncodedVideoChunk({
    timestamp: sequenceNumber,
    type,
    data,
  });

  const decoder = getH264Decoder();

  try {
    decoder.decode(chunk);
  } catch (error) {
    log.error(error);
  }
}

function getH264Frames(): VideoFrame | undefined {
  const frame = H264Frames.pop();
  if (frame) {
    return Comlink.transfer(frame, [frame]);
  }

  // we need latest frames only, drop frames if too many
  if (H264Frames.length >= 5) {
    H264Frames.forEach((uselessFrame) => {
      uselessFrame.close();
    });
    H264Frames = [];
  }

  return undefined;
}

export const service = {
  decode,
  decodeH264Frame,
  getH264Frames,
};
Comlink.expose(service);
