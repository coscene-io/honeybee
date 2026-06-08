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

  it("replays the GOP covering a publishTime seek", () => {
    const cache = new VideoGopCache();
    const key = h264Frame(10, 100, "key");
    const middle = h264Frame(11, 101, "delta");
    const delta = h264Frame(12, 102, "delta");
    cache.addFrames([key, middle, delta]);

    expect(cache.framesForPublishTime(TOPIC, t(102))).toEqual([key, middle, delta]);
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

  it("evicts an oversized single range instead of staying over budget forever", () => {
    const cache = new VideoGopCache({ maxBytes: 10 });
    cache.addFrames([h264Frame(1, 1, "key", 8), h264Frame(2, 2, "delta", 8)]);

    expect(cache.byteSize()).toBeLessThanOrEqual(10);
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
});
