// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264, H264NaluType } from "./H264";
import { SPS } from "./SPS";
import { BitstreamWriter } from "../h26x/Bitstream";

const SAMPLE_SPS_FRAME = new Uint8Array([
  0x00, 0x00, 0x01, 0x67, 0x64, 0x0, 0x1e, 0xac, 0xb2, 0x1, 0x40, 0x5f, 0xf2, 0xe0, 0x2d, 0x40,
  0x40, 0x40, 0x50, 0x0, 0x0, 0x3, 0x0, 0x10, 0x0, 0x0, 0x3, 0x3, 0x20, 0xf1, 0x62, 0xe4, 0x80,
]);

const SAMPLE_SPS_IDR_FRAME = new Uint8Array([
  ...SAMPLE_SPS_FRAME,
  0x00,
  0x00,
  0x01,
  0x65,
  0x88,
  0x84,
  0x21,
]);

const SAMPLE_NON_LOW_LATENCY_SPS_IDR_FRAME = new Uint8Array([
  0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x0a, 0xf8, 0x41, 0xa2, 0x00, 0x00, 0x01, 0x65, 0x88,
]);

function writeBytesWithBitstreamWriter(input: number[]): Uint8Array {
  const buffer = new Uint8Array(input.length * 2);
  const writer = new BitstreamWriter(buffer);
  for (const byte of input) {
    writer.u_8(byte);
  }
  writer.finish();
  return buffer.subarray(0, writer.bytesWritten());
}

function containsUnescapedStartCodeLikeSequence(data: Uint8Array): boolean {
  for (let i = 0; i <= data.length - 3; i++) {
    if (data[i] === 0x00 && data[i + 1] === 0x00 && data[i + 2]! <= 0x02) {
      return true;
    }
  }
  return false;
}

describe("H264", () => {
  it("FindNextStartCode", () => {
    const NALU1 = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x02, 0x03]);

    expect(H264.FindNextStartCode(NALU1, 0)).toBe(0);
    expect(H264.FindNextStartCode(NALU1, 1)).toBe(1);
    expect(H264.FindNextStartCode(NALU1, 2)).toBe(6);
    expect(H264.FindNextStartCode(NALU1, 3)).toBe(6);
    expect(H264.FindNextStartCode(NALU1, 4)).toBe(6);
    expect(H264.FindNextStartCode(NALU1, 5)).toBe(6);
    expect(H264.FindNextStartCode(NALU1, 6)).toBe(6);
    expect(H264.FindNextStartCode(NALU1, 7)).toBe(6);

    const NALU2 = new Uint8Array([
      0x00, 0x01, 0x03, 0x0a, 0x00, 0x00, 0x01, 0x0b, 0x0c, 0x00, 0x00, 0x00, 0x01, 0x0d,
    ]);
    expect(H264.FindNextStartCode(NALU2, 0)).toBe(4);
    expect(H264.FindNextStartCode(NALU2, 1)).toBe(4);
    expect(H264.FindNextStartCode(NALU2, 2)).toBe(4);
    expect(H264.FindNextStartCode(NALU2, 3)).toBe(4);
    expect(H264.FindNextStartCode(NALU2, 4)).toBe(4);
    expect(H264.FindNextStartCode(NALU2, 5)).toBe(9);
    expect(H264.FindNextStartCode(NALU2, 6)).toBe(9);
    expect(H264.FindNextStartCode(NALU2, 7)).toBe(9);
    expect(H264.FindNextStartCode(NALU2, 8)).toBe(9);
    expect(H264.FindNextStartCode(NALU2, 9)).toBe(9);
    expect(H264.FindNextStartCode(NALU2, 10)).toBe(10);
    expect(H264.FindNextStartCode(NALU2, 11)).toBe(14);
    expect(H264.FindNextStartCode(NALU2, 12)).toBe(14);
    expect(H264.FindNextStartCode(NALU2, 13)).toBe(14);
    expect(H264.FindNextStartCode(NALU2, 14)).toBe(14);
    expect(H264.FindNextStartCode(NALU2, 15)).toBe(14);
  });

  it("FindNextStartCodeEnd", () => {
    const NALU1 = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x02, 0x03]);

    expect(H264.FindNextStartCodeEnd(NALU1, 0)).toBe(0 + 4);
    expect(H264.FindNextStartCodeEnd(NALU1, 1)).toBe(1 + 3);
    expect(H264.FindNextStartCodeEnd(NALU1, 2)).toBe(6);
    expect(H264.FindNextStartCodeEnd(NALU1, 3)).toBe(6);
    expect(H264.FindNextStartCodeEnd(NALU1, 4)).toBe(6);
    expect(H264.FindNextStartCodeEnd(NALU1, 5)).toBe(6);
    expect(H264.FindNextStartCodeEnd(NALU1, 6)).toBe(6);
    expect(H264.FindNextStartCodeEnd(NALU1, 7)).toBe(6);

    const NALU2 = new Uint8Array([
      0x00, 0x01, 0x03, 0x0a, 0x00, 0x00, 0x01, 0x0b, 0x0c, 0x00, 0x00, 0x00, 0x01, 0x0d,
    ]);
    expect(H264.FindNextStartCodeEnd(NALU2, 0)).toBe(4 + 3);
    expect(H264.FindNextStartCodeEnd(NALU2, 1)).toBe(4 + 3);
    expect(H264.FindNextStartCodeEnd(NALU2, 2)).toBe(4 + 3);
    expect(H264.FindNextStartCodeEnd(NALU2, 3)).toBe(4 + 3);
    expect(H264.FindNextStartCodeEnd(NALU2, 4)).toBe(4 + 3);
    expect(H264.FindNextStartCodeEnd(NALU2, 5)).toBe(9 + 4);
    expect(H264.FindNextStartCodeEnd(NALU2, 6)).toBe(9 + 4);
    expect(H264.FindNextStartCodeEnd(NALU2, 7)).toBe(9 + 4);
    expect(H264.FindNextStartCodeEnd(NALU2, 8)).toBe(9 + 4);
    expect(H264.FindNextStartCodeEnd(NALU2, 9)).toBe(9 + 4);
    expect(H264.FindNextStartCodeEnd(NALU2, 10)).toBe(10 + 3);
    expect(H264.FindNextStartCodeEnd(NALU2, 11)).toBe(14);
    expect(H264.FindNextStartCodeEnd(NALU2, 12)).toBe(14);
    expect(H264.FindNextStartCodeEnd(NALU2, 13)).toBe(14);
    expect(H264.FindNextStartCodeEnd(NALU2, 14)).toBe(14);
    expect(H264.FindNextStartCodeEnd(NALU2, 15)).toBe(14);
  });

  it("GetFirstNALUOfType", () => {
    const INPUT = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x0a, 0xf8, 0x41, 0xa2, 0x00, 0x00, 0x00, 0x01,
      0xff,
    ]);

    const nalu = H264.GetFirstNALUOfType(INPUT, 7); // SPS
    expect(nalu).not.toBeUndefined();
    expect(nalu!.byteLength).toBe(7);
    expect(nalu![0]).toBe(0x67);
  });

  it("GetFirstNALUOfType with boxSize of AnnexB undefined", () => {
    const INPUT = new Uint8Array([0x00]);

    const nalu = H264.GetFirstNALUOfType(INPUT, 7); // SPS
    expect(nalu).toBeUndefined();
  });

  it("ParseDecoderConfig", () => {
    const NALU = new Uint8Array([
      0x00, 0x00, 0x01, 0x67, 0x64, 0x0, 0x1e, 0xac, 0xb2, 0x1, 0x40, 0x5f, 0xf2, 0xe0, 0x2d, 0x40,
      0x40, 0x40, 0x50, 0x0, 0x0, 0x3, 0x0, 0x10, 0x0, 0x0, 0x3, 0x3, 0x20, 0xf1, 0x62, 0xe4, 0x80,
    ]);
    const decoderConfig = H264.ParseDecoderConfig(NALU);
    expect(decoderConfig).toEqual({
      codec: "avc1.64001E",
      codedWidth: 640,
      codedHeight: 368,
    });
  });

  it("ParseDecoderConfig with spsData undefined", () => {
    const NALU = new Uint8Array([0x00]);
    const decoderConfig = H264.ParseDecoderConfig(NALU);
    expect(decoderConfig).toBeUndefined();
  });

  it("ParseDecoderConfig with nal_unit_type not being SPS", () => {
    const NALU = new Uint8Array([
      0x00, 0x00, 0x01, 0x67, 0x64, 0x0, 0x1e, 0xac, 0xb2, 0x1, 0x40, 0x5f, 0xf2, 0xe0, 0x2d, 0x40,
      0x40, 0x40, 0x50, 0x0, 0x0, 0x3, 0x0, 0x10, 0x0, 0x0, 0x3, 0x3, 0x20, 0xf1, 0x62, 0xe4, 0x80,
    ]);
    NALU[0] = 0x67; // Change the nal_unit_type to something other than SPS
    const decoderConfig = H264.ParseDecoderConfig(NALU);
    expect(decoderConfig).toBeUndefined();
  });

  it("IsAnnexB", () => {
    const annexBData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67]);
    const nonAnnexBData = new Uint8Array([0x01, 0x67, 0x42, 0x00]);

    expect(H264.IsAnnexB(annexBData)).toBe(true);
    expect(H264.IsAnnexB(nonAnnexBData)).toBe(false);
  });

  it("AnnexBBoxSize", () => {
    const annexB3Bytes = new Uint8Array([0x00, 0x00, 0x01, 0x67]);
    const annexB4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67]);
    const invalidData = new Uint8Array([0x01, 0x67, 0x42]);

    expect(H264.AnnexBBoxSize(annexB3Bytes)).toBe(3);
    expect(H264.AnnexBBoxSize(annexB4Bytes)).toBe(4);
    expect(H264.AnnexBBoxSize(invalidData)).toBeUndefined();
  });

  it("IsKeyframe", () => {
    const keyframeData = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x21, 0x00, 0x00, 0x00, 0x01, 0x41,
    ]); // IDR NALU
    const nonKeyframeData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x61, 0x88, 0x84, 0x21]); // Non-IDR NALU

    expect(H264.IsKeyframe(keyframeData)).toBe(true);
    expect(H264.IsKeyframe(nonKeyframeData)).toBe(false);
  });

  it("IsKeyframe, but box size of annexB is undefined", () => {
    const keyframeData = new Uint8Array([0x00]); // data length < 5

    expect(H264.IsKeyframe(keyframeData)).toBe(false);
  });

  it("GetFrameInfo identifies keyframes, SPS, delta frames, and non-AnnexB data", () => {
    expect(
      H264.GetFrameInfo(
        new Uint8Array([
          0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x21, 0x00, 0x00, 0x00, 0x01, 0x41,
        ]),
      ),
    ).toEqual({ isKeyFrame: true, mayNeedRewrite: true });
    expect(H264.GetFrameInfo(SAMPLE_SPS_FRAME)).toEqual({
      isKeyFrame: false,
      mayNeedRewrite: true,
    });
    expect(H264.GetFrameInfo(new Uint8Array([0x00, 0x00, 0x01, 0x41, 0x88]))).toEqual({
      isKeyFrame: false,
      mayNeedRewrite: false,
    });
    expect(H264.GetFrameInfo(new Uint8Array([0x01, 0x67, 0x42, 0x00]))).toEqual({
      isKeyFrame: false,
      mayNeedRewrite: false,
    });
  });

  it("BitstreamWriter inserts emulation prevention bytes for dangerous byte sequences", () => {
    expect(writeBytesWithBitstreamWriter([0x00, 0x00, 0x00])).toEqual(
      new Uint8Array([0x00, 0x00, 0x03, 0x00]),
    );
    expect(writeBytesWithBitstreamWriter([0x00, 0x00, 0x01])).toEqual(
      new Uint8Array([0x00, 0x00, 0x03, 0x01]),
    );
    expect(writeBytesWithBitstreamWriter([0x00, 0x00, 0x02])).toEqual(
      new Uint8Array([0x00, 0x00, 0x03, 0x02]),
    );
    expect(writeBytesWithBitstreamWriter([0x00, 0x00, 0x03])).toEqual(
      new Uint8Array([0x00, 0x00, 0x03, 0x03]),
    );
    expect(writeBytesWithBitstreamWriter([0x00, 0x00, 0x00, 0x00, 0x01])).toEqual(
      new Uint8Array([0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x01]),
    );
  });

  it("RewriteForLowLatencyDecoding rewrites SPS bitstream restriction fields", () => {
    const rewritten = H264.RewriteForLowLatencyDecoding(SAMPLE_NON_LOW_LATENCY_SPS_IDR_FRAME);
    expect(rewritten).toBeDefined();

    const decoderConfig = H264.ParseDecoderConfig(rewritten!);
    expect(decoderConfig).toEqual({
      codec: "avc1.42000A",
      codedWidth: 128,
      codedHeight: 96,
    });
    expect(H264.GetFirstNALUOfType(rewritten!, H264NaluType.IDR)?.[0]).toBe(0x65);

    const spsData = H264.GetFirstNALUOfType(rewritten!, H264NaluType.SPS);
    expect(spsData).toBeDefined();
    expect(containsUnescapedStartCodeLikeSequence(spsData!)).toBe(false);
    const sps = new SPS(spsData!);
    expect(sps.vui_parameters_present_flag).toBe(1);
    expect(sps.bitstream_restriction_flag).toBe(1);
    expect(sps.max_num_reorder_frames).toBe(0);
    expect(sps.max_dec_frame_buffering).toBe(sps.max_num_ref_frames);
  });

  it("RewriteForLowLatencyDecoding returns undefined for already low-latency SPS", () => {
    const rewritten = H264.RewriteForLowLatencyDecoding(SAMPLE_NON_LOW_LATENCY_SPS_IDR_FRAME);
    expect(rewritten).toBeDefined();

    expect(H264.RewriteForLowLatencyDecoding(rewritten!)).toBeUndefined();
    expect(H264.RewriteForLowLatencyDecoding(SAMPLE_SPS_IDR_FRAME)).toBeUndefined();
  });
});
