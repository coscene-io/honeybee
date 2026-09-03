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
import { playbackPerformanceMetrics } from "@foxglove/studio-base/services/playbackPerformanceTelemetry";

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
  };
}

function makeController(args: {
  renderer?: ReturnType<typeof makeRenderer>;
  displayFrames?: CompressedVideoDisplayFrames;
  resetDecoder?: () => void;
  onSeekKeyframeSearchChange?: SeekKeyframeSearchChange;
}) {
  const controllerArgs = {
    topic: "/camera",
    renderer: args.renderer ?? makeRenderer(),
    displayFrames: args.displayFrames ?? (async () => ({ ok: true })),
    resetDecoder: args.resetDecoder,
    onSeekKeyframeSearchChange: args.onSeekKeyframeSearchChange,
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

  it("continues publish-time replay from the previously displayed frame", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    await controller.processVideoFrames([keyframe, middle, delta], {
      synchronize: true,
      targetFrame: middle,
    });
    await controller.processVideoFrames([], {
      synchronize: true,
      targetFrame: delta,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["direct", "direct"]);
  });

  it("resets before replaying a full GOP after an intermediate same-timestamp target", async () => {
    const keyframe = makeVideoMessageWithTimes(0n, 0n, "key");
    const intermediate = makeVideoMessageWithTimes(10n, 10n, "delta");
    const target = makeVideoMessageWithTimes(20n, 10n, "delta");
    const replacement = makeVideoMessageWithTimes(30n, 10n, "delta");
    let decoderHasInput = false;
    let decodeCount = 0;
    const events: string[] = [];
    const resetDecoder = jest.fn(() => {
      events.push("reset");
      decoderHasInput = false;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames) => {
      decodeCount++;
      events.push(`decode:${frameReceiveTimes(frames).join(",")}`);
      if (decoderHasInput && H264.IsKeyframe(frames[0]!.message.data)) {
        return { ok: false, reason: "frame-out-of-order" };
      }
      decoderHasInput = true;
      return decodeCount === 2
        ? { ok: true, decodedFrame: frames[0] }
        : { ok: true, decodedFrame: frames[frames.length - 1] };
    });
    const controller = makeController({ displayFrames, resetDecoder });

    await controller.processVideoFrames([keyframe], {
      synchronize: true,
      targetFrame: keyframe,
    });
    await controller.processVideoFrames([intermediate, target], {
      synchronize: true,
      targetFrame: target,
    });
    const result = await controller.processVideoFrames([replacement], {
      synchronize: true,
      targetFrame: replacement,
    });

    expect(result).toMatchObject({ ok: true, decodedFrame: replacement });
    expect(events).toEqual(["decode:0", "decode:10,20", "reset", "decode:0,10,20,30"]);
    expect(resetDecoder).toHaveBeenCalledTimes(1);
  });

  it("resets before replaying a full GOP after a timed-out synchronized batch", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessageWithTimes(10n, 10n, "delta");
    const replacement = makeVideoMessageWithTimes(20n, 10n, "delta");
    let decoderHasInput = false;
    let decodeCount = 0;
    const events: string[] = [];
    const resetDecoder = jest.fn(() => {
      events.push("reset");
      decoderHasInput = false;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames) => {
      decodeCount++;
      events.push(`decode:${frameReceiveTimes(frames).join(",")}`);
      if (decoderHasInput && H264.IsKeyframe(frames[0]!.message.data)) {
        return { ok: false, reason: "frame-out-of-order" };
      }
      decoderHasInput = true;
      return decodeCount === 2
        ? { ok: false, reason: "timeout" }
        : { ok: true, decodedFrame: frames[frames.length - 1] };
    });
    const controller = makeController({ displayFrames, resetDecoder });

    await controller.processVideoFrames([keyframe], {
      synchronize: true,
      targetFrame: keyframe,
    });
    await expect(
      controller.processVideoFrames([target], {
        synchronize: true,
        targetFrame: target,
      }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });
    const result = await controller.processVideoFrames([replacement], {
      synchronize: true,
      targetFrame: replacement,
    });

    expect(result).toMatchObject({ ok: true, decodedFrame: replacement });
    expect(events).toEqual(["decode:0", "decode:10", "reset", "decode:0,10,20"]);
    expect(resetDecoder).toHaveBeenCalledTimes(1);
  });

  it.each(["intermediate", "timeout"] as const)(
    "continues synchronized replay incrementally after a late target replaces an %s result",
    async (initialResult) => {
      const keyframe = makeVideoMessage(0n, "key");
      const intermediate = makeVideoMessage(10n, "delta");
      const target = makeVideoMessage(20n, "delta");
      const nextTarget = makeVideoMessage(30n, "delta");
      let lateTargetCommit: ((event: CompressedVideoFrameEvent) => void) | undefined;
      const resetDecoder = jest.fn();
      const displayFrames = jest.fn<
        Promise<ImageSetImageResult>,
        Parameters<CompressedVideoDisplayFrames>
      >(async (frames, _mode, options) => {
        if (displayFrames.mock.calls.length === 2) {
          lateTargetCommit = options?.updateImageState;
          return initialResult === "intermediate"
            ? { ok: true, decodedFrame: intermediate }
            : { ok: false, reason: "timeout" };
        }
        return { ok: true, decodedFrame: frames[frames.length - 1] };
      });
      const controller = makeController({ displayFrames, resetDecoder });

      await controller.processVideoFrames([keyframe], {
        synchronize: true,
        targetFrame: keyframe,
      });
      await controller.processVideoFrames([intermediate, target], {
        synchronize: true,
        targetFrame: target,
      });

      expect(lateTargetCommit).toBeDefined();
      lateTargetCommit!(target);

      await controller.processVideoFrames([nextTarget], {
        synchronize: true,
        targetFrame: nextTarget,
      });

      expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
        [0n],
        [10n, 20n],
        [30n],
      ]);
      expect(resetDecoder).not.toHaveBeenCalled();
    },
  );

  it("does not let a superseded late target restore synchronized replay continuity", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const firstIntermediate = makeVideoMessage(10n, "delta");
    const firstTarget = makeVideoMessage(20n, "delta");
    const secondIntermediate = makeVideoMessage(30n, "delta");
    const secondTarget = makeVideoMessage(40n, "delta");
    const thirdTarget = makeVideoMessage(50n, "delta");
    const staleImageStateUpdate = jest.fn();
    let staleTargetCommit: ((event: CompressedVideoFrameEvent) => void) | undefined;
    const resetDecoder = jest.fn();
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames, _mode, options) => {
      if (displayFrames.mock.calls.length === 2) {
        staleTargetCommit = options?.updateImageState;
        return { ok: true, decodedFrame: firstIntermediate };
      }
      if (displayFrames.mock.calls.length === 3) {
        return { ok: true, decodedFrame: secondIntermediate };
      }
      return { ok: true, decodedFrame: frames[frames.length - 1] };
    });
    const controller = makeController({ displayFrames, resetDecoder });

    await controller.processVideoFrames([keyframe], {
      synchronize: true,
      targetFrame: keyframe,
    });
    await controller.processVideoFrames([firstIntermediate, firstTarget], {
      synchronize: true,
      targetFrame: firstTarget,
      updateImageState: staleImageStateUpdate,
    });
    await controller.processVideoFrames([secondIntermediate, secondTarget], {
      synchronize: true,
      targetFrame: secondTarget,
    });

    expect(staleTargetCommit).toBeDefined();
    staleTargetCommit!(firstTarget);
    expect(staleImageStateUpdate).not.toHaveBeenCalled();

    await controller.processVideoFrames([thirdTarget], {
      synchronize: true,
      targetFrame: thirdTarget,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n],
      [10n, 20n],
      [0n, 10n, 20n, 30n, 40n],
      [0n, 10n, 20n, 30n, 40n, 50n],
    ]);
    expect(resetDecoder).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous synchronized image on a publish-time cache miss", async () => {
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(() => jest.fn());
    const renderer = makeRenderer({ subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    const result = await controller.processVideoFrames([delta], {
      synchronize: true,
      targetFrame: delta,
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(subscribeMessageRange).not.toHaveBeenCalled();
    expect(displayFrames).not.toHaveBeenCalled();
  });

  it("does not replay cached future frames before a backward synchronized seek target", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const originalTarget = makeVideoMessage(10_000_000n, "delta");
    const future1 = makeVideoMessage(20_000_000n, "delta");
    const future2 = makeVideoMessage(30_000_000n, "delta");
    const newTarget = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    await controller.processVideoFrames([keyframe, originalTarget, future1, future2], {
      synchronize: true,
      targetFrame: future2,
    });
    renderer.currentTime = 10_000_000n;
    controller.handleSeek();
    displayFrames.mockClear();

    await controller.processVideoFrames([newTarget], {
      didSeek: true,
      synchronize: true,
      targetFrame: newTarget,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([
      [keyframe, originalTarget, newTarget],
    ]);
  });

  it("keeps a seek pending until a later synchronized target can recover its GOP", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessage(20_000_000n, "delta");
    let onNewRangeIterator: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"] | undefined;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((args) => {
      onNewRangeIterator = args.onNewRangeIterator;
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await expect(
      controller.processVideoFrames([target], {
        didSeek: true,
        synchronize: true,
      }),
    ).resolves.toEqual({ ok: false, reason: "failed" });
    expect(subscribeMessageRange).not.toHaveBeenCalled();
    expect(nonResetCalls(displayFrames)).toHaveLength(0);

    const replay = controller.processVideoFrames([], {
      synchronize: true,
      targetFrame: target,
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, target];
      })(),
    );

    await expect(replay).resolves.toEqual({ ok: true });
    const nextTarget = makeVideoMessage(30_000_000n, "delta");
    const followingTarget = makeVideoMessage(40_000_000n, "delta");
    await controller.processVideoFrames([nextTarget], {
      synchronize: true,
      targetFrame: nextTarget,
    });
    await controller.processVideoFrames([followingTarget], {
      synchronize: true,
      targetFrame: followingTarget,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 20_000_000n],
      [30_000_000n],
      [40_000_000n],
    ]);
  });

  it("stages a newer tick when the same seek generation re-enters", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessage(20_000_000n, "delta");
    const newerTarget = makeVideoMessage(30_000_000n, "delta");
    let onNewRangeIterator: Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"] | undefined;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((args) => {
      onNewRangeIterator = args.onNewRangeIterator;
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    const firstTick = controller.processVideoFrames([target], { didSeek: true });
    await expect(controller.processVideoFrames([newerTarget], { didSeek: true })).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);

    await onNewRangeIterator?.(
      (async function* () {
        yield [keyframe, target];
      })(),
    );
    await expect(firstTick).resolves.toEqual({ ok: true });
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 20_000_000n],
      [30_000_000n],
    ]);
  });

  it("stages a newer tick while a cached seek replay is decoding", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessage(20_000_000n, "delta");
    const newerTarget = makeVideoMessage(30_000_000n, "delta");
    const newestTarget = makeVideoMessage(40_000_000n, "delta");
    let resolveSeek!: (result: ImageSetImageResult) => void;
    const seekResult = new Promise<ImageSetImageResult>((resolve) => {
      resolveSeek = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (_frames, mode) => (mode === "seek" ? await seekResult : { ok: true }));
    const renderer = makeRenderer({ currentTime: 20_000_000n });
    const controller = makeController({ renderer, displayFrames });

    await controller.processVideoFrames([keyframe, target]);
    controller.handleSeek();
    const seekTick = controller.processVideoFrames([], { didSeek: true });
    await expect(controller.processVideoFrames([newerTarget], { didSeek: true })).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    await expect(controller.processVideoFrames([newestTarget], { didSeek: true })).resolves.toEqual(
      {
        ok: false,
        reason: "stale",
      },
    );

    resolveSeek({ ok: true });
    await expect(seekTick).resolves.toEqual({ ok: true });
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 20_000_000n],
      [0n, 20_000_000n],
      [30_000_000n, 40_000_000n],
    ]);
  });

  it("clears previous publish-time replay progress after seek", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const middle = makeVideoMessage(10_000_000n, "delta");
    const delta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const renderer = makeRenderer();
    const controller = makeController({ renderer, displayFrames });

    await controller.processVideoFrames([keyframe, middle, delta], {
      synchronize: true,
      targetFrame: middle,
    });
    renderer.currentTime = 20_000_000n;
    controller.handleSeek();
    displayFrames.mockClear();

    await controller.processVideoFrames([], {
      synchronize: true,
      targetFrame: delta,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
  });

  it("replays the cached GOP for a batched delta after playback state is reset", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const firstDelta = makeVideoMessage(10_000_000n, "delta");
    const nextDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const controller = makeController({ displayFrames });

    await controller.processVideoFrames([keyframe, firstDelta]);
    controller.resetPlaybackState();
    displayFrames.mockClear();

    await controller.processVideoFrames([nextDelta]);

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n, 20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames)[0]?.[2]).toMatchObject({
      allowIntermediateVideoFrame: false,
      decodeMode: "exact",
    });
  });

  it("finishes a cached seek batch after timeout before processing the next tick", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessage(10_000_000n, "delta");
    const nextDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (_frames, mode) => (mode === "seek" ? { ok: false, reason: "timeout" } : { ok: true }));
    const renderer = makeRenderer({ currentTime: 10_000_000n });
    const controller = makeController({ renderer, displayFrames });

    await controller.processVideoFrames([keyframe, target]);
    controller.handleSeek();
    displayFrames.mockClear();

    await controller.processVideoFrames([], { didSeek: true });
    await controller.processVideoFrames([nextDelta]);

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek", "playback"]);
  });

  it("does not reuse a cached keyframe across a publish timestamp regression", async () => {
    const oldKeyframe = makeVideoMessage(0n, "key");
    const oldTarget = makeVideoMessage(100n, "delta");
    const newDelta = makeVideoMessage(1n, "delta");
    const newKeyframe = makeVideoMessage(2n, "key");
    const displayFrames = makeSuccessfulDisplayFrames();
    const resetDecoder = jest.fn();
    const controller = makeController({ displayFrames, resetDecoder });

    await controller.processVideoFrames([oldKeyframe, oldTarget], {
      synchronize: true,
      targetFrame: oldTarget,
    });
    controller.handleTimestampRegression();
    displayFrames.mockClear();

    await expect(
      controller.processVideoFrames([newDelta], {
        synchronize: true,
        targetFrame: newDelta,
      }),
    ).resolves.toEqual({ ok: false, reason: "failed" });
    expect(nonResetCalls(displayFrames)).toHaveLength(0);

    await controller.processVideoFrames([newKeyframe], {
      synchronize: true,
      targetFrame: newKeyframe,
    });
    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([[newKeyframe]]);
    expect(resetDecoder).toHaveBeenCalledTimes(1);
  });

  it("keeps only the latest timestamp epoch from a mixed playback batch", async () => {
    const oldKeyframe = makeVideoMessage(100n, "key");
    const oldDelta = makeVideoMessage(110n, "delta");
    const oldTail = makeVideoMessage(120n, "delta");
    const newKeyframe = makeVideoMessage(1n, "key");
    const newTarget = makeVideoMessage(2n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const resetDecoder = jest.fn();
    const controller = makeController({ displayFrames, resetDecoder });

    await controller.processVideoFrames([oldKeyframe, oldDelta], {
      synchronize: true,
      targetFrame: oldDelta,
    });
    displayFrames.mockClear();

    await controller.processVideoFrames([oldTail, newKeyframe, newTarget], {
      synchronize: true,
      targetFrame: newTarget,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([
      [newKeyframe, newTarget],
    ]);
    expect(resetDecoder).toHaveBeenCalledTimes(1);
  });

  it("drops delta-only playback after a terminal decoder failure until a new keyframe", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const failedDelta = makeVideoMessage(10_000_000n, "delta");
    const droppedDelta = makeVideoMessage(20_000_000n, "delta");
    const recoveryKeyframe = makeVideoMessage(30_000_000n, "key");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames) =>
      toNanoSec(frames[0]!.receiveTime) === toNanoSec(failedDelta.receiveTime)
        ? { ok: false, reason: "failed" }
        : { ok: true, decodedFrame: frames[frames.length - 1] },
    );
    const controller = makeController({ displayFrames });

    await controller.processVideoFrames([keyframe]);
    await expect(controller.processVideoFrames([failedDelta])).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    await expect(controller.processVideoFrames([droppedDelta])).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    await controller.processVideoFrames([recoveryKeyframe]);

    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([
      [keyframe],
      [failedDelta],
      [recoveryKeyframe],
    ]);
  });

  it("keeps delta playback continuity after a non-terminal timeout", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const timedOutDelta = makeVideoMessage(10_000_000n, "delta");
    const nextDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames) =>
      toNanoSec(frames[0]!.receiveTime) === toNanoSec(timedOutDelta.receiveTime)
        ? { ok: false, reason: "timeout" }
        : { ok: true, decodedFrame: frames[frames.length - 1] },
    );
    const controller = makeController({ displayFrames });

    await controller.processVideoFrames([keyframe]);
    await controller.processVideoFrames([timedOutDelta]);
    await controller.processVideoFrames([nextDelta]);

    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([
      [keyframe],
      [timedOutDelta],
      [nextDelta],
    ]);
  });

  it("replays cached deltas after a re-entrant tick rejects a batch", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const firstDelta = makeVideoMessage(10_000_000n, "delta");
    const blockedDelta = makeVideoMessage(20_000_000n, "delta");
    const rejectedDelta = makeVideoMessage(30_000_000n, "delta");
    const recoveryDelta = makeVideoMessage(40_000_000n, "delta");
    let resolveBlocked!: (result: ImageSetImageResult) => void;
    const blockedDisplay = new Promise<ImageSetImageResult>((resolve) => {
      resolveBlocked = resolve;
    });
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames) => {
      if (
        frames.length === 1 &&
        toNanoSec(frames[0]!.receiveTime) === toNanoSec(blockedDelta.receiveTime)
      ) {
        return await blockedDisplay;
      }
      if (
        frames.length === 1 &&
        toNanoSec(frames[0]!.receiveTime) === toNanoSec(rejectedDelta.receiveTime)
      ) {
        return { ok: false, reason: "stale" };
      }
      return { ok: true, decodedFrame: frames[frames.length - 1] };
    });
    const resetDecoder = jest.fn();
    const controller = makeController({ displayFrames, resetDecoder });

    await controller.processVideoFrames([keyframe, firstDelta]);
    const blockedWork = controller.processVideoFrames([blockedDelta]);
    await flushAsyncWork();

    await expect(controller.processVideoFrames([rejectedDelta])).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    resolveBlocked({ ok: true, decodedFrame: blockedDelta });
    await expect(blockedWork).resolves.toEqual({ ok: false, reason: "stale" });
    await controller.processVideoFrames([recoveryDelta]);

    expect(resetDecoder).toHaveBeenCalledTimes(1);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [20_000_000n],
      [30_000_000n],
      [0n, 10_000_000n, 20_000_000n, 30_000_000n, 40_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).at(-1)?.[2]).toMatchObject({
      allowIntermediateVideoFrame: false,
      decodeMode: "exact",
    });
  });

  it("keeps submitting deltas when the first keyframe batch drains before producing output", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const nextDelta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (frames) =>
      toNanoSec(frames[0]!.receiveTime) === toNanoSec(keyframe.receiveTime)
        ? { ok: false, reason: "timeout" }
        : { ok: true, decodedFrame: frames[frames.length - 1] },
    );
    const controller = makeController({ displayFrames });

    await expect(controller.processVideoFrames([keyframe])).resolves.toEqual({
      ok: false,
      reason: "timeout",
    });
    await expect(controller.processVideoFrames([nextDelta])).resolves.toMatchObject({ ok: true });

    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([
      [keyframe],
      [nextDelta],
    ]);
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
    void controller.processVideoFrames([], { didSeek: true });
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
    void controller.processVideoFrames([], { didSeek: true });
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
    void controller.processVideoFrames([], { didSeek: true });
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
    void controller.processVideoFrames([], { didSeek: true });

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).not.toHaveBeenCalled();

    await flushAsyncWork();

    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
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
    void controller.processVideoFrames([], { didSeek: true });
    renderer.currentTime = 30_000_000n;
    controller.handleSeek();
    void controller.processVideoFrames([], { didSeek: true });
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
    void controller.processVideoFrames([], { didSeek: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 75));

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);
  });

  it("releases the playback pause lock when a lookback range read fails", async () => {
    jest.useFakeTimers();

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
    void controller.processVideoFrames([], { didSeek: true });
    await jest.advanceTimersByTimeAsync(1_300);

    expect(subscribeMessageRange).toHaveBeenCalledTimes(4);
    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
  });

  it("retries a transient lookback iterator failure without skipping the range", async () => {
    jest.useFakeTimers();

    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(10_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      if (subscribeMessageRange.mock.calls.length === 1) {
        void onNewRangeIterator(
          // eslint-disable-next-line require-yield
          (async function* (): AsyncGenerator<MessageEvent<CompressedVideo>[]> {
            throw new Error("transient range read failure");
          })(),
        );
      } else {
        void onNewRangeIterator(
          (async function* () {
            yield [keyframe, delta];
          })(),
        );
      }
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    void controller.processVideoFrames([], { didSeek: true });
    await jest.advanceTimersByTimeAsync(50);

    expect(subscribeMessageRange).toHaveBeenCalledTimes(2);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);
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
    void controller.processVideoFrames([], { didSeek: true });

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
    void controller.processVideoFrames([], { didSeek: true });
    controller.dispose();
    controller.dispose();

    expect(acquireSeekKeyframeSearchPlaybackPause).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releasePlaybackPause).toHaveBeenCalledTimes(1);
  });

  it("expands non-overlapping lookback windows only until the first GOP can be submitted", async () => {
    // The first short ranges contain only the target delta. The keyframe appears only after the
    // window expands to the recording start, at which point exactly one decode batch is submitted.
    const keyframe = makeVideoMessage(0n, "key");
    const delta = makeVideoMessage(30_000_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async () => ({ ok: false, reason: "timeout" }));
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
    const resetDecoder = jest.fn();
    const controller = makeController({ renderer, displayFrames, resetDecoder });

    controller.handleSeek();
    await controller.processVideoFrames([], { didSeek: true });

    const ranges = subscribeMessageRange.mock.calls.map((call) => call[0].timeRange);
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0]!.end).toEqual({ sec: 30, nsec: 0 });
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.end).toEqual(ranges[i - 1]!.start);
    }
    expect(displayFrames).toHaveBeenCalledTimes(1);
    expect(resetDecoder).toHaveBeenCalledTimes(1);
    expect(unsubscribes).toHaveLength(subscribeMessageRange.mock.calls.length);
    for (const unsubscribe of unsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["timeout", "frame-out-of-order", "stale"] as const)(
    "does not expand or reset after the first cold-seek GOP returns %s",
    async (reason) => {
      const keyframe = makeVideoMessage(0n, "key");
      const delta = makeVideoMessage(10_000_000n, "delta");
      const displayFrames = jest.fn<
        Promise<ImageSetImageResult>,
        Parameters<CompressedVideoDisplayFrames>
      >(async () => ({ ok: false, reason }));
      const resetDecoder = jest.fn();
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
      const controller = makeController({ renderer, displayFrames, resetDecoder });

      controller.handleSeek();
      const result = await controller.processVideoFrames([], { didSeek: true });

      expect(result).toEqual({ ok: false, reason });
      expect(displayFrames).toHaveBeenCalledTimes(1);
      expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
      expect(resetDecoder).toHaveBeenCalledTimes(1);
    },
  );

  it("finishes a lookback seek after timeout before processing the next tick", async () => {
    const keyframe = makeVideoMessage(0n, "key");
    const target = makeVideoMessage(10_000_000n, "delta");
    const nextDelta = makeVideoMessage(20_000_000n, "delta");
    const displayFrames = jest.fn<
      Promise<ImageSetImageResult>,
      Parameters<CompressedVideoDisplayFrames>
    >(async (_frames, mode) => (mode === "seek" ? { ok: false, reason: "timeout" } : { ok: true }));
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, target];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 10_000_000n, subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await controller.processVideoFrames([], { didSeek: true });
    await controller.processVideoFrames([nextDelta]);

    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [20_000_000n],
    ]);
    expect(nonResetCalls(displayFrames).map((call) => call[1])).toEqual(["seek", "playback"]);
  });

  it("keeps distinct lookback frames that share a receive time", async () => {
    const keyframe = makeVideoMessageWithTimes(0n, 0n, "key");
    const target = makeVideoMessageWithTimes(0n, 1n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, target];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await controller.processVideoFrames([], { didSeek: true });

    expect(nonResetCalls(displayFrames).map(([frames]) => frames)).toEqual([[keyframe, target]]);
  });

  it("keeps physical GOP order when a future publish timestamp precedes the target", async () => {
    const keyframe = makeVideoMessageWithTimes(1_000_000n, 100_000_000_000n, "key");
    const futureDelta = makeVideoMessageWithTimes(2_000_000n, 102_000_000_000n, "delta");
    const targetDelta = makeVideoMessageWithTimes(3_000_000n, 101_000_000_000n, "delta");
    const displayFrames = makeSuccessfulDisplayFrames();
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >(({ onNewRangeIterator }) => {
      void onNewRangeIterator(
        (async function* () {
          yield [keyframe, futureDelta, targetDelta];
        })(),
      );
      return jest.fn();
    });
    const renderer = makeRenderer({ currentTime: 3_000_000n, subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    await controller.processVideoFrames([], {
      didSeek: true,
      targetFrame: targetDelta,
    });

    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [1_000_000n, 2_000_000n, 3_000_000n],
    ]);
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

    const firstResult = controller.processVideoFrames([keyframe, middle, delta], {
      synchronize: true,
      targetFrame: middle,
    });
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
    ]);

    const secondResult = controller.processVideoFrames([], {
      synchronize: true,
      targetFrame: delta,
    });
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [0n, 10_000_000n],
      [0n, 10_000_000n, 20_000_000n],
    ]);

    pendingDisplays[1]?.({ ok: true });
    await expect(secondResult).resolves.toEqual({ ok: true });

    pendingDisplays[0]?.({ ok: false, reason: "failed" });
    await expect(firstResult).resolves.toEqual({ ok: false, reason: "failed" });

    // The newer full-GOP replay invalidates the older generation before rewinding to its keyframe.
    expect(resetCallCount(displayFrames)).toBe(1);
  });

  it("ignores a cancelled seek-tick lookback after a newer seek starts", async () => {
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
    const renderer = makeRenderer({ currentTime: 10_000_000n, subscribeMessageRange });
    const controller = makeController({ renderer, displayFrames });

    controller.handleSeek();
    const firstResult = controller.processVideoFrames([], {
      didSeek: true,
      targetFrame: firstDelta,
    });
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);

    renderer.currentTime = 30_000_000n;
    controller.handleSeek();
    const secondResult = controller.processVideoFrames([], {
      didSeek: true,
      targetFrame: secondDelta,
    });
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

    await expect(firstResult).resolves.toEqual({ ok: false, reason: "stale" });
    await expect(secondResult).resolves.toEqual({ ok: true });
    expect(nonResetCalls(displayFrames).map(([frames]) => frameReceiveTimes(frames))).toEqual([
      [20_000_000n, 30_000_000n],
    ]);
  });

  it("classifies cancelled and failed lookback range reads distinctly in playback telemetry", async () => {
    jest.useFakeTimers();

    // Force sampling on the process-wide metrics singleton the controller reports to.
    playbackPerformanceMetrics.overrideRandomForTests(() => 0);
    const emitted: Array<Record<string, string | number>> = [];
    const uninstall = playbackPerformanceMetrics.installSink((data) => emitted.push({ ...data }));
    try {
      playbackPerformanceMetrics.beginSeek();

      const subscribeMessageRange = jest.fn<
        ReturnType<SubscribeMessageRange>,
        Parameters<SubscribeMessageRange>
      >(({ onNewRangeIterator }) => {
        if (subscribeMessageRange.mock.calls.length > 1) {
          // Second seek's read: the range iterator throws mid-collection.
          void onNewRangeIterator(
            // eslint-disable-next-line require-yield
            (async function* (): AsyncGenerator<MessageEvent<CompressedVideo>[]> {
              throw new Error("iterator failed");
            })(),
          );
        }
        // First seek's read stays pending until the newer seek cancels it.
        return jest.fn();
      });
      const renderer = makeRenderer({ currentTime: 20_000_000n, subscribeMessageRange });
      const controller = makeController({ renderer });

      controller.handleSeek();
      void controller.processVideoFrames([], { didSeek: true });
      renderer.currentTime = 30_000_000n;
      controller.handleSeek();
      void controller.processVideoFrames([], { didSeek: true });
      await jest.advanceTimersByTimeAsync(1_300);

      playbackPerformanceMetrics.finishCurrent("closed");
      expect(emitted).toHaveLength(1);
      // Neither the cancelled read nor the exception may be counted as a successful range read.
      expect(emitted[0]).toEqual(
        expect.objectContaining({
          status: "closed",
          range_read_count: 5,
          range_read_cancel_count: 1,
          range_read_failure_count: 4,
          lookback_count: 2,
          lookback_cancel_count: 1,
          lookback_failure_count: 1,
        }),
      );
    } finally {
      uninstall();
      playbackPerformanceMetrics.overrideRandomForTests(undefined);
    }
  });
});
