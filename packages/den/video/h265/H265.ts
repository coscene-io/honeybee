// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SPS as SPSSNALU } from "./SPS";
import {
  annexBBoxSize,
  findNextStartCode,
  findNextStartCodeEnd,
  getFirstNaluOfType,
  isAnnexB,
} from "../h26x/AnnexB";
import type { H26xCodec } from "../h26x/types";

export enum H265NaluType {
  TRAIL_N = 0,
  TRAIL_R = 1,
  TSA_N = 2,
  TSA_R = 3,
  STSA_N = 4,
  STSA_R = 5,
  RADL_N = 6,
  RADL_R = 7,
  RASL_N = 8,
  RASL_R = 9,
  BLA_W_LP = 16,
  BLA_W_RADL = 17,
  BLA_N_LP = 18,
  IDR_W_RADL = 19,
  IDR_N_LP = 20,
  CRA_NUT = 21,
  VPS = 32,
  SPS = 33,
  PPS = 34,
  AUD = 35,
  EOS_NUT = 36,
  EOB_NUT = 37,
  FD_NUT = 38,
  SEI_PREFIX = 39,
  SEI_SUFFIX = 40,
}

const IRAP_MIN = H265NaluType.BLA_W_LP;
const IRAP_MAX = H265NaluType.CRA_NUT;

export class H265 implements H26xCodec {
  public IsAnnexB(data: Uint8Array): boolean {
    return H265.IsAnnexB(data);
  }

  public AnnexBBoxSize(data: Uint8Array): number | undefined {
    return H265.AnnexBBoxSize(data);
  }

  public IsKeyframe(data: Uint8Array): boolean {
    return H265.IsKeyframe(data);
  }

  public GetFirstNALUOfType(data: Uint8Array, naluType: number): Uint8Array | undefined {
    return H265.GetFirstNALUOfType(data, naluType as H265NaluType);
  }

  public ParseDecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
    return H265.ParseDecoderConfig(data);
  }

  public GetNaluTypeFromHeader(headerByte: number): number {
    return H265.GetNaluTypeFromHeader(headerByte);
  }

  public static IsAnnexB(data: Uint8Array): boolean {
    return isAnnexB(data);
  }

  public static AnnexBBoxSize(data: Uint8Array): number | undefined {
    return annexBBoxSize(data);
  }

  public static IsKeyframe(data: Uint8Array): boolean {
    const boxSize = H265.AnnexBBoxSize(data);
    if (boxSize == undefined) {
      return false;
    }

    let i = boxSize;
    while (i < data.length) {
      const naluType = H265.GetNaluTypeFromHeader(data[i]!);
      if (naluType >= IRAP_MIN && naluType <= IRAP_MAX) {
        return true;
      }

      i = H265.FindNextStartCodeEnd(data, i + 1);
    }

    return false;
  }

  public static GetFirstNALUOfType(
    data: Uint8Array,
    naluType: H265NaluType,
  ): Uint8Array | undefined {
    return getFirstNaluOfType(data, naluType, H265.GetNaluTypeFromHeader);
  }

  public static ParseDecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
    const spsData = H265.GetFirstNALUOfType(data, H265NaluType.SPS);
    if (spsData == undefined) {
      return undefined;
    }

    const sps = new SPSSNALU(spsData);
    if (sps.nal_unit_type !== H265NaluType.SPS) {
      return undefined;
    }

    const config: VideoDecoderConfig = {
      codec: sps.MIME(),
      codedWidth: sps.picWidth,
      codedHeight: sps.picHeight,
    };

    const aspectWidth = sps.sar_width ?? 0;
    const aspectHeight = sps.sar_height ?? 0;
    if (aspectWidth > 1 || aspectHeight > 1) {
      config.displayAspectWidth = Math.round(sps.picWidth * (aspectWidth / aspectHeight));
      config.displayAspectHeight = sps.picHeight;
    }

    return config;
  }

  public static FindNextStartCode(data: Uint8Array, start: number): number {
    return findNextStartCode(data, start);
  }

  public static FindNextStartCodeEnd(data: Uint8Array, start: number): number {
    return findNextStartCodeEnd(data, start);
  }

  public static GetNaluTypeFromHeader(headerByte: number): H265NaluType {
    return ((headerByte >> 1) & 0x3f) as H265NaluType;
  }
}
