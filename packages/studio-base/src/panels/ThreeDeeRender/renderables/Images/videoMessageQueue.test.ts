/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264 } from "@foxglove/den/video";
import { Time } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

import { CompressedVideo } from "./ImageTypes";
import { filterCompressedVideoQueue } from "./videoMessageQueue";

function timeFromNanoseconds(timestamp: bigint): Time {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function makeMessage(
  topic: string,
  timestamp: bigint,
  type: "key" | "delta",
  format = "h264",
): MessageEvent<CompressedVideo> {
  return {
    topic,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: timeFromNanoseconds(timestamp),
    message: {
      timestamp: timeFromNanoseconds(timestamp),
      frame_id: "camera",
      format,
      data: new Uint8Array([type === "key" ? 0x65 : 0x41]),
    },
    sizeInBytes: 1,
  };
}

describe("filterCompressedVideoQueue", () => {
  beforeEach(() => {
    jest.spyOn(H264, "IsKeyframe").mockImplementation((data) => data[0] === 0x65);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps all delta frames when there is no keyframe", () => {
    const queue = Array.from({ length: 16 }, (_, i) =>
      makeMessage("/camera", BigInt(i) * 10_000_000n, "delta"),
    );

    const result = filterCompressedVideoQueue(queue);

    expect(result).toEqual(queue);
  });

  it("keeps the newest GOP when the queue contains keyframes", () => {
    const queue = [
      makeMessage("/camera", 0n, "delta"),
      makeMessage("/camera", 10_000_000n, "key"),
      makeMessage("/camera", 20_000_000n, "delta"),
      makeMessage("/camera", 30_000_000n, "key"),
      makeMessage("/camera", 40_000_000n, "delta"),
    ];

    const result = filterCompressedVideoQueue(queue);

    expect(result).toEqual(queue.slice(3));
  });

  it("keeps the full newest GOP even when it is longer than the old message threshold", () => {
    const queue = [
      makeMessage("/camera", 0n, "key"),
      ...Array.from({ length: 20 }, (_, i) =>
        makeMessage("/camera", BigInt(i + 1) * 10_000_000n, "delta"),
      ),
    ];

    const result = filterCompressedVideoQueue(queue);

    expect(result).toEqual(queue);
  });

  it("keeps the full newest GOP even when it spans more than the old duration threshold", () => {
    const queue = [
      makeMessage("/camera", 0n, "key"),
      makeMessage("/camera", 600_000_000n, "delta"),
      makeMessage("/camera", 1_200_000_000n, "delta"),
    ];

    const result = filterCompressedVideoQueue(queue);

    expect(result).toEqual(queue);
  });

  it("filters each topic independently while preserving queue order", () => {
    const aDelta = makeMessage("/a", 0n, "delta");
    const bDelta1 = makeMessage("/b", 1n, "delta");
    const aKey = makeMessage("/a", 2n, "key");
    const bDelta2 = makeMessage("/b", 3n, "delta");
    const aDelta2 = makeMessage("/a", 4n, "delta");
    const queue = [aDelta, bDelta1, aKey, bDelta2, aDelta2];

    const result = filterCompressedVideoQueue(queue);

    expect(result).toEqual([bDelta1, aKey, bDelta2, aDelta2]);
  });

  it("keeps image-like compressed video formats when no keyframes can be detected", () => {
    const queue = Array.from({ length: 20 }, (_, i) =>
      makeMessage("/camera", BigInt(i) * 10_000_000n, "delta", "jpeg"),
    );

    const result = filterCompressedVideoQueue(queue);

    expect(result).toEqual(queue);
  });

  it("returns an empty queue unchanged", () => {
    const result = filterCompressedVideoQueue([]);

    expect(result).toEqual([]);
  });
});
