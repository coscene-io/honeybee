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
): MessageEvent<CompressedVideo> {
  return {
    topic,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: timeFromNanoseconds(timestamp),
    message: {
      timestamp: timeFromNanoseconds(timestamp),
      frame_id: "camera",
      format: "h264",
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

  it("keeps all delta frames while the queue is not backlogged", () => {
    const waitingForKeyframeTopics = new Set<string>();
    const queue = [
      makeMessage("/camera", 0n, "delta"),
      makeMessage("/camera", 10_000_000n, "delta"),
    ];

    const result = filterCompressedVideoQueue(queue, waitingForKeyframeTopics);

    expect(result.messages).toEqual(queue);
    expect(result.topicsToReset).toEqual(new Set());
    expect(waitingForKeyframeTopics).toEqual(new Set());
  });

  it("keeps the newest GOP when the queue contains keyframes", () => {
    const waitingForKeyframeTopics = new Set<string>();
    const queue = [
      makeMessage("/camera", 0n, "delta"),
      makeMessage("/camera", 10_000_000n, "key"),
      makeMessage("/camera", 20_000_000n, "delta"),
      makeMessage("/camera", 30_000_000n, "key"),
      makeMessage("/camera", 40_000_000n, "delta"),
    ];

    const result = filterCompressedVideoQueue(queue, waitingForKeyframeTopics);

    expect(result.messages).toEqual(queue.slice(3));
    expect(result.topicsToReset).toEqual(new Set(["/camera"]));
    expect(waitingForKeyframeTopics).toEqual(new Set());
  });

  it("filters each topic independently while preserving queue order", () => {
    const waitingForKeyframeTopics = new Set<string>();
    const aDelta = makeMessage("/a", 0n, "delta");
    const bDelta1 = makeMessage("/b", 1n, "delta");
    const aKey = makeMessage("/a", 2n, "key");
    const bDelta2 = makeMessage("/b", 3n, "delta");
    const aDelta2 = makeMessage("/a", 4n, "delta");
    const queue = [aDelta, bDelta1, aKey, bDelta2, aDelta2];

    const result = filterCompressedVideoQueue(queue, waitingForKeyframeTopics);

    expect(result.messages).toEqual([bDelta1, aKey, bDelta2, aDelta2]);
    expect(result.topicsToReset).toEqual(new Set(["/a"]));
    expect(waitingForKeyframeTopics).toEqual(new Set());
  });

  it("waits for a keyframe when a delta-only queue exceeds the message threshold", () => {
    const waitingForKeyframeTopics = new Set<string>();
    const queue = Array.from({ length: 16 }, (_, i) =>
      makeMessage("/camera", BigInt(i) * 10_000_000n, "delta"),
    );

    const result = filterCompressedVideoQueue(queue, waitingForKeyframeTopics);

    expect(result.messages).toEqual([]);
    expect(result.topicsToReset).toEqual(new Set(["/camera"]));
    expect(waitingForKeyframeTopics).toEqual(new Set(["/camera"]));
  });

  it("waits for a keyframe when a delta-only queue exceeds the duration threshold", () => {
    const waitingForKeyframeTopics = new Set<string>();
    const queue = [
      makeMessage("/camera", 0n, "delta"),
      makeMessage("/camera", 600_000_000n, "delta"),
    ];

    const result = filterCompressedVideoQueue(queue, waitingForKeyframeTopics);

    expect(result.messages).toEqual([]);
    expect(result.topicsToReset).toEqual(new Set(["/camera"]));
    expect(waitingForKeyframeTopics).toEqual(new Set(["/camera"]));
  });

  it("drops delta frames while waiting and resumes from the next keyframe", () => {
    const waitingForKeyframeTopics = new Set(["/camera"]);
    const deltaQueue = [makeMessage("/camera", 0n, "delta")];

    const deltaResult = filterCompressedVideoQueue(deltaQueue, waitingForKeyframeTopics);

    expect(deltaResult.messages).toEqual([]);
    expect(deltaResult.topicsToReset).toEqual(new Set());
    expect(waitingForKeyframeTopics).toEqual(new Set(["/camera"]));

    const keyQueue = [
      makeMessage("/camera", 10_000_000n, "key"),
      makeMessage("/camera", 20_000_000n, "delta"),
    ];

    const keyResult = filterCompressedVideoQueue(keyQueue, waitingForKeyframeTopics);

    expect(keyResult.messages).toEqual(keyQueue);
    expect(keyResult.topicsToReset).toEqual(new Set(["/camera"]));
    expect(waitingForKeyframeTopics).toEqual(new Set());
  });
});
