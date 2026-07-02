// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

import { VideoGopCache } from "./videoGopCache";

const TOPIC = "/camera";

function t(sec: number, nsec = 0): Time {
  return { sec, nsec };
}

function h264Frame(
  receiveSec: number,
  publishSec: number,
  kind: "key" | "delta",
  size = 8,
  topic = TOPIC,
): MessageEvent {
  const data = new Uint8Array(Math.max(size, 5));
  data.set([0, 0, 0, 1, kind === "key" ? 0x65 : 0x41]);
  return {
    topic,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: t(receiveSec),
    message: { timestamp: t(publishSec), frame_id: "camera", data, format: "h264" },
    sizeInBytes: 1024 * 1024,
  };
}

describe("VideoGopCache", () => {
  it("replays the GOP covering a receiveTime seek in publish timestamp order", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const delta1 = h264Frame(11, 101, "delta");
    const delta2 = h264Frame(12, 102, "delta");
    cache.addFrames([delta2, key, delta1]);

    expect(cache.framesForReceiveTime(TOPIC, t(12))).toEqual([key, delta1, delta2]);
  });

  it("does not skip a future-received delta when replaying by receiveTime", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(1, 100, "key");
    const futureReceivedDelta = h264Frame(20, 101, "delta");
    const laterPublishDelta = h264Frame(3, 102, "delta");
    cache.addFrames([key, futureReceivedDelta, laterPublishDelta]);

    expect(cache.framesForReceiveTime(TOPIC, t(3))).toEqual([key]);
  });

  it("replays the GOP covering a publishTime seek", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const middle = h264Frame(11, 101, "delta");
    const delta = h264Frame(12, 102, "delta");
    cache.addFrames([key, middle, delta]);

    expect(cache.framesForPublishTime(TOPIC, t(102))).toEqual([key, middle, delta]);
  });

  it("replays only frames after the previous publishTime when requested", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const middle = h264Frame(11, 101, "delta");
    const delta = h264Frame(12, 102, "delta");
    cache.addFrames([key, middle, delta]);

    expect(cache.framesForPublishTime(TOPIC, t(102), t(100))).toEqual([middle, delta]);
  });

  it("dedupes duplicate publish timestamps by keeping the last write", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const first = h264Frame(11, 101, "delta", 8);
    const replacement = h264Frame(12, 101, "delta", 16);
    cache.addFrames([key, first, replacement]);

    expect(cache.framesForReceiveTime(TOPIC, t(12))).toEqual([key, replacement]);
  });

  it("does not stitch a post-seek delta onto an older cached range", () => {
    const cache = new VideoGopCache();
    const oldKey = h264Frame(10, 100, "key");
    const oldDelta = h264Frame(11, 101, "delta");
    const targetDelta = h264Frame(50, 150, "delta");
    cache.addFrames([oldKey, oldDelta]);

    cache.handleSeek(t(50));
    cache.addFrame(targetDelta);

    expect(cache.framesForReceiveTime(TOPIC, t(50))).toBeUndefined();
  });

  it("does not stitch a post-seek publish-time delta onto an older cached range", () => {
    const cache = new VideoGopCache();
    const oldKey = h264Frame(10, 100, "key");
    const oldDelta = h264Frame(11, 101, "delta");
    const targetDelta = h264Frame(50, 150, "delta");
    cache.addFrames([oldKey, oldDelta]);

    cache.handleSeek(t(50));
    cache.addFrame(targetDelta);

    expect(cache.framesForPublishTime(TOPIC, t(150))).toBeUndefined();
  });

  it("continues appending deltas to the GOP selected by a cached receive-time seek", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const seekDelta = h264Frame(11, 101, "delta");
    const nextDelta = h264Frame(12, 102, "delta");
    cache.addFrames([key, seekDelta]);

    cache.handleSeek(t(11));
    expect(cache.seekAndReturnFramesForReceiveTime(TOPIC, t(11))).toEqual([key, seekDelta]);
    cache.addFrame(nextDelta);

    expect(cache.framesForPublishTime(TOPIC, t(102))).toEqual([key, seekDelta, nextDelta]);
  });

  it("replaces a target-only delta range when adding a lookback GOP range", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const middle = h264Frame(11, 101, "delta");
    const targetDelta = h264Frame(50, 150, "delta");

    cache.handleSeek(t(50));
    cache.addFrame(targetDelta);
    expect(cache.framesForPublishTime(TOPIC, t(150))).toBeUndefined();

    cache.addFrameRange([key, middle, targetDelta]);

    expect(cache.framesForPublishTime(TOPIC, t(150))).toEqual([key, middle, targetDelta]);
  });

  it("replays from a keyframe when afterTime is outside the publish-time range", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const delta = h264Frame(11, 101, "delta");
    cache.addFrames([key, delta]);

    expect(cache.framesForPublishTime(TOPIC, t(101), t(50))).toEqual([key, delta]);
  });

  it("does not return a delta-only publish-time sequence when afterTime is outside the range", () => {
    const cache = new VideoGopCache();
    const delta = h264Frame(10, 100, "delta");
    cache.addFrame(delta);

    expect(cache.framesForPublishTime(TOPIC, t(100), t(50))).toBeUndefined();
  });

  it("merges overlapping cached ranges and replays from the nearest keyframe", () => {
    const cache = new VideoGopCache();
    const oldKey = h264Frame(10, 100, "key");
    const oldDelta = h264Frame(11, 101, "delta");
    const newKey = h264Frame(12, 102, "key");
    const newDelta = h264Frame(13, 103, "delta");
    cache.addFrames([oldKey, oldDelta]);
    cache.handleSeek(t(12));
    cache.addFrames([newKey, newDelta]);

    expect(cache.framesForReceiveTime(TOPIC, t(13))).toEqual([newKey, newDelta]);
  });

  it("ignores incomplete or invalid compressed video payloads", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const sliced = {
      ...h264Frame(11, 101, "delta"),
      message: { timestamp: t(101), frame_id: "camera", format: "h264" },
    } as MessageEvent;
    const nonAnnexB = {
      ...h264Frame(12, 102, "delta"),
      message: {
        timestamp: t(102),
        frame_id: "camera",
        format: "h264",
        data: new Uint8Array([0x41]),
      },
    } as MessageEvent;

    expect(cache.addFrame(sliced)).toBe(false);
    expect(cache.addFrame(nonAnnexB)).toBe(false);
    expect(cache.addFrame(key)).toBe(true);
    expect(cache.framesForReceiveTime(TOPIC, t(10))).toEqual([key]);
  });

  it("uses compressed payload byteLength for memory budget and preserves decodable GOPs", () => {
    const cache = new VideoGopCache({ maxBytes: 18 });
    const oldKey = h264Frame(1, 1, "key", 8);
    const oldDelta = h264Frame(2, 2, "delta", 8);
    const newKey = h264Frame(3, 3, "key", 8);
    const newDelta = h264Frame(4, 4, "delta", 8);

    cache.addFrames([oldKey, oldDelta, newKey, newDelta]);

    expect(cache.framesForReceiveTime(TOPIC, t(2))).toBeUndefined();
    expect(cache.framesForReceiveTime(TOPIC, t(4))).toEqual([newKey, newDelta]);
    expect(cache.byteSize()).toBe(16);
  });

  it("keeps byteSize accurate after merging overlapping ranges", () => {
    const cache = new VideoGopCache();
    cache.addFrame(h264Frame(1, 1, "key", 8));
    cache.handleSeek(t(10));
    cache.addFrame(h264Frame(10, 10, "key", 8));
    cache.addFrame(h264Frame(2, 1, "key", 16));
    cache.addFrame(h264Frame(11, 11, "delta", 8));

    expect(cache.byteSize()).toBe(32);
    expect(cache.framesForPublishTime(TOPIC, t(11))).toEqual([
      h264Frame(10, 10, "key", 8),
      h264Frame(11, 11, "delta", 8),
    ]);
  });

  it("indexes keyframe receive times and finds the nearest at or before a target", () => {
    const cache = new VideoGopCache();
    cache.addFrames([
      h264Frame(10, 100, "key"),
      h264Frame(11, 101, "delta"),
      h264Frame(20, 200, "key"),
      h264Frame(21, 201, "delta"),
    ]);

    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(15))).toEqual(t(10));
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(20))).toEqual(t(20));
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(25))).toEqual(t(20));
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(5))).toBeUndefined();
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore("/other", t(15))).toBeUndefined();
  });

  it("records keyframes added via addFrameRange and clears them with the topic", () => {
    const cache = new VideoGopCache();
    cache.addFrameRange([h264Frame(10, 100, "key"), h264Frame(11, 101, "delta")]);

    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(11))).toEqual(t(10));

    cache.clearTopic(TOPIC);
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(11))).toBeUndefined();
  });

  it("indexes a known keyframe receive time without caching GOP frame data", () => {
    const cache = new VideoGopCache();

    cache.addKnownKeyframeReceiveTime(TOPIC, t(10));

    expect(cache.byteSize()).toBe(0);
    expect(cache.framesForReceiveTime(TOPIC, t(10))).toBeUndefined();
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(12))).toEqual(t(10));
  });

  it("retains keyframe times in the index after frame data is evicted", () => {
    const cache = new VideoGopCache({ maxBytes: 18 });
    const oldKey = h264Frame(1, 1, "key", 8);
    const oldDelta = h264Frame(2, 2, "delta", 8);
    const newKey = h264Frame(3, 3, "key", 8);
    const newDelta = h264Frame(4, 4, "delta", 8);

    cache.addFrames([oldKey, oldDelta, newKey, newDelta]);

    // The old GOP's frame data has been evicted by the byte budget...
    expect(cache.framesForReceiveTime(TOPIC, t(2))).toBeUndefined();
    // ...but its keyframe location survives, so a later seek can read exactly that GOP.
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(2))).toEqual(t(1));
    expect(cache.nearestKeyframeReceiveTimeAtOrBefore(TOPIC, t(4))).toEqual(t(3));
  });
});
