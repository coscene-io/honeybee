// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, Time } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { TopicSelection } from "@foxglove/studio-base/players/types";

import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";
import { KeyframeIndex } from "./keyframeIndex";
import { gopBackfillForVideo } from "./videoBackfill";

const TOPIC = "/camera";

function h264Frame(sec: number, kind: "key" | "delta"): MessageEvent {
  const naluHeader = kind === "key" ? 0x65 : 0x41;
  const data = new Uint8Array([0, 0, 0, 1, naluHeader, 0, 0, 0]);
  return {
    topic: TOPIC,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: { sec, nsec: 0 },
    message: { timestamp: { sec, nsec: 0 }, frame_id: "camera", data, format: "h264" },
    sizeInBytes: data.byteLength,
  };
}

function nonVideoMessage(sec: number): MessageEvent {
  return {
    topic: "/diagnostics",
    schemaName: "foxglove.Log",
    receiveTime: { sec, nsec: 0 },
    message: { level: 1, message: "hello" },
    sizeInBytes: 16,
  };
}

class VideoTestSource implements IIterableSource {
  public readonly iteratorStarts: Array<Time | undefined> = [];
  public readonly iteratorAbortSignals: Array<AbortSignal | undefined> = [];

  public constructor(private readonly frames: MessageEvent[]) {}

  public async initialize(): Promise<Initalization> {
    return {
      start: { sec: 0, nsec: 0 },
      end: { sec: 100, nsec: 0 },
      topics: [],
      topicStats: new Map(),
      profile: undefined,
      problems: [],
      datatypes: new Map(),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    const { start, end, topics, abortSignal } = args;
    this.iteratorStarts.push(start);
    this.iteratorAbortSignals.push(abortSignal);
    for (const frame of this.frames) {
      if (abortSignal?.aborted === true) {
        return;
      }
      if (!topics.has(frame.topic)) {
        continue;
      }
      if (start != undefined && compare(frame.receiveTime, start) < 0) {
        continue;
      }
      if (end != undefined && compare(frame.receiveTime, end) > 0) {
        continue;
      }
      yield { type: "message-event", msgEvent: frame };
    }
  }

  public async getBackfillMessages(_args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    return [];
  }
}

const subscriptions: TopicSelection = new Map([[TOPIC, { topic: TOPIC }]]);
const startTime: Time = { sec: 0, nsec: 0 };

describe("gopBackfillForVideo", () => {
  it("expands a delta-frame backfill into the full GOP from the preceding keyframe", async () => {
    const frames = [
      h264Frame(10, "key"),
      h264Frame(11, "delta"),
      h264Frame(12, "delta"),
      h264Frame(13, "delta"),
    ];
    const source = new VideoTestSource(frames);

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(13, "delta")],
      subscriptions,
      targetTime: { sec: 13, nsec: 0 },
      startTime,
    });

    expect(result.map((m) => m.receiveTime.sec)).toEqual([10, 11, 12, 13]);
    expect(result[0]!.receiveTime.sec).toBe(10);
  });

  it("leaves a keyframe backfill untouched", async () => {
    const source = new VideoTestSource([h264Frame(10, "key")]);
    const backfill = [h264Frame(10, "key")];

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: backfill,
      subscriptions,
      targetTime: { sec: 10, nsec: 0 },
      startTime,
    });

    expect(result).toBe(backfill);
  });

  it("leaves non-video backfill untouched", async () => {
    const source = new VideoTestSource([]);
    const backfill = [nonVideoMessage(5)];

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: backfill,
      subscriptions,
      targetTime: { sec: 5, nsec: 0 },
      startTime,
    });

    expect(result).toBe(backfill);
  });

  it("falls back to the single frame when no keyframe is within the lookback window", async () => {
    const frames = [h264Frame(1, "key"), h264Frame(48, "delta"), h264Frame(49, "delta")];
    const source = new VideoTestSource(frames);
    const backfill = [h264Frame(49, "delta")];

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: backfill,
      subscriptions,
      targetTime: { sec: 49, nsec: 0 },
      startTime,
      lookbackSec: 5,
    });

    expect(result).toBe(backfill);
  });

  it("only replays frames at or before the seek target", async () => {
    const frames = [
      h264Frame(10, "key"),
      h264Frame(11, "delta"),
      h264Frame(12, "delta"),
      h264Frame(13, "delta"),
    ];
    const source = new VideoTestSource(frames);

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(12, "delta")],
      subscriptions,
      targetTime: { sec: 12, nsec: 0 },
      startTime,
    });

    expect(result.map((m) => m.receiveTime.sec)).toEqual([10, 11, 12]);
  });

  it("passes the seek abort signal to the GOP window iterator", async () => {
    const abortController = new AbortController();
    const source = new VideoTestSource([h264Frame(10, "key"), h264Frame(11, "delta")]);

    await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(11, "delta")],
      subscriptions,
      targetTime: { sec: 11, nsec: 0 },
      startTime,
      abortSignal: abortController.signal,
    });

    expect(source.iteratorAbortSignals[0]).toBe(abortController.signal);
  });

  it("uses the keyframe index on a warm seek to read just one GOP instead of the lookback window", async () => {
    const frames = [
      h264Frame(10, "key"),
      h264Frame(15, "delta"),
      h264Frame(20, "key"),
      h264Frame(22, "delta"),
      h264Frame(24, "delta"),
      h264Frame(25, "delta"),
    ];
    const source = new VideoTestSource(frames);
    const keyframeIndexes = new Map<string, KeyframeIndex>();

    const cold = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(25, "delta")],
      subscriptions,
      targetTime: { sec: 25, nsec: 0 },
      startTime,
      keyframeIndexes,
    });
    expect(cold.map((m) => m.receiveTime.sec)).toEqual([20, 22, 24, 25]);
    expect(source.iteratorStarts[0]).toEqual({ sec: 10, nsec: 0 });
    expect(keyframeIndexes.get(TOPIC)!.size()).toBe(2);

    const warm = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(24, "delta")],
      subscriptions,
      targetTime: { sec: 24, nsec: 0 },
      startTime,
      keyframeIndexes,
    });
    expect(warm.map((m) => m.receiveTime.sec)).toEqual([20, 22, 24]);
    expect(source.iteratorStarts[1]).toEqual({ sec: 20, nsec: 0 });
  });
});
