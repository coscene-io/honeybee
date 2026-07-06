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

import {
  CompressedVideoController,
  type CompressedVideoDisplayFrames,
  type SeekKeyframeSearchChange,
  type VideoDisplayMode,
} from "./CompressedVideoController";
import { type CompressedVideoFrameEvent, type ImageSetImageResult } from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";

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
    acquireSeekKeyframeSearchPlaybackPause?: () => () => void;
  } = {},
) {
  return {
    currentTime: options.currentTime ?? 0n,
    startTime: options.startTime ?? 0n,
    subscribeMessageRange: options.subscribeMessageRange,
    acquireSeekKeyframeSearchPlaybackPause: options.acquireSeekKeyframeSearchPlaybackPause,
    queueAnimationFrame: jest.fn(),
  };
}

function makeController(args: {
  renderer?: ReturnType<typeof makeRenderer>;
  displayFrames?: CompressedVideoDisplayFrames;
  resetDecoder?: () => void;
  onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
  getSeekReplayTarget?: ConstructorParameters<
    typeof CompressedVideoController
  >[0]["getSeekReplayTarget"];
}) {
  const controllerArgs = {
    topic: "/camera",
    renderer: args.renderer ?? makeRenderer(),
    displayFrames: args.displayFrames ?? (async () => ({ ok: true })),
    resetDecoder: args.resetDecoder,
    onSeekKeyframeSearchChange: args.onSeekKeyframeSearchChange,
    getSeekReplayTarget: args.getSeekReplayTarget,
  };
  return new CompressedVideoController(controllerArgs);
}

function makeSuccessfulDisplayFrames() {
  return jest.fn<
    Promise<ImageSetImageResult>,
    [
      readonly CompressedVideoFrameEvent[],
      VideoDisplayMode,
      Parameters<CompressedVideoDisplayFrames>[2],
    ]
  >(async () => ({ ok: true }));
}

function frameReceiveTimes(frames: readonly CompressedVideoFrameEvent[]): bigint[] {
  return frames.map((frame) => toNanoSec(frame.receiveTime));
}

function nonResetCalls(displayFrames: jest.MockedFunction<CompressedVideoDisplayFrames>) {
  return displayFrames.mock.calls.filter(([frames]) => frames.length > 0);
}

function resetCallCount(displayFrames: jest.MockedFunction<CompressedVideoDisplayFrames>): number {
  return displayFrames.mock.calls.filter(([frames]) => frames.length === 0).length;
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
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("marks non-seek frames as playback display mode", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["playback"]);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n],
    ]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([true]);
    expect(nonResetCalls(displayFrames).map((call) => call[2])).toEqual([
      expect.objectContaining({ decodeMode: "playback" }),
    ]);
  });

  it("coalesces playback frames to the latest target while preserving GOP dependencies", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const target = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    controller.processMessage(target);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames)).toHaveLength(1);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["playback"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([true]);
    expect(nonResetCalls(displayFrames).map((call) => call[2])).toEqual([
      expect.objectContaining({ decodeMode: "playback" }),
    ]);
  });

  it("continues playback decoding from the previous successful target in the same GOP", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const target = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    await flushAsyncWork();
    displayFrames.mockClear();

    controller.processMessage(target);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [20_000_000n],
    ]);
  });

  it("does not resend frames already submitted to the decoder after an intermediate display", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const target = makeVideoMessage(20_000_000n, "delta");
    const nextTarget = makeVideoMessage(30_000_000n, "delta");
    let resolveFirstDisplay!: (result: ImageSetImageResult) => void;
    const firstDisplay = new Promise<ImageSetImageResult>((resolve) => {
      resolveFirstDisplay = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async () => {
      if (displayFrames.mock.calls.length === 1) {
        return await firstDisplay;
      }
      return { ok: true };
    });
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    controller.processMessage(target);
    await flushAsyncWork();

    controller.processMessage(nextTarget);
    resolveFirstDisplay({ ok: true, decodedFrame: middle });
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
      [30_000_000n],
    ]);
  });

  it("retries the latest playback target after displaying an earlier intermediate frame", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async () => {
      if (displayFrames.mock.calls.length === 1) {
        return { ok: true, decodedFrame: keyframe };
      }
      return { ok: true, decodedFrame: target };
    });
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(target);
    await flushAsyncWork();
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [0n, 10_000_000n],
    ]);
  });

  it("skips complete intermediate GOPs when chasing the latest playback target", async () => {
    const firstKeyframe = makeVideoMessage(0n, "key");
    const firstDelta = makeVideoMessage(10_000_000n, "delta");
    const skippedKeyframe = makeVideoMessage(20_000_000n, "key");
    const skippedDelta = makeVideoMessage(30_000_000n, "delta");
    const latestKeyframe = makeVideoMessage(40_000_000n, "key");
    const latestTarget = makeVideoMessage(50_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(firstKeyframe);
    controller.processMessage(firstDelta);
    controller.processMessage(skippedKeyframe);
    controller.processMessage(skippedDelta);
    controller.processMessage(latestKeyframe);
    controller.processMessage(latestTarget);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [40_000_000n, 50_000_000n],
    ]);
  });

  it("keeps an in-flight playback target current when newer messages arrive and commits it before chasing the latest", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const firstTarget = makeVideoMessage(10_000_000n, "delta");
    const latestTarget = makeVideoMessage(20_000_000n, "delta");
    let resolveFirstDisplay!: (result: ImageSetImageResult) => void;
    const firstDisplay = new Promise<ImageSetImageResult>((resolve) => {
      resolveFirstDisplay = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async () => {
      if (displayFrames.mock.calls.length === 1) {
        return await firstDisplay;
      }
      return { ok: true };
    });
    const resetDecoder = jest.fn();
    const controller = makeController({ displayFrames, resetDecoder });

    controller.processMessage(keyframe);
    controller.processMessage(firstTarget);
    await flushAsyncWork();
    expect(nonResetCalls(displayFrames)).toHaveLength(1);

    // A newer message arriving must NOT mark the in-flight display stale — under sustained input
    // pressure that would starve the display entirely. The in-flight target stays current, its
    // decoded frame is committed, and only then does the flush loop chase the latest target.
    controller.processMessage(latestTarget);
    expect(nonResetCalls(displayFrames)[0]?.[2]?.isVideoFrameRequestCurrent?.()).toBe(true);

    resolveFirstDisplay({ ok: true });
    await flushAsyncWork();

    expect(resetDecoder).not.toHaveBeenCalled();
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      // Incremental continuation from the committed first target within the same GOP.
      [20_000_000n],
    ]);
  });

  it("marks in-flight playback work stale when playback is invalidated", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const firstTarget = makeVideoMessage(10_000_000n, "delta");
    let resolveFirstDisplay!: (result: ImageSetImageResult) => void;
    const firstDisplay = new Promise<ImageSetImageResult>((resolve) => {
      resolveFirstDisplay = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, mode) => {
      if (mode === "playback" && frames.length > 0) {
        return await firstDisplay;
      }
      return { ok: true };
    });
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(firstTarget);
    await flushAsyncWork();
    const playbackCall = nonResetCalls(displayFrames).find((call) => call[1] === "playback");
    expect(playbackCall?.[2]?.isVideoFrameRequestCurrent?.()).toBe(true);

    controller.resetPlaybackState();

    expect(playbackCall?.[2]?.isVideoFrameRequestCurrent?.()).toBe(false);
    resolveFirstDisplay({ ok: false, reason: "stale", staleTargetDecoded: true });
    await flushAsyncWork();
  });

  it("bounds playback frame timeouts so a stalled target cannot hold the in-flight slot", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map((call) => call[2]?.targetFrameTimeoutMs)).toEqual([
      250,
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[2]?.anyFrameTimeoutMs)).toEqual([500]);
    expect(nonResetCalls(displayFrames).map((call) => call[2])).toEqual([
      expect.objectContaining({ decodeMode: "playback" }),
    ]);
  });

  it("continues playback after a superseded target that still decoded successfully", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const firstTarget = makeVideoMessage(10_000_000n, "delta");
    const latestTarget = makeVideoMessage(20_000_000n, "delta");
    let resolveFirstDisplay!: (result: ImageSetImageResult) => void;
    const firstDisplay = new Promise<ImageSetImageResult>((resolve) => {
      resolveFirstDisplay = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async () => {
      if (displayFrames.mock.calls.length === 1) {
        return await firstDisplay;
      }
      return { ok: true };
    });
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(firstTarget);
    await flushAsyncWork();

    controller.processMessage(latestTarget);
    resolveFirstDisplay({ ok: false, reason: "stale", staleTargetDecoded: true });
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [20_000_000n],
    ]);
  });

  it("does not coalesce playback frames when a seek replay target provider is active (synchronized mode)", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const target = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({
      displayFrames,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    controller.processMessage(target);
    await flushAsyncWork();

    // Synchronized display needs every frame in the synchronization state; playback conflation
    // must not drop intermediate frames there.
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n],
      [10_000_000n],
      [20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual([
      "playback",
      "playback",
      "playback",
    ]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false, false, false]);
    expect(nonResetCalls(displayFrames).map((call) => call[2])).toEqual([
      expect.objectContaining({ decodeMode: "exact" }),
      expect.objectContaining({ decodeMode: "exact" }),
      expect.objectContaining({ decodeMode: "exact" }),
    ]);
  });

  it("uses keyframe indexes recorded before playback filtering as seek range hints", async () => {
    const skippedKeyframe = makeVideoMessage(10_000_000_000n, "key");
    const skippedDelta = makeVideoMessage(12_000_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [skippedKeyframe, skippedDelta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({
      currentTime: 12_000_000_000n,
      subscribeMessageRange,
    });
    const controller = makeController({ renderer, displayFrames });

    controller.recordKnownKeyframeReceiveTime(skippedKeyframe.topic, skippedKeyframe.receiveTime);
    controller.handleSeek();
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 10, nsec: 0 },
          end: { sec: 12, nsec: 0 },
        },
      }),
    );
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [10_000_000_000n, 12_000_000_000n],
    ]);
  });

  it("replays cached GOP frames on seek", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();

    expect(resetCallCount(displayFrames)).toBe(1);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false]);
  });

  it("replays from the cached keyframe to a publish-time target", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    await flushAsyncWork();
    displayFrames.mockClear();

    await controller.displayPublishTimeTarget(delta);

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["direct"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false]);
    expect(renderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("continues publish-time replay from the previously displayed frame", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    await controller.displayPublishTimeTarget(middle);
    await controller.displayPublishTimeTarget(delta);

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["direct", "direct"]);
  });

  it("looks back from a publish-time target cache miss and replays from the keyframe", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, middle, delta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    await controller.displayPublishTimeTarget(delta);

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 20_000_000 },
        },
      }),
    );
    expect(resetCallCount(displayFrames)).toBe(1);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false]);
    expect(renderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("clears previous publish-time replay progress after seek", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    await controller.displayPublishTimeTarget(middle);
    renderer.currentTime = 20_000_000n;
    controller.handleSeek();
    await flushAsyncWork();
    displayFrames.mockClear();

    await controller.displayPublishTimeTarget(delta);

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
  });

  it("clears previous publish-time replay progress when playback state is reset", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    controller.processMessage(keyframe);
    await flushAsyncWork();
    displayFrames.mockClear();

    await controller.displayPublishTimeTarget(middle);
    controller.resetPlaybackState();
    displayFrames.mockClear();

    await controller.displayPublishTimeTarget(delta);

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
  });

  it("resets the decoder before replaying cached GOP frames on seek", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const events: string[] = [];
    const displayFrames = jest.fn((frames: readonly CompressedVideoFrameEvent[]) => {
      events.push(
        frames.length === 0
          ? "reset"
          : `display:${frames.map((frame) => toNanoSec(frame.receiveTime)).join(",")}`,
      );
      return { ok: true as const };
    });
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();
    events.length = 0;

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();

    expect(events).toEqual(["reset", "display:0,10000000"]);
  });

  it("uses progressive lookback when seek receives a delta frame outside the cache", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
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
    const controller = makeController({ renderer, displayFrames });

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
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses progressive lookback for an initial seek-backfill delta even when handleSeek was not called", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
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
    const controller = makeController({ renderer, displayFrames });

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
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("starts lookback on seek even before any frame was received", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
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
    const controller = makeController({ renderer, displayFrames });

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
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);
  });

  it("reads the first frame when seeking to the recording start", async () => {
    // At the data start every lookback window clamps to [start, start]; we must still issue the
    // read so the first frame (typically a keyframe) can be decoded and displayed.
    const keyframe = makeVideoMessage(0n, "key");
    const displayFrames = makeSuccessfulDisplayFrames();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 0n, startTime: 0n, subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 0, nsec: 0 },
        },
      }),
    );
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n],
    ]);
  });

  it("notifies while a seek lookback is searching for a keyframe", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const onSeekKeyframeSearchChange = jest.fn();
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
    const renderer = makeRenderer({ currentTime: 10_000_000n, subscribeMessageRange });
    const controller = makeController({
      renderer,
      displayFrames,
      onSeekKeyframeSearchChange,
    });

    controller.handleSeek();
    await flushAsyncWork();

    expect(onSeekKeyframeSearchChange.mock.calls).toEqual([
      [{ active: true }],
      [{ active: false }],
    ]);
  });

  it("acquires a playback pause lock while a seek lookback is searching for a keyframe", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const releasePlaybackPause = jest.fn();
    const acquireSeekKeyframeSearchPlaybackPause = jest.fn(() => releasePlaybackPause);
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
    const renderer = makeRenderer({
      currentTime: 10_000_000n,
      subscribeMessageRange,
      acquireSeekKeyframeSearchPlaybackPause,
    });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).not.toHaveBeenCalled();

    await flushAsyncWork();

    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
  });

  it("does not notify keyframe search for cached GOP seek replay", () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const onSeekKeyframeSearchChange = jest.fn();
    const renderer = makeRenderer({ currentTime: 10_000_000n });
    const controller = makeController({ renderer, onSeekKeyframeSearchChange });

    controller.processMessage(keyframe);
    controller.processMessage(delta);

    controller.handleSeek();

    expect(onSeekKeyframeSearchChange).not.toHaveBeenCalled();
  });

  it("holds a playback pause lock while cached GOP seek replay is pending", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    let resolveSeekDisplay!: (result: ImageSetImageResult) => void;
    const seekDisplayPromise = new Promise<ImageSetImageResult>((resolve) => {
      resolveSeekDisplay = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (_frames, mode) => {
      return mode === "seek" ? await seekDisplayPromise : { ok: true };
    });
    const releasePlaybackPause = jest.fn();
    const acquireSeekKeyframeSearchPlaybackPause = jest.fn(() => releasePlaybackPause);
    const renderer = makeRenderer({ acquireSeekKeyframeSearchPlaybackPause });
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).not.toHaveBeenCalled();

    resolveSeekDisplay({ ok: true });
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);
    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
  });

  it("suppresses playback frames while cached seek replay is waiting for the target frame", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const firstPlaybackDelta = makeVideoMessage(20_000_000n, "delta");
    const secondPlaybackDelta = makeVideoMessage(30_000_000n, "delta");
    let resolveSeekDisplay!: (result: ImageSetImageResult) => void;
    const seekDisplayPromise = new Promise<ImageSetImageResult>((resolve) => {
      resolveSeekDisplay = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, mode) => {
      if (mode === "seek" && frameReceiveTimes(frames).at(-1) === 10_000_000n) {
        return await seekDisplayPromise;
      }
      return { ok: true };
    });
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();

    controller.processMessage(firstPlaybackDelta);
    controller.processMessage(secondPlaybackDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);

    resolveSeekDisplay({ ok: true });
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [0n, 10_000_000n, 20_000_000n, 30_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek", "seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false, false]);
  });

  it("stabilizes the first playback frame that arrives as cached seek replay resumes", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const nextDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controllerRef: { current?: CompressedVideoController } = {};
    const releasePlaybackPause = jest.fn(() => {
      controllerRef.current?.processMessage(nextDelta);
    });
    const acquireSeekKeyframeSearchPlaybackPause = jest.fn(() => releasePlaybackPause);
    const renderer = makeRenderer({ acquireSeekKeyframeSearchPlaybackPause });
    const controller = makeController({ renderer, displayFrames });
    controllerRef.current = controller;

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek", "seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false, false]);
  });

  it("stabilizes the first playback keyframe after seek instead of using normal playback", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const nextKeyframe = makeVideoMessage(20_000_000n, "key");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();
    displayFrames.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();
    displayFrames.mockClear();

    controller.processMessage(nextKeyframe);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false]);
  });

  it("suppresses playback frames while post-seek playback stabilization is pending", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const firstPlaybackDelta = makeVideoMessage(20_000_000n, "delta");
    const secondPlaybackDelta = makeVideoMessage(30_000_000n, "delta");
    const thirdPlaybackDelta = makeVideoMessage(40_000_000n, "delta");
    let resolveStabilization!: (result: ImageSetImageResult) => void;
    const stabilizationPromise = new Promise<ImageSetImageResult>((resolve) => {
      resolveStabilization = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, mode) => {
      if (mode === "seek" && frameReceiveTimes(frames).at(-1) === 20_000_000n) {
        return await stabilizationPromise;
      }
      return { ok: true };
    });
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();
    displayFrames.mockClear();

    controller.processMessage(firstPlaybackDelta);
    controller.processMessage(secondPlaybackDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);

    resolveStabilization({ ok: true });
    await flushAsyncWork();

    controller.processMessage(thirdPlaybackDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
      [0n, 10_000_000n, 20_000_000n, 30_000_000n],
      [0n, 10_000_000n, 20_000_000n, 30_000_000n, 40_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual([
      "seek",
      "seek",
      "playback",
    ]);
  });

  it("rearms playback stabilization after a failed post-seek replay", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const firstPlaybackDelta = makeVideoMessage(20_000_000n, "delta");
    const secondPlaybackDelta = makeVideoMessage(30_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, mode) => {
      if (mode === "seek" && frameReceiveTimes(frames).at(-1) === 20_000_000n) {
        return { ok: false, reason: "failed" };
      }
      return { ok: true };
    });
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();
    displayFrames.mockClear();

    controller.processMessage(firstPlaybackDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);

    displayFrames.mockClear();
    controller.processMessage(secondPlaybackDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n, 30_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false]);
  });

  it("retries the latest pending playback frame after a failed post-seek replay", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const firstPlaybackDelta = makeVideoMessage(20_000_000n, "delta");
    const secondPlaybackDelta = makeVideoMessage(30_000_000n, "delta");
    let resolveStabilization!: (result: ImageSetImageResult) => void;
    const stabilizationPromise = new Promise<ImageSetImageResult>((resolve) => {
      resolveStabilization = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, mode) => {
      if (mode === "seek" && frameReceiveTimes(frames).at(-1) === 20_000_000n) {
        return await stabilizationPromise;
      }
      return { ok: true };
    });
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    await flushAsyncWork();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();
    displayFrames.mockClear();

    controller.processMessage(firstPlaybackDelta);
    controller.processMessage(secondPlaybackDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek"]);

    resolveStabilization({ ok: false, reason: "failed" });
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
      [0n, 10_000_000n, 20_000_000n, 30_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek", "seek"]);
    expect(
      nonResetCalls(displayFrames).map((call) => call[2]?.allowIntermediateVideoFrame),
    ).toEqual([false, false]);
  });

  it("does not let stale lookback completion clear a newer keyframe search", async () => {
    const firstKeyframe = makeVideoMessage(0n, "key");
    const firstDelta = makeVideoMessage(10_000_000n, "delta");
    const secondKeyframe = makeVideoMessage(20_000_000n, "key");
    const secondDelta = makeVideoMessage(30_000_000n, "delta");
    const onSeekKeyframeSearchChange = jest.fn();
    const iterators: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"][] = [];
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((args) => {
      iterators.push(args.onNewRangeIterator);
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 10_000_000n, subscribeMessageRange });
    const controller = makeController({ renderer, onSeekKeyframeSearchChange });

    controller.handleSeek();
    renderer.currentTime = 30_000_000n;
    controller.handleSeek();
    onSeekKeyframeSearchChange.mockClear();

    await iterators[0]?.(
      (async function* () {
        yield [firstKeyframe, firstDelta];
      })(),
    );
    await flushAsyncWork();

    expect(onSeekKeyframeSearchChange).not.toHaveBeenCalled();

    await iterators[1]?.(
      (async function* () {
        yield [secondKeyframe, secondDelta];
      })(),
    );
    await flushAsyncWork();

    expect(onSeekKeyframeSearchChange.mock.calls).toEqual([[{ active: false }]]);
  });

  it("retries seek lookback when the range subscription is not ready yet", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
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
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await new Promise<void>((resolve) => setTimeout(resolve, 75));

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);
  });

  it("cancels pending lookback when a newer seek starts", () => {
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const cancel = jest.fn();
    const firstReleasePlaybackPause = jest.fn();
    const secondReleasePlaybackPause = jest.fn();
    const acquireSeekKeyframeSearchPlaybackPause = jest
      .fn()
      .mockReturnValueOnce(firstReleasePlaybackPause)
      .mockReturnValueOnce(secondReleasePlaybackPause);
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => cancel);
    const renderer = makeRenderer({
      currentTime: 20_000_000n,
      subscribeMessageRange,
      acquireSeekKeyframeSearchPlaybackPause,
    });
    const controller = makeController({ renderer });

    controller.handleSeek();
    controller.processMessage(seekDelta);
    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    renderer.currentTime = 30_000_000n;
    controller.handleSeek();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(2);
    expect(firstReleasePlaybackPause).toHaveBeenCalledTimes(1);
    expect(secondReleasePlaybackPause).not.toHaveBeenCalled();
  });

  it("does not display or cache a seek delta when no range API is available", () => {
    const seekDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer({ currentTime: 20_000_000n });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    controller.processMessage(seekDelta);
    controller.handleSeek();

    expect(nonResetCalls(displayFrames)).toHaveLength(0);
  });

  it("releases the playback pause lock when a lookback range read fails", async () => {
    const displayFrames = makeSuccessfulDisplayFrames();
    const releasePlaybackPause = jest.fn();
    const acquireSeekKeyframeSearchPlaybackPause = jest.fn(() => releasePlaybackPause);
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator({
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<readonly MessageEvent[]>> {
              throw new Error("range read failed");
            },
          };
        },
      });
      return jest.fn();
    });
    const renderer = makeRenderer({
      currentTime: 20_000_000n,
      subscribeMessageRange,
      acquireSeekKeyframeSearchPlaybackPause,
    });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await flushAsyncWork();

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
  });

  it("releases the playback pause lock when a lookback range read never resolves", async () => {
    jest.useFakeTimers();

    const releasePlaybackPause = jest.fn();
    const acquireSeekKeyframeSearchPlaybackPause = jest.fn(() => releasePlaybackPause);
    const onSeekKeyframeSearchChange = jest.fn();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => unsubscribe);
    const renderer = makeRenderer({
      currentTime: 20_000_000n,
      subscribeMessageRange,
      acquireSeekKeyframeSearchPlaybackPause,
    });
    const controller = makeController({
      renderer,
      onSeekKeyframeSearchChange,
    });

    controller.handleSeek();

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(onSeekKeyframeSearchChange).toHaveBeenCalledWith({ active: true });
    expect(releasePlaybackPause).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(30_000);

    expect(unsubscribe).toHaveBeenCalled();
    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
    expect(onSeekKeyframeSearchChange.mock.calls).toEqual([
      [{ active: true }],
      [{ active: false }],
    ]);
  });

  it("releases the playback pause lock once when disposed during keyframe search", () => {
    const releasePlaybackPause = jest.fn();
    const acquireSeekKeyframeSearchPlaybackPause = jest.fn(() => releasePlaybackPause);
    const cancel = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => cancel);
    const renderer = makeRenderer({
      currentTime: 20_000_000n,
      subscribeMessageRange,
      acquireSeekKeyframeSearchPlaybackPause,
    });
    const controller = makeController({ renderer });

    controller.handleSeek();
    controller.dispose();
    controller.dispose();

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
  });

  it("falls back to lookback when cached replay fails to decode", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async () => ({ ok: false, reason: "failed" }));
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
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(delta);
    displayFrames.mockClear();

    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalled();
  });

  it("expands through non-overlapping lookback windows when replayed frames fail to decode", async () => {
    for (const mode of ["publish-target", "seek-backfill"] as const) {
      // Keyframe at the start, target 30s later: the keyframe only falls into the widest window, so
      // the lookback must expand backwards before it can replay.
      const keyframe = makeVideoMessage(0n, "key");
      const delta = makeVideoMessage(30_000_000_000n, "delta");
      const displayFrames = jest.fn<
        Promise<ImageSetImageResult>,
        Parameters<CompressedVideoDisplayFrames>
      >(async () => ({ ok: false, reason: "failed" }));
      const unsubscribes: jest.Mock[] = [];
      const subscribeMessageRange = jest.fn<
        ReturnType<SubscribeMessageRange>,
        Parameters<SubscribeMessageRange>
      >(({ onNewRangeIterator }) => {
        const unsubscribe = jest.fn();
        unsubscribes.push(unsubscribe);
        void onNewRangeIterator(
          (async function* () {
            yield [keyframe, delta];
          })(),
        );
        return unsubscribe;
      });
      const renderer = makeRenderer({ currentTime: 30_000_000_000n, subscribeMessageRange });
      const controller = makeController({ renderer, displayFrames });

      if (mode === "publish-target") {
        await controller.displayPublishTimeTarget(delta);
      } else {
        controller.handleSeek();
        controller.processMessage(delta);
        await flushAsyncWork();
      }

      const ranges = subscribeMessageRange.mock.calls.map((call) => call[0].timeRange);
      expect(ranges.length).toBeGreaterThan(1);
      // The first window ends at the target, and each subsequent window reads only the newly-exposed
      // older slice — they are contiguous and never re-read an already-read range.
      expect(ranges[0]!.end).toEqual({ sec: 30, nsec: 0 });
      for (let i = 1; i < ranges.length; i++) {
        expect(ranges[i]!.end).toEqual(ranges[i - 1]!.start);
      }
      expect(unsubscribes).toHaveLength(subscribeMessageRange.mock.calls.length);
      for (const unsubscribe of unsubscribes) {
        expect(unsubscribe).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("reads a single [keyframe, target] range on seek using the persisted keyframe index", async () => {
    // Keyframe observed during playback, then a seek 30s ahead to a delta in the same GOP. A cold
    // lookback would walk the 5s/10s/20s windows; the index lets us read the exact GOP in one request.
    const keyframe = makeVideoMessage(0n, "key");
    const seekDelta = makeVideoMessage(30_000_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, seekDelta];
        })(),
      );
      return unsubscribe;
    });
    const renderer = makeRenderer({ subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    displayFrames.mockClear();

    renderer.currentTime = 30_000_000_000n;
    controller.handleSeek();
    await flushAsyncWork();

    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    expect(subscribeMessageRange).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "/camera",
        timeRange: {
          start: { sec: 0, nsec: 0 },
          end: { sec: 30, nsec: 0 },
        },
      }),
    );
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 30_000_000_000n],
    ]);
  });

  it("uses publish-time GOPs when the replay target is a synchronized video timestamp", async () => {
    const publishKeyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const publishDelta = makeVideoMessageWithTimes(2_000_000n, 101_000_000_000n, "delta");
    const laterKeyframe = makeVideoMessageWithTimes(3_000_000n, 200_000_000_000n, "key");
    const laterDelta = makeVideoMessageWithTimes(4_000_000n, 201_000_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer({ currentTime: 4_000_000n });
    const controller = makeController({
      renderer,
      displayFrames,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.processMessage(publishKeyframe);
    controller.processMessage(publishDelta);
    controller.processMessage(laterKeyframe);
    controller.processMessage(laterDelta);
    displayFrames.mockClear();

    controller.handleSeek();
    controller.processMessage(publishDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [1_000_000n, 2_000_000n],
    ]);
  });

  it("truncates lookback GOPs at the publish-time replay target", async () => {
    const keyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const targetDelta = makeVideoMessageWithTimes(2_000_000n, 101_000_000_000n, "delta");
    const laterDelta = makeVideoMessageWithTimes(3_000_000n, 102_000_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
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
    const controller = makeController({
      renderer,
      displayFrames,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.handleSeek();
    controller.processMessage(targetDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [1_000_000n, 2_000_000n],
    ]);
  });

  it("does not stitch publish-time lookback deltas across a keyframe after the target", async () => {
    const keyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const targetDelta = makeVideoMessageWithTimes(2_000_000n, 101_000_000_000n, "delta");
    const laterKeyframe = makeVideoMessageWithTimes(3_000_000n, 200_000_000_000n, "key");
    const laterDelta = makeVideoMessageWithTimes(4_000_000n, 201_000_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
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
    const controller = makeController({
      renderer,
      displayFrames,
      getSeekReplayTarget: (messageEvent) =>
        messageEvent == undefined
          ? "defer"
          : { type: "publish", time: messageEvent.message.timestamp },
    });

    controller.handleSeek();
    controller.processMessage(targetDelta);
    await flushAsyncWork();

    expect(nonResetCalls(displayFrames)).toHaveLength(0);
    // The receive-time GOP is rooted at a keyframe published after the target, so nothing is
    // displayed. Every window clamps back to the start time, so the range is read exactly once.
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
  });

  it("ignores stale publish-time replay completion after a newer target supersedes it", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const pendingDisplays: ((result: ImageSetImageResult) => void)[] = [];
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, mode) => {
      if (frames.length === 0 || mode === "playback") {
        return { ok: false, reason: "failed" };
      }
      return await new Promise<ImageSetImageResult>((resolve) => {
        pendingDisplays.push(resolve);
      });
    });
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    controller.processMessage(keyframe);
    controller.processMessage(middle);
    controller.processMessage(delta);
    displayFrames.mockClear();

    const firstResult = controller.displayPublishTimeTarget(middle);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);

    const secondResult = controller.displayPublishTimeTarget(delta);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [0n, 10_000_000n, 20_000_000n],
    ]);

    pendingDisplays[1]?.({ ok: true });
    await expect(secondResult).resolves.toEqual({ ok: true });

    pendingDisplays[0]?.({ ok: false, reason: "failed" });
    await expect(firstResult).resolves.toEqual({ ok: false, reason: "failed" });

    expect(resetCallCount(displayFrames)).toBe(0);
    expect(renderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("ignores a cancelled lookback iterator that returns after a newer target starts", async () => {
    const firstKeyframe = makeVideoMessage(0n, "key");
    const firstDelta = makeVideoMessage(10_000_000n, "delta");
    const secondKeyframe = makeVideoMessage(20_000_000n, "key");
    const secondDelta = makeVideoMessage(30_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const unsubscribes: jest.Mock[] = [];
    const iterators: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"][] = [];
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      iterators.push(onNewRangeIterator);
      const unsubscribe = jest.fn();
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    });
    const renderer = makeRenderer({ subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    const firstResult = controller.displayPublishTimeTarget(firstDelta);
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);

    const secondResult = controller.displayPublishTimeTarget(secondDelta);
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);

    await iterators[0]?.(
      (async function* () {
        yield [firstKeyframe, firstDelta];
      })(),
    );
    await flushAsyncWork();
    expect(nonResetCalls(displayFrames)).toHaveLength(0);

    await iterators[1]?.(
      (async function* () {
        yield [secondKeyframe, secondDelta];
      })(),
    );
    await flushAsyncWork();

    await expect(firstResult).resolves.toEqual({ ok: false, reason: "failed" });
    await expect(secondResult).resolves.toEqual({ ok: true });
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [20_000_000n, 30_000_000n],
    ]);
    expect(renderer.queueAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
