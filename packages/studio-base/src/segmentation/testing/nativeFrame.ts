// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { DecodedSegmentationFrame } from "../runtime";

/**
 * A decoded Image panel frame whose native view maps image pixels 1:1 to screen pixels. With
 * jsdom's identity getScreenCTM stub, pointer coordinates in tests are image pixels. Tests only.
 */
export const TEST_DECODED_FRAME: DecodedSegmentationFrame = {
  recordId: "record-1",
  videoId: "video-1",
  frameId: "frame-0",
  panelId: "test-panel",
  bindingKey: "test",
  bindingGeneration: 0,
  seekTime: 0,
  decodedIdentity: {},
  imageUrl: "",
  nativeView: {
    width: 960,
    height: 540,
    imageWidth: 960,
    imageHeight: 540,
    matrix: [1, 0, 0, 1, 0, 0],
  },
};

/** TEST_DECODED_FRAME for an image of another size, still mapped 1:1 to screen pixels. */
export function nativeFrame(width: number, height: number): DecodedSegmentationFrame {
  return {
    ...TEST_DECODED_FRAME,
    nativeView: {
      width,
      height,
      imageWidth: width,
      imageHeight: height,
      matrix: [1, 0, 0, 1, 0, 0],
    },
  };
}

/** The Image panel after zooming: the same frame under a scaled native view. Tests only. */
export function scaledFrame(scale: number): DecodedSegmentationFrame {
  return {
    ...TEST_DECODED_FRAME,
    nativeView: { ...TEST_DECODED_FRAME.nativeView!, matrix: [scale, 0, 0, scale, 0, 0] },
  };
}
