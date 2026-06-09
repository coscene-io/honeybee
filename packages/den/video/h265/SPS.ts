// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Bitstream } from "../h26x/Bitstream";

const NALU_TYPE_SPS = 33;

type ProfileTierLevel = {
  general_profile_space: number;
  general_tier_flag: number;
  general_profile_idc: number;
  general_profile_compatibility_flags: number;
  general_constraint_indicator_flags: Uint8Array; // 6 bytes of constraint flags
  general_level_idc: number;
};

export class SPS {
  public nal_unit_type: number | undefined;
  public nuh_layer_id: number | undefined;
  public nuh_temporal_id_plus1: number | undefined;

  public sps_video_parameter_set_id: number;
  public sps_max_sub_layers_minus1: number;
  public sps_temporal_id_nesting_flag: number;
  public sps_seq_parameter_set_id: number;
  public chroma_format_idc: number;
  public separate_colour_plane_flag: number | undefined;
  public pic_width_in_luma_samples: number;
  public pic_height_in_luma_samples: number;
  public conformance_window_flag: number;
  public conf_win_left_offset: number | undefined;
  public conf_win_right_offset: number | undefined;
  public conf_win_top_offset: number | undefined;
  public conf_win_bottom_offset: number | undefined;
  public bit_depth_luma_minus8: number;
  public bit_depth_chroma_minus8: number;
  public log2_max_pic_order_cnt_lsb_minus4: number;

  public picWidth: number;
  public picHeight: number;

  public sar_width: number | undefined;
  public sar_height: number | undefined;

  public general_profile_space: number;
  public general_tier_flag: number;
  public general_profile_idc: number;
  public general_profile_compatibility_flags: number;
  public general_constraint_indicator_flags: Uint8Array; // 6 bytes
  public general_level_idc: number;

  public constructor(data: Uint8Array) {
    const bitstream = new Bitstream(data);

    const forbidden_zero_bit = bitstream.u_1();
    if (forbidden_zero_bit !== 0) {
      throw new Error("NALU error: invalid NALU header");
    }
    this.nal_unit_type = bitstream.u(6);
    this.nuh_layer_id = bitstream.u(6);
    this.nuh_temporal_id_plus1 = bitstream.u(3);
    if (this.nal_unit_type !== NALU_TYPE_SPS) {
      throw new Error("SPS error: not SPS");
    }

    this.sps_video_parameter_set_id = bitstream.u(4);
    this.sps_max_sub_layers_minus1 = bitstream.u(3);
    this.sps_temporal_id_nesting_flag = bitstream.u_1();

    const profileTierLevel = readProfileTierLevel(bitstream, this.sps_max_sub_layers_minus1);
    this.general_profile_space = profileTierLevel.general_profile_space;
    this.general_tier_flag = profileTierLevel.general_tier_flag;
    this.general_profile_idc = profileTierLevel.general_profile_idc;
    this.general_profile_compatibility_flags = profileTierLevel.general_profile_compatibility_flags;
    this.general_constraint_indicator_flags = profileTierLevel.general_constraint_indicator_flags;
    this.general_level_idc = profileTierLevel.general_level_idc;

    this.sps_seq_parameter_set_id = bitstream.ue_v();
    this.chroma_format_idc = bitstream.ue_v();
    if (this.chroma_format_idc === 3) {
      this.separate_colour_plane_flag = bitstream.u_1();
    }

    this.pic_width_in_luma_samples = bitstream.ue_v();
    this.pic_height_in_luma_samples = bitstream.ue_v();

    this.conformance_window_flag = bitstream.u_1();
    if (this.conformance_window_flag !== 0) {
      this.conf_win_left_offset = bitstream.ue_v();
      this.conf_win_right_offset = bitstream.ue_v();
      this.conf_win_top_offset = bitstream.ue_v();
      this.conf_win_bottom_offset = bitstream.ue_v();
    }

    this.bit_depth_luma_minus8 = bitstream.ue_v();
    this.bit_depth_chroma_minus8 = bitstream.ue_v();
    this.log2_max_pic_order_cnt_lsb_minus4 = bitstream.ue_v();

    const { cropWidth, cropHeight } = calculateConformanceCrop(
      this.chroma_format_idc,
      this.separate_colour_plane_flag ?? 0,
      this.conf_win_left_offset ?? 0,
      this.conf_win_right_offset ?? 0,
      this.conf_win_top_offset ?? 0,
      this.conf_win_bottom_offset ?? 0,
    );

    this.picWidth = this.pic_width_in_luma_samples - cropWidth;
    this.picHeight = this.pic_height_in_luma_samples - cropHeight;
  }

  /**
   * Returns the MIME codec string for H.265/HEVC according to RFC 6381.
   * Format: hvc1.{profile_space}{profile_idc}.{compatibility_flags}.{tier}{level_idc}.{constraint_bytes}
   *
   * Example: hvc1.1.6.L93.B0 (Main profile, level 3.1)
   */
  public MIME(): string {
    const parts: string[] = ["hvc1"];

    // Profile space: empty for 0, 'A' for 1, 'B' for 2, 'C' for 3
    const profileSpaceChar =
      this.general_profile_space === 0 ? "" : String.fromCharCode(64 + this.general_profile_space);

    // Profile IDC as decimal
    parts.push(`${profileSpaceChar}${this.general_profile_idc}`);

    // Profile compatibility flags as reversed hex (LSB first per spec)
    const compatFlags = reverseU32(this.general_profile_compatibility_flags);
    parts.push(compatFlags.toString(16).toUpperCase());

    // Tier flag: 'L' for Main tier (0), 'H' for High tier (1)
    const tierChar = this.general_tier_flag === 0 ? "L" : "H";

    // Level IDC as decimal
    parts.push(`${tierChar}${this.general_level_idc}`);

    // Constraint indicator flags as hex bytes (trailing zeros can be omitted)
    const constraintHex = formatConstraintBytes(this.general_constraint_indicator_flags);
    if (constraintHex.length > 0) {
      parts.push(constraintHex);
    }

    return parts.join(".");
  }
}

/**
 * Format constraint indicator bytes as hex string, omitting trailing zero bytes.
 */
function formatConstraintBytes(bytes: Uint8Array): string {
  // Find the last non-zero byte
  let lastNonZero = bytes.length - 1;
  while (lastNonZero >= 0 && bytes[lastNonZero] === 0) {
    lastNonZero--;
  }

  if (lastNonZero < 0) {
    return "";
  }

  // Format bytes up to and including the last non-zero byte
  let result = "";
  for (let i = 0; i <= lastNonZero; i++) {
    result += byteToHex(bytes[i]!);
  }
  return result.toUpperCase();
}

function byteToHex(val: number): string {
  return ("00" + val.toString(16)).slice(-2);
}

function reverseU32(val: number): number {
  let result = 0;
  for (let i = 0; i < 32; i++) {
    result = (result << 1) | ((val >> i) & 1);
  }
  return result >>> 0; // Ensure unsigned
}

function readProfileTierLevel(bitstream: Bitstream, maxSubLayersMinus1: number): ProfileTierLevel {
  const general_profile_space = bitstream.u(2);
  const general_tier_flag = bitstream.u_1();
  const general_profile_idc = bitstream.u(5);
  const general_profile_compatibility_flags = bitstream.u(32);

  // Read 48 bits (6 bytes) of constraint indicator flags
  // These are: progressive_source_flag(1) + interlaced_source_flag(1) +
  // non_packed_constraint_flag(1) + frame_only_constraint_flag(1) + reserved_zero_44bits(44)
  const general_constraint_indicator_flags = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    general_constraint_indicator_flags[i] = bitstream.u_8();
  }

  const general_level_idc = bitstream.u(8);

  const subLayerProfilePresentFlags: number[] = [];
  const subLayerLevelPresentFlags: number[] = [];
  for (let i = 0; i < maxSubLayersMinus1; i++) {
    subLayerProfilePresentFlags[i] = bitstream.u_1();
    subLayerLevelPresentFlags[i] = bitstream.u_1();
  }
  if (maxSubLayersMinus1 > 0) {
    for (let i = maxSubLayersMinus1; i < 8; i++) {
      bitstream.u(2); // reserved_zero_2bits
    }
  }
  for (let i = 0; i < maxSubLayersMinus1; i++) {
    if (subLayerProfilePresentFlags[i] === 1) {
      bitstream.u(2); // sub_layer_profile_space
      bitstream.u_1(); // sub_layer_tier_flag
      bitstream.u(5); // sub_layer_profile_idc
      bitstream.u(32); // sub_layer_profile_compatibility_flags
      bitstream.u_1(); // sub_layer_progressive_source_flag
      bitstream.u_1(); // sub_layer_interlaced_source_flag
      bitstream.u_1(); // sub_layer_non_packed_constraint_flag
      bitstream.u_1(); // sub_layer_frame_only_constraint_flag
      bitstream.u(44); // sub_layer_reserved_zero_44bits
    }
    if (subLayerLevelPresentFlags[i] === 1) {
      bitstream.u(8); // sub_layer_level_idc
    }
  }

  return {
    general_profile_space,
    general_tier_flag,
    general_profile_idc,
    general_profile_compatibility_flags,
    general_constraint_indicator_flags,
    general_level_idc,
  };
}

function calculateConformanceCrop(
  chromaFormatIdc: number,
  separateColourPlaneFlag: number,
  confWinLeftOffset: number,
  confWinRightOffset: number,
  confWinTopOffset: number,
  confWinBottomOffset: number,
): { cropWidth: number; cropHeight: number } {
  let subWidthC = 1;
  let subHeightC = 1;

  if (chromaFormatIdc === 1) {
    subWidthC = 2;
    subHeightC = 2;
  } else if (chromaFormatIdc === 2) {
    subWidthC = 2;
    subHeightC = 1;
  } else if (chromaFormatIdc === 3 && separateColourPlaneFlag === 0) {
    subWidthC = 1;
    subHeightC = 1;
  }

  const cropUnitX = subWidthC;
  const cropUnitY = subHeightC;

  const cropWidth = (confWinLeftOffset + confWinRightOffset) * cropUnitX;
  const cropHeight = (confWinTopOffset + confWinBottomOffset) * cropUnitY;

  return { cropWidth, cropHeight };
}
