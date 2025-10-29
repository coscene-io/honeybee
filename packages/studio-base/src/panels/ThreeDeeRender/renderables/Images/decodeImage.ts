// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import {
  decodeBGR8,
  decodeBGRA8,
  decodeBayerBGGR8,
  decodeBayerGBRG8,
  decodeBayerGRBG8,
  decodeBayerRGGB8,
  decodeFloat1c,
  decodeMono16,
  decodeMono8,
  decodeRGB8,
  decodeRGBA8,
  decodeUYVY,
  decodeYUYV,
} from "@foxglove/den/image";
import { RawImage } from "@foxglove/schemas";

import { CompressedImageTypes } from "./ImageTypes";
import { Image as RosImage } from "../../ros";
import { ColorModeSettings, getColorConverter } from "../colorMode";

export async function decodeCompressedImageToBitmap(
  image: CompressedImageTypes,
  resizeWidth?: number,
): Promise<ImageBitmap | ImageData> {
  const fmt = image.format.toLowerCase();

  let bytes = image.data;

  // helper: check signature
  const startsWith = (arr: Uint8Array, sig: number[]) => {
    if (arr.byteLength < sig.length) {
      return false;
    }
    for (let i = 0; i < sig.length; i++) {
      if (arr[i] !== sig[i]!) {
        return false;
      }
    }
    return true;
  };

  const findSignature = (arr: Uint8Array, sig: number[]) => {
    outer: for (let i = 0; i <= arr.byteLength - sig.length; i++) {
      for (let j = 0; j < sig.length; j++) {
        if (arr[i + j] !== sig[j]!) {
          continue outer;
        }
      }
      return i;
    }
    return -1;
  };

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const TIFF_SIGS = [
    [0x49, 0x49, 0x2a, 0x00], // II*\x00
    [0x4d, 0x4d, 0x00, 0x2a], // MM\x00*
  ];
  const JPEG_SIG = [0xff, 0xd8, 0xff];
  const isWebp = (arr: Uint8Array) =>
    arr.byteLength >= 12 &&
    arr[0] === 0x52 &&
    arr[1] === 0x49 &&
    arr[2] === 0x46 &&
    arr[3] === 0x46 &&
    arr[8] === 0x57 &&
    arr[9] === 0x45 &&
    arr[10] === 0x42 &&
    arr[11] === 0x50;

  // tokens from format string, tolerant to separators
  const tokens = fmt.split(/[;,\s]+/).filter(Boolean);
  const isCompressedDepth = tokens.includes("compresseddepth");
  const codecToken =
    tokens.find((t) => ["png", "jpeg", "jpg", "webp", "tiff", "tif", "rvl"].includes(t)) ?? "";

  const guessCodecByMagic = (arr: Uint8Array): "png" | "jpeg" | "webp" | "tiff" => {
    if (startsWith(arr, PNG_SIG)) {
      return "png";
    }
    if (TIFF_SIGS.some((sig) => startsWith(arr, sig))) {
      return "tiff";
    }
    if (startsWith(arr, JPEG_SIG)) {
      return "jpeg";
    }
    if (isWebp(arr)) {
      return "webp";
    }
    return "png";
  };

  let codec: "png" | "jpeg" | "webp" | "tiff" | "rvl";
  if (codecToken === "jpg") {
    codec = "jpeg";
  } else if (codecToken === "tif") {
    codec = "tiff";
  } else if (codecToken === "rvl") {
    codec = "rvl";
  } else if (["png", "jpeg", "webp", "tiff"].includes(codecToken)) {
    codec = codecToken as typeof codec;
  } else {
    codec = guessCodecByMagic(bytes);
  }

  // handle ROS compressedDepth header: [uint32_le headerLen][header bytes][image bytes...]
  if (isCompressedDepth) {
    if (codec === "rvl") {
      throw new Error(
        "compressedDepth with CODEC=rvl is not supported by browser decoder; please implement an RVL -> ImageData decoder",
      );
    }

    // 尝试按 headerLen 剥离（带健壮性校验）
    if (bytes.byteLength >= 8) {
      try {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const headerLen = view.getUint32(0, true);
        const MAX_HEADER = Math.min(4 * 1024 * 1024, Math.floor(bytes.byteLength * 0.25));
        const offset = 4 + headerLen;
        if (headerLen > 0 && headerLen <= MAX_HEADER && offset < bytes.byteLength) {
          bytes = bytes.subarray(offset);
        }
      } catch {
        // ignore, fallback to signature search
      }
    }

    // 保险：按签名定位真实起始（防止 headerLen 不一致或存在额外字段）
    const ensureStartsWithSignature = () => {
      if (codec === "png") {
        if (!startsWith(bytes, PNG_SIG)) {
          const pos = findSignature(bytes, PNG_SIG);
          if (pos > 0) {
            bytes = bytes.subarray(pos);
          }
        }
      } else if (codec === "tiff") {
        if (!TIFF_SIGS.some((sig) => startsWith(bytes, sig))) {
          const posII = findSignature(bytes, TIFF_SIGS[0]!);
          const posMM = findSignature(bytes, TIFF_SIGS[1]!);
          const pos = [posII, posMM].filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? -1;
          if (pos > 0) {
            bytes = bytes.subarray(pos);
          }
        }
      } else if (codec === "jpeg") {
        if (!startsWith(bytes, JPEG_SIG)) {
          const pos = findSignature(bytes, JPEG_SIG);
          if (pos > 0) {
            bytes = bytes.subarray(pos);
          }
        }
      } else if (codec === "webp") {
        if (!isWebp(bytes)) {
          let pos = -1;
          for (let i = 0; i <= bytes.byteLength - 12; i++) {
            if (
              bytes[i] === 0x52 &&
              bytes[i + 1] === 0x49 &&
              bytes[i + 2] === 0x46 &&
              bytes[i + 3] === 0x46 &&
              bytes[i + 8] === 0x57 &&
              bytes[i + 9] === 0x45 &&
              bytes[i + 10] === 0x42 &&
              bytes[i + 11] === 0x50
            ) {
              pos = i;
              break;
            }
          }
          if (pos > 0) {
            bytes = bytes.subarray(pos);
          }
        }
      }
    };
    ensureStartsWithSignature();
  } else {
    // 普通 compressed_image_transport：一般不加头；必要时基于签名微调
    if (codec === "png" && !startsWith(bytes, PNG_SIG)) {
      const pos = findSignature(bytes, PNG_SIG);
      if (pos > 0) {
        bytes = bytes.subarray(pos);
      }
    } else if (codec === "tiff" && !TIFF_SIGS.some((sig) => startsWith(bytes, sig))) {
      const posII = findSignature(bytes, TIFF_SIGS[0]!);
      const posMM = findSignature(bytes, TIFF_SIGS[1]!);
      const pos = [posII, posMM].filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? -1;
      if (pos > 0) {
        bytes = bytes.subarray(pos);
      }
    } else if (codec === "jpeg" && !startsWith(bytes, JPEG_SIG)) {
      const pos = findSignature(bytes, JPEG_SIG);
      if (pos > 0) {
        bytes = bytes.subarray(pos);
      }
    } else if (codec === "webp" && !isWebp(bytes)) {
      let pos = -1;
      for (let i = 0; i <= bytes.byteLength - 12; i++) {
        if (
          bytes[i] === 0x52 &&
          bytes[i + 1] === 0x49 &&
          bytes[i + 2] === 0x46 &&
          bytes[i + 3] === 0x46 &&
          bytes[i + 8] === 0x57 &&
          bytes[i + 9] === 0x45 &&
          bytes[i + 10] === 0x42 &&
          bytes[i + 11] === 0x50
        ) {
          pos = i;
          break;
        }
      }
      if (pos > 0) {
        bytes = bytes.subarray(pos);
      }
    }
  }

  // Ensure Blob receives an ArrayBuffer (not SharedArrayBuffer-backed view)
  const start = bytes.byteOffset;
  const end = start + bytes.byteLength;
  let blobData: ArrayBuffer;
  if (bytes.buffer instanceof ArrayBuffer) {
    blobData = bytes.buffer.slice(start, end);
  } else {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    blobData = copy.buffer;
  }
  if (codec === "rvl") {
    throw new Error("RVL cannot be displayed as image/blob; decode to ImageData first");
  }
  const blob = new Blob([blobData], { type: `image/${codec}` });

  try {
    return await createImageBitmap(blob, { resizeWidth });
  } catch (e) {
    // 提供可诊断信息（首字节、长度、codec/format），便于定位
    const head = Array.from(bytes.subarray(0, 8)).map((b) => b.toString(16).padStart(2, "0"));
    throw new Error(
      `createImageBitmap failed (${(e as Error).message}); codec=${codec}, format="${fmt}", bytes=${
        bytes.byteLength
      }, head=[${head.join(" ")}]`,
    );
  }
}

export const IMAGE_DEFAULT_COLOR_MODE_SETTINGS: Required<
  Omit<ColorModeSettings, "colorField" | "minValue" | "maxValue">
> = {
  colorMode: "gradient",
  flatColor: "#ffffff",
  gradient: ["#000000", "#ffffff"],
  colorMap: "turbo",
  explicitAlpha: 0,
};
const MIN_MAX_16_BIT = { minValue: 0, maxValue: 65535 };

export type RawImageOptions = ColorModeSettings;

/**
 * See also:
 * https://github.com/ros2/common_interfaces/blob/366eea24ffce6c87f8860cbcd27f4863f46ad822/sensor_msgs/include/sensor_msgs/image_encodings.hpp
 */
export function decodeRawImage(
  image: RosImage | RawImage,
  options: Partial<RawImageOptions>,
  output: Uint8ClampedArray,
): void {
  const { encoding, width, height, step } = image;
  const is_bigendian = "is_bigendian" in image ? image.is_bigendian : false;
  const rawData = image.data as Uint8Array;
  switch (encoding) {
    case "yuv422":
    case "uyvy":
      decodeUYVY(rawData, width, height, step, output);
      break;
    case "yuv422_yuy2":
    case "yuyv":
      decodeYUYV(rawData, width, height, step, output);
      break;
    case "rgb8":
      decodeRGB8(rawData, width, height, step, output);
      break;
    case "rgba8":
      decodeRGBA8(rawData, width, height, step, output);
      break;
    case "bgra8":
      decodeBGRA8(rawData, width, height, step, output);
      break;
    case "bgr8":
    case "8UC3":
      decodeBGR8(rawData, width, height, step, output);
      break;
    case "32FC1":
      decodeFloat1c(rawData, width, height, step, is_bigendian, output);
      break;
    case "bayer_rggb8":
      decodeBayerRGGB8(rawData, width, height, step, output);
      break;
    case "bayer_bggr8":
      decodeBayerBGGR8(rawData, width, height, step, output);
      break;
    case "bayer_gbrg8":
      decodeBayerGBRG8(rawData, width, height, step, output);
      break;
    case "bayer_grbg8":
      decodeBayerGRBG8(rawData, width, height, step, output);
      break;
    case "mono8":
    case "8UC1":
      decodeMono8(rawData, width, height, step, output);
      break;
    case "mono16":
    case "16UC1": {
      // combine options with defaults. lodash merge makes sure undefined values in options are replaced with defaults
      // whereas a normal spread would allow undefined values to overwrite defaults
      const settings = _.merge({}, IMAGE_DEFAULT_COLOR_MODE_SETTINGS, MIN_MAX_16_BIT, options);
      if (settings.colorMode === "rgba-fields" || settings.colorMode === "flat") {
        throw Error(`${settings.colorMode} color mode is not supported for mono16 images`);
      }
      const min = settings.minValue;
      const max = settings.maxValue;
      const tempColor = { r: 0, g: 0, b: 0, a: 0 };
      const converter = getColorConverter(
        settings as ColorModeSettings & {
          colorMode: typeof settings.colorMode;
        },
        min,
        max,
      );
      decodeMono16(rawData, width, height, step, is_bigendian, output, {
        minValue: options.minValue,
        maxValue: options.maxValue,
        colorConverter: (value: number) => {
          converter(tempColor, value);
          return tempColor;
        },
      });
      break;
    }
    default:
      throw new Error(`Unsupported encoding ${encoding}`);
  }
}
