// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";

import { Mp4IterableSource } from "./Mp4IterableSource";
import {
  REMOTE_VIDEO_FRAME_REFERENCE_DATATYPE,
  REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME,
} from "./RemoteVideoFrameRegistry";

describe("Mp4IterableSource", () => {
  it("emits presentation-ordered VFR references and seeks with backfill", async () => {
    const controller = {
      initialize: jest.fn(async () => ({
        codec: "avc1.640028",
        codecFamily: "avc" as const,
        width: 1920,
        height: 1080,
        rotation: 0,
        startTimestampSeconds: 0,
        durationSeconds: 1,
        endTimeNs: 1_000_000_000n,
        frames: [
          { timestampNs: 0n, durationNs: 100_000_000n },
          { timestampNs: 100_000_000n, durationNs: 300_000_000n },
          { timestampNs: 400_000_000n, durationNs: 600_000_000n },
        ],
      })),
      getFrame: jest.fn(async () => ({ clone: jest.fn() }) as unknown as VideoFrame),
      dispose: jest.fn(async () => undefined),
    };
    const source = new Mp4IterableSource({
      url: "https://example.com/video.mp4",
      controller,
      providerId: "test-provider",
    });

    const initialization = await source.initialize();
    expect(initialization.end).toEqual(fromNanoSec(1_000_000_000n));
    expect(initialization.problems).toEqual([]);
    expect(initialization.datatypes).toEqual(
      new Map([[REMOTE_VIDEO_FRAME_REFERENCE_SCHEMA_NAME, REMOTE_VIDEO_FRAME_REFERENCE_DATATYPE]]),
    );

    const results = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/camera/h264", { topic: "/camera/h264" }]]),
      start: fromNanoSec(50_000_000n),
      end: fromNanoSec(450_000_000n),
    })) {
      results.push(result);
    }
    expect(
      results.map((result) =>
        result.type === "message-event" ? toNanoSec(result.msgEvent.receiveTime) : undefined,
      ),
    ).toEqual([100_000_000n, 400_000_000n]);

    const backfill = await source.getBackfillMessages({
      topics: new Map([["/camera/h264", { topic: "/camera/h264" }]]),
      time: fromNanoSec(350_000_000n),
    });
    expect(backfill).toHaveLength(1);
    expect(toNanoSec(backfill[0]!.receiveTime)).toBe(100_000_000n);
    expect(backfill[0]!.message).toMatchObject({
      provider_id: "test-provider",
      duration: fromNanoSec(300_000_000n),
    });

    await source.terminate();
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });
});
