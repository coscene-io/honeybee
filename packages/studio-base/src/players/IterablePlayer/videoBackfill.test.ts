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
import { gopBackfillForVideo } from "./videoBackfill";
import { VideoGopCache } from "./videoGopCache";

const TOPIC = "/camera";
const TOPIC_2 = "/camera2";

function h264Frame(sec: number, kind: "key" | "delta", topic = TOPIC): MessageEvent {
  const naluHeader = kind === "key" ? 0x65 : 0x41;
  const data = new Uint8Array([0, 0, 0, 1, naluHeader, 0, 0, 0]);
  return {
    topic,
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
  public readonly iteratorArgs: MessageIteratorArgs[] = [];

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
    this.iteratorArgs.push(args);
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
      lookbackWindowsSec: [5],
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

  it("replays from cache on a warm seek without reading the source", async () => {
    const frames = [
      h264Frame(10, "key"),
      h264Frame(15, "delta"),
      h264Frame(20, "key"),
      h264Frame(22, "delta"),
      h264Frame(24, "delta"),
      h264Frame(25, "delta"),
    ];
    const source = new VideoTestSource(frames);
    const cache = new VideoGopCache();

    const cold = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(25, "delta")],
      subscriptions,
      targetTime: { sec: 25, nsec: 0 },
      startTime,
      gopCache: cache,
    });
    expect(cold.map((m) => m.receiveTime.sec)).toEqual([20, 22, 24, 25]);
    expect(source.iteratorStarts[0]).toEqual({ sec: 20, nsec: 0 });

    const warm = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(24, "delta")],
      subscriptions,
      targetTime: { sec: 24, nsec: 0 },
      startTime,
      gopCache: cache,
    });
    expect(warm.map((m) => m.receiveTime.sec)).toEqual([20, 22, 24]);
    expect(source.iteratorStarts).toHaveLength(1);
  });

  it("progressively expands lookback windows per topic until a keyframe is found", async () => {
    const frames = [
      h264Frame(49, "key"),
      h264Frame(58, "delta"),
      h264Frame(60, "delta"),
      h264Frame(55, "key", TOPIC_2),
      h264Frame(60, "delta", TOPIC_2),
    ];
    const source = new VideoTestSource(frames);
    const subs: TopicSelection = new Map([
      [TOPIC, { topic: TOPIC }],
      [TOPIC_2, { topic: TOPIC_2 }],
    ]);

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(60, "delta"), h264Frame(60, "delta", TOPIC_2)],
      subscriptions: subs,
      targetTime: { sec: 60, nsec: 0 },
      startTime,
      lookbackWindowsSec: [5, 10, 20],
    });

    expect(result.map((m) => `${m.topic}:${m.receiveTime.sec}`)).toEqual([
      `${TOPIC}:49`,
      `${TOPIC_2}:55`,
      `${TOPIC}:58`,
      `${TOPIC}:60`,
      `${TOPIC_2}:60`,
    ]);
    expect(source.iteratorStarts.map((start) => start?.sec)).toEqual([55, 50, 40, 55]);
  });

  it("ignores subscribed fields and reads full video payloads for lookback", async () => {
    const source = new VideoTestSource([h264Frame(10, "key"), h264Frame(11, "delta")]);
    const slicedSubscriptions: TopicSelection = new Map([
      [TOPIC, { topic: TOPIC, fields: ["timestamp"] }],
    ]);

    await gopBackfillForVideo({
      source,
      backfillMessages: [h264Frame(11, "delta")],
      subscriptions: slicedSubscriptions,
      targetTime: { sec: 11, nsec: 0 },
      startTime,
    });

    expect(source.iteratorArgs[0]!.topics.get(TOPIC)).toEqual({ topic: TOPIC });
    expect(source.iteratorArgs[0]!.consumptionType).toBe("full");
  });

  it("preserves non-video backfill while replacing only video topics with GOP replay", async () => {
    const source = new VideoTestSource([h264Frame(10, "key"), h264Frame(11, "delta")]);

    const result = await gopBackfillForVideo({
      source,
      backfillMessages: [nonVideoMessage(11), h264Frame(11, "delta")],
      subscriptions,
      targetTime: { sec: 11, nsec: 0 },
      startTime,
    });

    expect(result.map((m) => m.topic)).toEqual([TOPIC, "/diagnostics", TOPIC]);
    expect(result.map((m) => m.receiveTime.sec)).toEqual([10, 11, 11]);
  });
});
