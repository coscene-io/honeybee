// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SPS as SPSNALU } from "./SPS";
import {
  annexBBoxSize,
  findNextStartCode,
  findNextStartCodeEnd,
  getFirstNaluOfType,
  isAnnexB,
} from "../h26x/AnnexB";
import type { H26xCodec } from "../h26x/types";

export enum H264NaluType {
  NDR = 1,
  IDR = 5,
  SEI = 6,
  SPS = 7,
  PPS = 8,
  AUD = 9,
}

export class H264 implements H26xCodec {
  public IsAnnexB(data: Uint8Array): boolean {
    return H264.IsAnnexB(data);
  }

  public AnnexBBoxSize(data: Uint8Array): number | undefined {
    return H264.AnnexBBoxSize(data);
  }

  public IsKeyframe(data: Uint8Array): boolean {
    return H264.IsKeyframe(data);
  }

  public GetFirstNALUOfType(data: Uint8Array, naluType: number): Uint8Array | undefined {
    return H264.GetFirstNALUOfType(data, naluType as H264NaluType);
  }

  public ParseDecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
    return H264.ParseDecoderConfig(data);
  }

  public GetNaluTypeFromHeader(headerByte: number): number {
    return H264.GetNaluTypeFromHeader(headerByte);
  }

  public static IsAnnexB(data: Uint8Array): boolean {
    return isAnnexB(data);
  }

  public static AnnexBBoxSize(data: Uint8Array): number | undefined {
    return annexBBoxSize(data);
  }

  public static IsKeyframe(data: Uint8Array): boolean {
    // Determine what type of encoding is used
    const boxSize = H264.AnnexBBoxSize(data);
    if (boxSize == undefined) {
      return false;
    }

    // Iterate over the NAL units in the H264 Annex B frame, looking for NaluTypes.IDR
    let i = boxSize;
    while (i < data.length) {
      // Annex B NALU type is the 5 least significant bits of the first byte following the start
      // code
      const naluType: H264NaluType = data[i]! & 0x1f;
      if (naluType === H264NaluType.IDR) {
        return true;
      }

      // Scan for another start code, signifying the beginning of the next NAL unit
      i = H264.FindNextStartCodeEnd(data, i + 1);
    }

    return false;
  }

  public static GetFirstNALUOfType(
    data: Uint8Array,
    naluType: H264NaluType,
  ): Uint8Array | undefined {
    // Determine what type of encoding is used
    return getFirstNaluOfType(data, naluType, (headerByte) => headerByte & 0x1f);
  }

  public static ParseDecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
    // Find the first SPS NALU and extrat MIME, picHeight, and picWidth fields
    const spsData = H264.GetFirstNALUOfType(data, H264NaluType.SPS);
    if (spsData == undefined) {
      return undefined;
    }

    // Extract the SPS fields
    const sps = new SPSNALU(spsData);
    if (sps.nal_unit_type !== H264NaluType.SPS) {
      return undefined;
    }

    const config: VideoDecoderConfig = {
      codec: sps.MIME(),
      codedWidth: sps.picWidth,
      codedHeight: sps.picHeight,
    };

    // If the aspect ratio is specified, use it to calculate the display aspect ratio
    const aspectWidth = sps.sar_width ?? 0;
    const aspectHeight = sps.sar_height ?? 0;
    if (aspectWidth > 1 || aspectHeight > 1) {
      // The Sample Aspect Ratio (SAR) is the ratio of the width to the height of an individual
      // pixel. Display Aspect Ratio (DAR) is the ratio of the width to the height of the video as
      // it should be displayed
      config.displayAspectWidth = Math.round(sps.picWidth * (aspectWidth / aspectHeight));
      config.displayAspectHeight = sps.picHeight;
    }

    return config;
  }

  /**
   * Find the index of the next start code (0x000001 or 0x00000001) in the
   * given buffer, starting at the given offset.
   */
  public static FindNextStartCode(data: Uint8Array, start: number): number {
    return findNextStartCode(data, start);
  }

  /**
   * Find the index of the end of the next start code (0x000001 or 0x00000001) in the
   * given buffer, starting at the given offset.
   */
  public static FindNextStartCodeEnd(data: Uint8Array, start: number): number {
    return findNextStartCodeEnd(data, start);
  }

  public static GetNaluTypeFromHeader(headerByte: number): H264NaluType {
    return (headerByte & 0x1f) as H264NaluType;
  }
}
