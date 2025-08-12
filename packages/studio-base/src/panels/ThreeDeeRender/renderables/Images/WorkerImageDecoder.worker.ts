// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
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

// H.264 NALU type constants (for documentation)
// 0: Unspecified, 1: Non-IDR coded slice, 2-4: Data partition slices, 5: IDR coded slice
// 6: SEI, 7: SPS, 8: PPS, 9: AUD, 10: End of sequence, 11: End of stream, 12: Filler data

// H.264 Slice type enumeration
enum H264SliceType {
  P = 0, // P slice
  B = 1, // B slice
  I = 2, // I slice
  SP = 3, // SP slice
  SI = 4, // SI slice
  P_IDR = 5, // P slice (IDR)
  B_IDR = 6, // B slice (IDR)
  I_IDR = 7, // I slice (IDR)
  SP_IDR = 8, // SP slice (IDR)
  SI_IDR = 9, // SI slice (IDR)
}

/**
 * Parse unsigned integer in UE(v) format (Exponential Golomb encoding)
 * @param data Data buffer
 * @param bitOffset Bit offset
 * @returns {value: number, bitsRead: number}
 */
function parseUEV(data: Uint8Array, bitOffset: number): { value: number; bitsRead: number } {
  let leadingZeros = 0;
  let currentBit = bitOffset;

  // Count the number of leading zeros
  while (currentBit < data.length * 8) {
    const byteIndex = Math.floor(currentBit / 8);
    const bitIndex = 7 - (currentBit % 8);
    const bit = (data[byteIndex]! >> bitIndex) & 1;

    if (bit === 1) {
      break;
    }
    leadingZeros++;
    currentBit++;
  }

  if (currentBit >= data.length * 8) {
    return { value: 0, bitsRead: currentBit - bitOffset };
  }

  // Skip the identifier bit 1
  currentBit++;

  // Read data bits
  let value = 0;
  for (let i = 0; i < leadingZeros; i++) {
    if (currentBit >= data.length * 8) {
      break;
    }

    const byteIndex = Math.floor(currentBit / 8);
    const bitIndex = 7 - (currentBit % 8);
    const bit = (data[byteIndex]! >> bitIndex) & 1;

    value = (value << 1) | bit;
    currentBit++;
  }

  return {
    value: (1 << leadingZeros) - 1 + value,
    bitsRead: currentBit - bitOffset,
  };
}

/**
 * Parse slice type from H.264 slice header
 * @param data NAL unit data (excluding start code)
 * @returns Slice type or undefined (if parsing failed)
 */
function parseSliceType(data: Uint8Array): H264SliceType | undefined {
  if (data.length < 2) {
    return undefined;
  }

  // Skip NAL header (1 byte)
  let bitOffset = 8;

  try {
    // Parse first_mb_in_slice (UE(v))
    const firstMb = parseUEV(data, bitOffset);
    bitOffset += firstMb.bitsRead;

    // Parse slice_type (UE(v))
    const sliceTypeResult = parseUEV(data, bitOffset);
    const sliceType = sliceTypeResult.value;

    // slice_type value might be greater than 9, need to take modulo
    const normalizedSliceType = sliceType % 5;

    // Map slice_type to corresponding enum value
    switch (normalizedSliceType) {
      case 0:
        return sliceType >= 5 ? H264SliceType.P_IDR : H264SliceType.P;
      case 1:
        return sliceType >= 5 ? H264SliceType.B_IDR : H264SliceType.B;
      case 2:
        return sliceType >= 5 ? H264SliceType.I_IDR : H264SliceType.I;
      case 3:
        return sliceType >= 5 ? H264SliceType.SP_IDR : H264SliceType.SP;
      case 4:
        return sliceType >= 5 ? H264SliceType.SI_IDR : H264SliceType.SI;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Find the start position of the next NAL unit
 * @param data Data buffer
 * @param startPos Position to start searching from
 * @returns Start position of next NAL unit, returns -1 if not found
 */
function findNextNalStart(data: Uint8Array, startPos: number): number {
  for (let i = startPos; i <= data.length - 4; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      return i + 4; // 4-byte start code
    }
    if (i <= data.length - 3 && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      return i + 3; // 3-byte start code
    }
  }
  return -1;
}

/**
 * Parse the type of a single NAL unit
 * @param frame Complete frame data
 * @param nalStart NAL unit start position
 * @returns Frame type or undefined (if need to check next NAL unit)
 */
function parseNalUnit(
  frame: Uint8Array,
  nalStart: number,
): "key" | "delta" | "b frame" | "unknown frame" | undefined {
  if (nalStart >= frame.length) {
    return "unknown frame";
  }

  // Get NAL unit type (lower 5 bits)
  const nalType = frame[nalStart]! & 0x1f;

  log.debug(`NAL Type: ${nalType} at position: ${nalStart}`);

  // Determine based on NAL unit type
  if (nalType === 5) {
    // IDR frames are always key frames
    return "key";
  } else if (nalType === 7 || nalType === 8) {
    // SPS and PPS are crucial for decoding, treated as key frames
    return "key";
  } else if (nalType === 9) {
    // Access Unit Delimiter, need to check subsequent NAL units
    log.debug("Found AUD (Access Unit Delimiter), looking for next NAL unit...");
    return undefined; // Return undefined to indicate need to check next NAL unit
  } else if (nalType === 6 || nalType === 12) {
    // SEI and filler data are not image data, need to check subsequent NAL units
    log.debug(`Found SEI/Filler (type ${nalType}), looking for next NAL unit...`);
    return undefined;
  } else if (nalType === 1 || nalType === 2 || nalType === 3 || nalType === 4) {
    // Non-IDR coded slices, need to parse slice header to determine specific type
    const sliceType = parseSliceType(frame.subarray(nalStart));

    if (sliceType == undefined) {
      return "unknown frame";
    }

    // Determine slice type
    switch (sliceType) {
      case H264SliceType.I:
      case H264SliceType.I_IDR:
      case H264SliceType.SI:
      case H264SliceType.SI_IDR:
        return "key"; // I and SI frames are key frames

      case H264SliceType.B:
      case H264SliceType.B_IDR:
        return "b frame"; // B frames

      case H264SliceType.P:
      case H264SliceType.P_IDR:
      case H264SliceType.SP:
      case H264SliceType.SP_IDR:
        return "delta"; // P and SP frames are predictive frames

      default:
        return "unknown frame";
    }
  } else if (nalType === 10 || nalType === 11) {
    // End of sequence and end of stream markers
    return "unknown frame";
  } else {
    // Unknown or reserved NAL unit type, continue to check next one
    log.debug(`Unknown NAL type: ${nalType}, looking for next NAL unit...`);
    return undefined;
  }
}

/**
 * Determine H.264 frame type
 * @param frame Complete H.264 frame data
 * @returns Frame type: "key"(key frame), "delta"(non-key frame), "b frame"(B frame), "unknown frame"(unknown)
 */
function isKeyFrame(frame: Uint8Array): "key" | "delta" | "b frame" | "unknown frame" {
  if (frame.length < 5) {
    return "unknown frame"; // Frame too short to determine
  }

  let nalStart = 0;
  let searchAttempts = 0;
  const MAX_NAL_SEARCH_ATTEMPTS = 10; // Safety limit to prevent infinite loops

  // Find the first NAL unit start code
  if (frame[0] === 0 && frame[1] === 0 && frame[2] === 0 && frame[3] === 1) {
    nalStart = 4; // 4-byte start code 0x00000001
  } else if (frame[0] === 0 && frame[1] === 0 && frame[2] === 1) {
    nalStart = 3; // 3-byte start code 0x000001
  } else {
    // May not have start code, start from beginning
    nalStart = 0;
  }

  // Traverse NAL units with safety limit
  while (nalStart >= 0 && nalStart < frame.length && searchAttempts < MAX_NAL_SEARCH_ATTEMPTS) {
    searchAttempts++;
    const result = parseNalUnit(frame, nalStart);

    if (result != undefined) {
      // Found definitive frame type
      log.debug(`Frame type determined after ${searchAttempts} NAL unit(s)`);
      return result;
    }

    // Need to check next NAL unit
    nalStart = findNextNalStart(frame, nalStart + 1);
    log.debug(
      `Next NAL start at: ${nalStart} (attempt ${searchAttempts}/${MAX_NAL_SEARCH_ATTEMPTS})`,
    );
  }

  // Safety mechanism triggered or traversed all NAL units without finding definitive frame type
  if (searchAttempts >= MAX_NAL_SEARCH_ATTEMPTS) {
    log.warn(
      `Reached maximum NAL search attempts (${MAX_NAL_SEARCH_ATTEMPTS}), defaulting to unknown frame`,
    );
  }

  return "unknown frame";
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

  let type: "delta" | "key" | "unknown frame" | "b frame" = "delta";
  if (data.length > 4) {
    type = isKeyFrame(data as Uint8Array);
    log.debug("Frame data:", data.slice(0, 10)); // Only log first 10 bytes
    log.debug("Detected frame type:", type);
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
    type: type === "key" ? "key" : "delta",
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
