// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H265, H265NaluType } from "./H265";

describe("H265", () => {
  describe("GetNaluTypeFromHeader", () => {
    it("should extract NALU type from header byte correctly", () => {
      // H.265 NAL unit header: forbidden_zero_bit (1) | nal_unit_type (6) | nuh_layer_id (6) | nuh_temporal_id_plus1 (3)
      // For the first byte: forbidden_zero_bit (1) | nal_unit_type (6) | nuh_layer_id_high (1)
      // NALU type is extracted as (byte >> 1) & 0x3F

      // IDR_W_RADL (19) = 0b010011
      // First byte with type 19: 0 | 010011 | 0 = 0b00100110 = 0x26
      expect(H265.GetNaluTypeFromHeader(0x26)).toBe(H265NaluType.IDR_W_RADL);

      // IDR_N_LP (20) = 0b010100
      // First byte with type 20: 0 | 010100 | 0 = 0b00101000 = 0x28
      expect(H265.GetNaluTypeFromHeader(0x28)).toBe(H265NaluType.IDR_N_LP);

      // VPS (32) = 0b100000
      // First byte with type 32: 0 | 100000 | 0 = 0b01000000 = 0x40
      expect(H265.GetNaluTypeFromHeader(0x40)).toBe(H265NaluType.VPS);

      // SPS (33) = 0b100001
      // First byte with type 33: 0 | 100001 | 0 = 0b01000010 = 0x42
      expect(H265.GetNaluTypeFromHeader(0x42)).toBe(H265NaluType.SPS);

      // PPS (34) = 0b100010
      // First byte with type 34: 0 | 100010 | 0 = 0b01000100 = 0x44
      expect(H265.GetNaluTypeFromHeader(0x44)).toBe(H265NaluType.PPS);

      // TRAIL_R (1) = 0b000001
      // First byte with type 1: 0 | 000001 | 0 = 0b00000010 = 0x02
      expect(H265.GetNaluTypeFromHeader(0x02)).toBe(H265NaluType.TRAIL_R);

      // TRAIL_N (0) = 0b000000
      // First byte with type 0: 0 | 000000 | 0 = 0b00000000 = 0x00
      expect(H265.GetNaluTypeFromHeader(0x00)).toBe(H265NaluType.TRAIL_N);
    });
  });

  describe("IsAnnexB", () => {
    it("should return true for Annex B data with 3-byte start code", () => {
      const annexB3Bytes = new Uint8Array([0x00, 0x00, 0x01, 0x42, 0x01]);
      expect(H265.IsAnnexB(annexB3Bytes)).toBe(true);
    });

    it("should return true for Annex B data with 4-byte start code", () => {
      const annexB4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x42]);
      expect(H265.IsAnnexB(annexB4Bytes)).toBe(true);
    });

    it("should return false for non-Annex B data", () => {
      const nonAnnexBData = new Uint8Array([0x01, 0x42, 0x01, 0x00]);
      expect(H265.IsAnnexB(nonAnnexBData)).toBe(false);
    });

    it("should return false for data too short", () => {
      const shortData = new Uint8Array([0x00, 0x00]);
      expect(H265.IsAnnexB(shortData)).toBe(false);
    });
  });

  describe("AnnexBBoxSize", () => {
    it("should return 3 for 3-byte start code", () => {
      const annexB3Bytes = new Uint8Array([0x00, 0x00, 0x01, 0x42]);
      expect(H265.AnnexBBoxSize(annexB3Bytes)).toBe(3);
    });

    it("should return 4 for 4-byte start code", () => {
      const annexB4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x42]);
      expect(H265.AnnexBBoxSize(annexB4Bytes)).toBe(4);
    });

    it("should return undefined for invalid data", () => {
      const invalidData = new Uint8Array([0x01, 0x42, 0x00]);
      expect(H265.AnnexBBoxSize(invalidData)).toBeUndefined();
    });
  });

  describe("IsKeyframe", () => {
    it("should return true for IDR_W_RADL frame (type 19)", () => {
      // Start code (4 bytes) + IDR_W_RADL header (type 19, first byte = 0x26)
      const idrFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x26, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(idrFrame)).toBe(true);
    });

    it("should return true for IDR_N_LP frame (type 20)", () => {
      // Start code (4 bytes) + IDR_N_LP header (type 20, first byte = 0x28)
      const idrFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x28, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(idrFrame)).toBe(true);
    });

    it("should return true for CRA frame (type 21)", () => {
      // Start code (4 bytes) + CRA_NUT header (type 21, first byte = 0x2A)
      const craFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x2a, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(craFrame)).toBe(true);
    });

    it("should return true for BLA_W_LP frame (type 16)", () => {
      // Start code (4 bytes) + BLA_W_LP header (type 16, first byte = 0x20)
      const blaFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x20, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(blaFrame)).toBe(true);
    });

    it("should return false for TRAIL_R frame (type 1, P/B frame)", () => {
      // Start code (4 bytes) + TRAIL_R header (type 1, first byte = 0x02)
      const trailFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x02, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(trailFrame)).toBe(false);
    });

    it("should return false for TRAIL_N frame (type 0)", () => {
      // Start code (4 bytes) + TRAIL_N header (type 0, first byte = 0x00)
      const trailFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(trailFrame)).toBe(false);
    });

    it("should return false for VPS/SPS/PPS frames", () => {
      // VPS (type 32)
      const vpsFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(vpsFrame)).toBe(false);

      // SPS (type 33)
      const spsFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x42, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(spsFrame)).toBe(false);

      // PPS (type 34)
      const ppsFrame = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x44, 0x01, 0x00, 0x00]);
      expect(H265.IsKeyframe(ppsFrame)).toBe(false);
    });

    it("should return false for data too short", () => {
      const shortData = new Uint8Array([0x00]);
      expect(H265.IsKeyframe(shortData)).toBe(false);
    });

    it("should find keyframe among multiple NALUs", () => {
      // VPS + SPS + PPS + IDR_W_RADL
      const multiNalu = new Uint8Array([
        // VPS (type 32)
        0x00, 0x00, 0x00, 0x01, 0x40, 0x01,
        // SPS (type 33)
        0x00, 0x00, 0x00, 0x01, 0x42, 0x01,
        // PPS (type 34)
        0x00, 0x00, 0x00, 0x01, 0x44, 0x01,
        // IDR_W_RADL (type 19)
        0x00, 0x00, 0x00, 0x01, 0x26, 0x01,
      ]);
      expect(H265.IsKeyframe(multiNalu)).toBe(true);
    });
  });

  describe("IsKeyframe with Length-Prefixed format", () => {
    it("should return false for length-prefixed IDR frame (unsupported format, only support Annex B)", () => {
      // 4-byte length prefix (value = 4) + IDR_W_RADL (type 19, first byte = 0x26)
      const lengthPrefixedIdr = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x04, // length = 4
        0x26,
        0x01,
        0x00,
        0x00, // IDR_W_RADL NALU
      ]);
      expect(H265.IsKeyframe(lengthPrefixedIdr)).toBe(false);
    });

    it("should return false for length-prefixed non-keyframe", () => {
      // 4-byte length prefix (value = 4) + TRAIL_R (type 1, first byte = 0x02)
      const lengthPrefixedTrail = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x04, // length = 4
        0x02,
        0x01,
        0x00,
        0x00, // TRAIL_R NALU
      ]);
      expect(H265.IsKeyframe(lengthPrefixedTrail)).toBe(false);
    });
  });

  describe("GetFirstNALUOfType", () => {
    it("should find SPS NALU in Annex B stream", () => {
      // VPS + SPS + PPS
      const stream = new Uint8Array([
        // VPS (type 32)
        0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0xaa, 0xbb,
        // SPS (type 33)
        0x00, 0x00, 0x00, 0x01, 0x42, 0x01, 0xcc, 0xdd,
        // PPS (type 34)
        0x00, 0x00, 0x00, 0x01, 0x44, 0x01, 0xee, 0xff,
      ]);

      const sps = H265.GetFirstNALUOfType(stream, H265NaluType.SPS);
      expect(sps).not.toBeUndefined();
      expect(sps![0]).toBe(0x42); // SPS header byte
    });

    it("should find VPS NALU", () => {
      const stream = new Uint8Array([
        // VPS (type 32)
        0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0xaa, 0xbb,
        // SPS (type 33)
        0x00, 0x00, 0x00, 0x01, 0x42, 0x01, 0xcc, 0xdd,
      ]);

      const vps = H265.GetFirstNALUOfType(stream, H265NaluType.VPS);
      expect(vps).not.toBeUndefined();
      expect(vps![0]).toBe(0x40); // VPS header byte
    });

    it("should return undefined if NALU type not found", () => {
      const stream = new Uint8Array([
        // VPS only
        0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0xaa, 0xbb,
      ]);

      const sps = H265.GetFirstNALUOfType(stream, H265NaluType.SPS);
      expect(sps).toBeUndefined();
    });

    it("should return undefined for invalid data", () => {
      const invalidData = new Uint8Array([0x00]);
      const sps = H265.GetFirstNALUOfType(invalidData, H265NaluType.SPS);
      expect(sps).toBeUndefined();
    });
  });

  describe("FindNextStartCode", () => {
    it("should find start codes correctly", () => {
      const data = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x42,
        0x01, // First NALU
        0x00,
        0x00,
        0x01,
        0x44,
        0x01, // Second NALU (3-byte start code)
      ]);

      expect(H265.FindNextStartCode(data, 0)).toBe(0);
      expect(H265.FindNextStartCode(data, 4)).toBe(6);
    });

    it("should return data length if no start code found", () => {
      const data = new Uint8Array([0x42, 0x01, 0xaa, 0xbb]);
      expect(H265.FindNextStartCode(data, 0)).toBe(4);
    });
  });

  describe("FindNextStartCodeEnd", () => {
    it("should find end of start codes correctly", () => {
      const data = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x42,
        0x01, // 4-byte start code
        0x00,
        0x00,
        0x01,
        0x44,
        0x01, // 3-byte start code
      ]);

      expect(H265.FindNextStartCodeEnd(data, 0)).toBe(4); // After 4-byte start code
      expect(H265.FindNextStartCodeEnd(data, 4)).toBe(9); // After 3-byte start code
    });
  });
});
