/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264 } from "@foxglove/den/video";

import { CompressedImageTypes, CompressedVideo } from "./ImageTypes";
import {
  decodeCompressedImageToBitmap,
  isVideoKeyframe,
  getVideoDecoderConfig,
  decodeRawImage,
} from "./decodeImage";
import { Image as RosImage } from "../../ros";

function createMockTime() {
  return { sec: 0, nsec: 0 };
}

function createMockVideoFrame(override?: Partial<CompressedVideo>): CompressedVideo {
  return {
    data: new Uint8Array([]),
    format: "h264",
    timestamp: createMockTime(),
    frame_id: "frame_video",
    ...override,
  };
}

describe("decodeCompressedImageToBitmap", () => {
  it("should decode a compressed image to an ImageBitmap", async () => {
    const mockImage: CompressedImageTypes = {
      data: new Uint8Array([1, 2, 3]),
      format: "jpeg",
      timestamp: createMockTime(),
      frame_id: "frame_1",
    };
    const bitmap = await decodeCompressedImageToBitmap(mockImage);
    expect(bitmap).toBeInstanceOf(ImageBitmap);
  });
});

describe("isVideoKeyframe", () => {
  it("should return true for a keyframe", () => {
    const mockVideoFrame = createMockVideoFrame({
      data: new Uint8Array([0x65]), // Mock IDR NAL unit
    });
    jest.spyOn(H264, "IsKeyframe").mockReturnValue(true);
    expect(isVideoKeyframe(mockVideoFrame)).toBe(true);
  });

  it("should return false for a non-keyframe", () => {
    const mockVideoFrame = createMockVideoFrame({
      data: new Uint8Array([0x41]), // Mock non-IDR NAL unit
    });
    jest.spyOn(H264, "IsKeyframe").mockReturnValue(false);
    expect(isVideoKeyframe(mockVideoFrame)).toBe(false);
  });
});

describe("getVideoDecoderConfig", () => {
  it("should return a VideoDecoderConfig for h264 format", () => {
    const mockVideoFrame = createMockVideoFrame({
      data: new Uint8Array([0x67]), // Mock SPS NAL unit
    });
    const mockConfig = { codec: "avc1.42E01E" };
    jest.spyOn(H264, "ParseDecoderConfig").mockReturnValue(mockConfig);
    expect(getVideoDecoderConfig(mockVideoFrame)).toEqual(mockConfig);
  });

  it("should return undefined for unsupported formats", () => {
    const mockVideoFrame = createMockVideoFrame({
      data: new Uint8Array([0x00]),
    });
    expect(getVideoDecoderConfig(mockVideoFrame)).toBeUndefined();
  });
});

describe("decodeRawImage", () => {
  function createMockROSImage(override?: Partial<RosImage>): RosImage {
    return {
      encoding: "rgb8",
      width: 2,
      height: 2,
      step: 6,
      data: new Uint8Array([]),
      header: {
        frame_id: "",
        stamp: {
          sec: 0,
          nsec: 0,
        },
        seq: undefined,
      },
      is_bigendian: false,
      ...override,
    };
  }

  it.each([
    ["yuv422", 10],
    ["uyvy", 10],
    ["yuv422_yuy2", 10],
    ["yuyv", 10],
    ["rgb8", 6],
    ["rgba8", 8],
    ["bgra8", 8],
    ["bgr8", 6],
    ["8UC3", 6],
    ["32FC1", 8],
    ["bayer_rggb8", 8],
    ["bayer_bggr8", 8],
    ["bayer_gbrg8", 8],
    ["bayer_grbg8", 8],
    ["mono8", 6],
    ["8UC1", 6],
  ])("should not throw for supported encoding: %s", (encoding, step) => {
    expect(() => {
      const mockImage = createMockROSImage({
        step,
        encoding,
        data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]),
      });
      const output = new Uint8ClampedArray(12);
      decodeRawImage(mockImage, {}, output);
    }).not.toThrow();
  });

  it("should throw an error for unsupported encoding", () => {
    const mockImage = createMockROSImage({
      encoding: "unsupported",
    });
    const output = new Uint8ClampedArray(12);
    expect(() => {
      decodeRawImage(mockImage, {}, output);
    }).toThrow("Unsupported encoding unsupported");
  });

  it.each([
    ["yuv422", 10],
    ["uyvy", 10],
    ["yuv422_yuy2", 10],
    ["yuyv", 10],
    ["rgb8", 6],
    ["rgba8", 8],
    ["bgra8", 8],
    ["bgr8", 6],
    ["8UC3", 6],
    ["32FC1", 8],
    ["bayer_rggb8", 8],
    ["bayer_bggr8", 8],
    ["bayer_gbrg8", 8],
    ["bayer_grbg8", 8],
    ["mono8", 6],
    ["8UC1", 6],
  ])("should not throw for supported encoding: %s", (encoding, step) => {
    expect(() => {
      const mockImage = createMockROSImage({
        step,
        encoding,
        data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]),
      });
      const output = new Uint8ClampedArray(12);
      decodeRawImage(mockImage, {}, output);
    }).not.toThrow();
  });
});
