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

function isKeyFrame(uint8Array: Uint8Array): boolean {
  let naltype: string = "invalid frame";
  // 查找 NAL 单元起始码
  if (uint8Array.length > 4) {
    if (uint8Array[4] === 0x65) {
      naltype = "I frame";
    } else if (uint8Array[4] === 0x41) {
      naltype = "P frame";
    } else if (uint8Array[4] === 0x67) {
      naltype = "SPS";
    } else if (uint8Array[4] === 0x68) {
      naltype = "PPS";
    }
  }

  // 如果没有找到有效的 NAL 单元，返回 false
  if (naltype === "I frame" || naltype === "SPS" || naltype === "PPS") {
    return true;
  }
  return false;
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
      hardwareAcceleration: "prefer-hardware",
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

async function getH264Frames(): Promise<ImageBitmap | undefined> {
  const frame = H264Frames.pop();
  if (frame) {
    const imageBitmap = await createImageBitmap(frame);
    return imageBitmap;
  }
  H264Frames.forEach((uselessFrame) => {
    uselessFrame.close();
  });
  H264Frames = [];
  return undefined;
}

export const service = {
  decode,
  decodeH264Frame,
  getH264Frames,
};
Comlink.expose(service);
