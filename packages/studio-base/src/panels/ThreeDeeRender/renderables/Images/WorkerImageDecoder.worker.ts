// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import Logger from "@foxglove/log";
import { isLessThan, Time, toMicroSec } from "@foxglove/rostime";
import type { RawImage } from "@foxglove/schemas";

import { decodeRawImage, RawImageOptions } from "./decodeImage";
import type { Image as RosImage } from "../../ros";

const log = Logger.getLogger(__filename);

let h264Decoder: VideoDecoder | undefined;

let H264Frames: VideoFrame[] = [];

let foundKeyFrame = false;

function decode(image: RosImage | RawImage, options: Partial<RawImageOptions>): ImageData {
  const result = new ImageData(image.width, image.height);
  decodeRawImage(image, options, result.data);
  return Comlink.transfer(result, [result.data.buffer]);
}

function convertToBinaryArray(uint8Array: Uint8Array) {
  return uint8Array.reduce((acc: number[], num) => {
    // 将每个数字转换为8位二进制字符串
    const binaryString = num.toString(2).padStart(8, "0");

    // 将二进制字符串分割成单个位，并转换为数字
    const binaryDigits = binaryString.split("").map(Number);

    // 将转换后的二进制数字添加到结果数组中
    return acc.concat(binaryDigits);
  }, []);
}

function isKeyFrame(frame: Uint8Array): "key" | "delta" | "b frame" | "unknow frame" {
  if (frame.length < 5) {
    return "unknow frame"; // 帧太短，无法判断
  }

  // 查找 NAL 单元的起始位置
  let nalStart: number = 0;
  if (frame[0] === 0 && frame[1] === 0 && frame[2] === 0 && frame[3] === 1) {
    nalStart = 4; // 4 字节起始码
  } else if (frame[0] === 0 && frame[1] === 0 && frame[2] === 1) {
    nalStart = 3; // 3 字节起始码
  }

  if (nalStart >= frame.length) {
    return "unknow frame"; // NAL 单元起始位置无效
  }

  // 获取 NAL 单元类型
  const nalType = frame[nalStart]! & 0x1f;

  // IDR 帧 (type 5) 始终是关键帧
  // SPS (type 7) 和 PPS (type 8) 也被视为关键帧，因为它们对解码至关重要
  if (nalType === 5 || nalType === 7 || nalType === 8) {
    return "key";
  }

  // 00 00 01 65 01 92 22
  // 0110 0101 0000 0001 1001 0010 0010 0010
  // forbidden_zero_bit:
  // 0
  // nal_ref_idc:
  // 11
  // nal_unit_type:
  // 00101
  // first_mb_in_slice:
  // 0000 000 1 1001 001 -> 2^7 -1 + 73 = 200
  // slice_type:
  // 0 0010 00 -> 2^3 -1 + 0 = 7
  // first_mb_in_slice start

  // 跳过 forbidden_zero_bit 和 nal_ref_idc 以及 nal_unit_type 正好是八位二进制 跳过第一个 数字
  const first_mb_in_slice = nalStart + 1;

  if (
    frame[first_mb_in_slice] == undefined ||
    frame[first_mb_in_slice + 1] == undefined ||
    frame[first_mb_in_slice + 2] == undefined
  ) {
    return "unknow frame";
  }

  //将 first_mb_in_slice 后面三位数转换为 2 进制数组
  const binaryArray = convertToBinaryArray(
    frame.subarray(first_mb_in_slice, first_mb_in_slice + 3),
  );

  // 找到第一个 1
  const firstMbOneIndex = binaryArray.findIndex((value) => value === 1);

  // 1 前面有多少位也跳过 1 后面多少位，找到 slice_type 的起始位
  const sliceTypeArray = binaryArray.slice(firstMbOneIndex * 2 + 1);

  const firstSliceTypeOneIndex = sliceTypeArray.findIndex((value) => value === 1);

  // 2 ^ firstSliceTypeOneIndex - 1 + (1前有多少位就向后计算多少位的十进制)
  const sliceType =
    2 ** firstSliceTypeOneIndex -
    1 +
    parseInt(
      sliceTypeArray.slice(firstSliceTypeOneIndex + 1, 2 * firstSliceTypeOneIndex + 1).join(""),
      2,
    );

  // 0: P slice
  // 1: B slice
  // 2: I slice
  // 3: SP slice
  // 4: SI slice
  // 5: P slice (IDR)
  // 6: B slice (IDR)
  // 7: I slice (IDR)
  // 8: SP slice (IDR)
  // 9: SI slice (IDR)
  // 不支持 b frame
  if (sliceType === 1 || sliceType === 6) {
    return "b frame";
  }

  return "delta";
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
      codec: "avc1.640028",
      optimizeForLatency: true,
    });
  }
  return h264Decoder;
}

let lastDecodeTime = { sec: 0, nsec: 0 };

function decodeH264Frame(data: Uint8Array | Int8Array, receiveTime: Time): void {
  // prevent disordered frames
  if (isLessThan(receiveTime, lastDecodeTime)) {
    log.info("received image disordered", receiveTime, lastDecodeTime);
    h264Decoder?.close();
    h264Decoder = undefined;
    foundKeyFrame = false;
  }

  lastDecodeTime = receiveTime;

  let type: "delta" | "key" | "unknow frame" | "b frame" = "delta";
  if (data.length > 4) {
    type = isKeyFrame(data as Uint8Array);
  }

  if (type === "b frame") {
    type = "delta";
  }

  if (type === "unknow frame") {
    return;
  }

  if (type === "key" && !foundKeyFrame) {
    foundKeyFrame = true;
  }

  if (!foundKeyFrame) {
    return;
  }

  const decoder = getH264Decoder();

  const chunk = new EncodedVideoChunk({
    timestamp: toMicroSec(receiveTime),
    type,
    data,
  });
  try {
    decoder.decode(chunk);
  } catch (error) {
    log.error("Decode error:", error);
  }
}

function getH264Frames(): VideoFrame | undefined {
  const frame = H264Frames.pop();
  if (frame) {
    H264Frames.forEach((uselessFrame) => {
      uselessFrame.close();
    });
    H264Frames = [];
    return Comlink.transfer(frame, [frame]);
  }

  return undefined;
}

export const service = {
  decode,
  decodeH264Frame,
  getH264Frames,
};
Comlink.expose(service);
