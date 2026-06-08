/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264 } from "@foxglove/den/video";
import { Time, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { CompressedVideoController } from "./CompressedVideoController";
import { ImageSetImageResult } from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";
import { PartialMessageEvent } from "../../SceneExtension";

function timeFromNanoseconds(timestamp: bigint): Time {
  return {
    sec: Number(timestamp / 1_000_000_000n),
    nsec: Number(timestamp % 1_000_000_000n),
  };
}

function makeVideoMessage(
  timestamp: bigint,
  type: "key" | "delta",
  topic = "/camera",
): MessageEvent<CompressedVideo> {
  return makeVideoMessageWithTimes(timestamp, timestamp, type, topic);
}

function makeVideoMessageWithTimes(
  receiveTimestamp: bigint,
  publishTimestamp: bigint,
  type: "key" | "delta",
  topic = "/camera",
): MessageEvent<CompressedVideo> {
  return {
    topic,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: timeFromNanoseconds(receiveTimestamp),
    message: {
      timestamp: timeFromNanoseconds(publishTimestamp),
      frame_id: "camera",
      format: "h264",
      data: new Uint8Array([type === "key" ? 0x65 : 0x41]),
    },
    sizeInBytes: 1,
  };
}

function makeRenderer(
  options: {
    currentTime?: bigint;
    startTime?: bigint;
    subscribeMessageRange?: SubscribeMessageRange;
  } = {},
) {
  return {
    currentTime: options.currentTime ?? 0n,
    startTime: options.startTime ?? 0n,
    subscribeMessageRange: options.subscribeMessageRange,
    queueAnimationFrame: jest.fn(),
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("CompressedVideoController", () => {
  beforeEach(() => {
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "IsKeyframe").mockImplementation((data) => data[0] === 0x65);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("marks non-seek frames as playback display mode", () => {
    const keyframe = makeVideoMessage(0n, "key");
    const displayFrame = jest.fn();
    const renderer = makeRenderer();
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.processMessage(keyframe);

    expect(displayFrame.mock.calls.map((call) => call[2])).toEqual(["playback"]);
  });

  it("replays cached GOP frames on seek", () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrame = jest.fn();
    const renderer = makeRenderer();
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    displayFrame.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();

    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      keyframe,
      delta,
    ]);
    expect(displayFrame.mock.calls.map((call) => call[2])).toEqual(["seek", "seek"]);
  });

  it("resets the decoder before replaying cached GOP frames on seek", () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const events: string[] = [];
    const displayFrame = jest.fn((messageEvent: PartialMessageEvent<CompressedVideo>) => {
      events.push(`display:${toNanoSec(messageEvent.receiveTime)}`);
      return { ok: true };
    });
    const resetDecoder = jest.fn((topic: string) => {
      events.push(`reset:${topic}`);
    });
    const renderer = makeRenderer();
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
      resetDecoder,
    });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    displayFrame.mockClear();
    events.length = 0;

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();

    expect(resetDecoder).toHaveBeenCalledWith("/camera");
    expect(events).toEqual(["reset:/camera", "display:0", "display:10000000"]);
  });

  it("uses progressive lookback when seek receives a delta frame outside the cache", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrame = jest.fn();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, delta, seekDelta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.handleSeek();
    controller.processMessage(seekDelta);
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 20_000_000 },
        },
      }),
    );
    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      keyframe,
      delta,
      seekDelta,
    ]);
    expect(displayFrame.mock.calls.map((call) => call[2])).toEqual(["seek", "seek", "seek"]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses progressive lookback for an initial seek-backfill delta even when handleSeek was not called", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrame = jest.fn(async (..._args: unknown[]) => ({ ok: true }));
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, delta, seekDelta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.processMessage(seekDelta);
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 20_000_000 },
        },
      }),
    );
    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      keyframe,
      delta,
      seekDelta,
    ]);
    expect(displayFrame.mock.calls.map((call) => call[2])).toEqual(["seek", "seek", "seek"]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("starts lookback on seek for a registered topic even before any frame was received", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrame = jest.fn(async (..._args: unknown[]) => ({ ok: true }));
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, delta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ currentTime: 10_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.registerTopic("/camera");
    controller.handleSeek();
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 10_000_000 },
        },
      }),
    );
    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      keyframe,
      delta,
    ]);
    expect(displayFrame.mock.calls.map((call) => call[2])).toEqual(["seek", "seek"]);
  });

  it("retries registered topic lookback when the range subscription is not ready yet", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrame = jest.fn(async (..._args: unknown[]) => ({ ok: true }));
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      if (subscribeMessageRange.mock.calls.length === 1) {
        return undefined;
      }
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, delta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ currentTime: 10_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.registerTopic("/camera");
    controller.handleSeek();
    await new Promise<void>((resolve) => setTimeout(resolve, 75));

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      keyframe,
      delta,
    ]);
  });

  it("cancels pending lookback when a newer seek starts", () => {
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const cancel = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => cancel);
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame: jest.fn(),
    });

    controller.handleSeek();
    controller.processMessage(seekDelta);
    expect(cancel).not.toHaveBeenCalled();

    renderer.currentTime = 30_000_000n;
    controller.handleSeek();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not display or cache a seek delta when no range API is available", () => {
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrame = jest.fn();
    const renderer = makeRenderer({ currentTime: 20_000_000n });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.handleSeek();
    controller.processMessage(seekDelta);
    controller.handleSeek();

    expect(displayFrame).not.toHaveBeenCalled();
  });

  it("falls back to lookback when cached replay fails to decode", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrame = jest.fn<Promise<ImageSetImageResult>, []>(async () => ({ ok: false }));
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, delta];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    displayFrame.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalled();
  });

  it("continues to wider lookback windows when replayed lookback frames fail to decode", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrame = jest.fn<Promise<ImageSetImageResult>, []>(async () => ({ ok: false }));
    const unsubscribes: jest.Mock[] = [];
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      const unsubscribe = jest.fn();
      unsubscribes.push(unsubscribe);
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, seekDelta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
    });

    controller.handleSeek();
    controller.processMessage(seekDelta);
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledTimes(5);
    expect(subscribeMessageRange.mock.calls[0]![0].timeRange.start).toEqual({ sec: 0, nsec: 0 });
    expect(subscribeMessageRange.mock.calls[1]![0].timeRange.start).toEqual({ sec: 0, nsec: 0 });
    expect(unsubscribes).toHaveLength(5);
    for (const unsubscribe of unsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("uses publish-time GOPs when the replay target is a synchronized video timestamp", async () => {
    const publishKeyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const publishDelta = makeVideoMessageWithTimes(2_000_000n, 101_000_000_000n, "delta");
    const laterKeyframe = makeVideoMessageWithTimes(3_000_000n, 200_000_000_000n, "key");
    const laterDelta = makeVideoMessageWithTimes(4_000_000n, 201_000_000_000n, "delta");
    const displayFrame = jest.fn(async (..._args: unknown[]) => ({
      ok: true,
    }));
    const renderer = makeRenderer({ currentTime: 4_000_000n });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.processMessage(publishKeyframe);
    controller.processMessage(publishDelta);
    controller.processMessage(laterKeyframe);
    controller.processMessage(laterDelta);
    displayFrame.mockClear();

    controller.handleSeek();
    controller.processMessage(publishDelta);
    await flushAsyncWork();

    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      publishKeyframe,
      publishDelta,
    ]);
  });

  it("truncates lookback GOPs at the publish-time replay target", async () => {
    const keyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const targetDelta = makeVideoMessageWithTimes(2_000_000n, 101_000_000_000n, "delta");
    const laterDelta = makeVideoMessageWithTimes(3_000_000n, 102_000_000_000n, "delta");
    const displayFrame = jest.fn(async (..._args: unknown[]) => ({
      ok: true,
    }));
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, targetDelta, laterDelta];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 3_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.handleSeek();
    controller.processMessage(targetDelta);
    await flushAsyncWork();

    expect(displayFrame.mock.calls.map(([messageEvent]) => messageEvent)).toEqual([
      keyframe,
      targetDelta,
    ]);
  });

  it("does not stitch publish-time lookback deltas across a keyframe after the target", async () => {
    const keyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const targetDelta = makeVideoMessageWithTimes(2_000_000n, 101_000_000_000n, "delta");
    const laterKeyframe = makeVideoMessageWithTimes(3_000_000n, 200_000_000_000n, "key");
    const laterDelta = makeVideoMessageWithTimes(4_000_000n, 201_000_000_000n, "delta");
    const displayFrame = jest.fn(async (..._args: unknown[]) => ({
      ok: true,
    }));
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, targetDelta, laterKeyframe, laterDelta];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 4_000_000n, subscribeMessageRange });
    const controller = new CompressedVideoController({
      renderer,
      displayFrame,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.handleSeek();
    controller.processMessage(targetDelta);
    await flushAsyncWork();

    expect(displayFrame).not.toHaveBeenCalled();
    expect(subscribeMessageRange).toHaveBeenCalledTimes(5);
  });
});
