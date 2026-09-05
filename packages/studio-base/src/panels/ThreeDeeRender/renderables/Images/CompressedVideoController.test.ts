/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { H264 } from "@foxglove/den/video";
import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import {
  CompressedVideoController,
  CompressedVideoDisplayFrames,
} from "./CompressedVideoController";
import { ImageSetImageResult } from "./ImageRenderable";
import { CompressedVideo } from "./ImageTypes";
import { VideoGopCache } from "./videoGopCache";

function frame(time: number, kind: "key" | "delta" = "delta"): MessageEvent<CompressedVideo> {
  return {
    topic: "/camera",
    schemaName: "foxglove.CompressedVideo",
    receiveTime: fromNanoSec(BigInt(time)),
    sizeInBytes: 1,
    message: {
      timestamp: fromNanoSec(BigInt(time)),
      frame_id: "camera",
      format: "h264",
      data: new Uint8Array([kind === "key" ? 0x65 : 0x41]),
    },
  };
}
function setup() {
  const renderer = {
    currentTime: 1000n,
    startTime: 0n,
    stopped: false,
    isPlaybackStopped: () => renderer.stopped,
    subscribeMessageRange: undefined as SubscribeMessageRange | undefined,
  };
  const display = jest.fn<
    ReturnType<CompressedVideoDisplayFrames>,
    Parameters<CompressedVideoDisplayFrames>
  >(async () => ({ ok: true }));
  const reset = jest.fn();
  const controller = new CompressedVideoController({
    topic: "/camera",
    renderer,
    displayFrames: display,
    resetDecoder: reset,
  });
  return { renderer, display, reset, controller };
}
async function flush() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}
function deferred() {
  let resolve!: (result: ImageSetImageResult) => void;
  const promise = new Promise<ImageSetImageResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("tick incremental video scheduling", () => {
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

  it("returns void before decode and clips only the last keyframe suffix", async () => {
    const { controller, display } = setup();
    const tick = [frame(1), frame(2, "key"), frame(3), frame(4, "key"), frame(5), frame(6)];
    // oxlint-disable-next-line typescript/no-confusing-void-expression -- Assert the void ingestion contract.
    expect(controller.enqueueVideoFrames(tick)).toBeUndefined();
    expect(display).not.toHaveBeenCalled();
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
    expect(display.mock.calls[0]![0]).toEqual(tick.slice(3));
    expect(display.mock.calls[0]![0][0]!.message.data).toBe(tick[3]!.message.data);
    expect(display.mock.calls[0]![2]).toMatchObject({
      retainLateTarget: false,
      targetFrameTimeoutMs: 30,
      anyFrameTimeoutMs: 100,
    });
  });

  it("submits each consecutive tick independently without reading or replaying cache", async () => {
    const receive = jest.spyOn(VideoGopCache.prototype, "framesForReceiveTime");
    const publish = jest.spyOn(VideoGopCache.prototype, "framesForPublishTime");
    const { controller, display } = setup();
    const first = [frame(1, "key"), frame(2)];
    const second = [frame(3), frame(4)];
    controller.enqueueVideoFrames(first);
    await flush();
    controller.enqueueVideoFrames(second);
    await flush();
    expect(display.mock.calls.map(([frames]) => frames)).toEqual([first, second]);
    expect(display.mock.calls[1]![2]).toMatchObject({
      targetFrameTimeoutMs: 30,
      anyFrameTimeoutMs: undefined,
    });
    expect(receive).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps one active and one pending, and empty ticks do not replace or gap pending", async () => {
    const { controller, display } = setup();
    const active = deferred();
    display.mockReturnValueOnce(active.promise);
    controller.enqueueVideoFrames([frame(1, "key")]);
    await flush();
    const next = [frame(2), frame(3)];
    controller.enqueueVideoFrames(next);
    controller.enqueueVideoFrames([]);
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
    active.resolve({ ok: true });
    await flush();
    expect(
      display.mock.calls.map(([frames]) => frames.map((event) => toNanoSec(event.receiveTime))),
    ).toEqual([[1n], [2n, 3n]]);
  });

  it("drops overwritten deltas without invalidating the active result, then recovers at a new IDR", async () => {
    const { controller, display } = setup();
    const active = deferred();
    display.mockReturnValueOnce(active.promise);
    controller.enqueueVideoFrames([frame(1, "key")]);
    await flush();
    const guard = display.mock.calls[0]![2]!.isVideoFrameRequestCurrent!;
    controller.enqueueVideoFrames([frame(2)]);
    controller.enqueueVideoFrames([frame(3)]);
    expect(guard()).toBe(true);
    active.resolve({ ok: true });
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
    controller.enqueueVideoFrames([frame(4)]);
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
    controller.enqueueVideoFrames([frame(5, "key"), frame(6)]);
    await flush();
    expect(display).toHaveBeenCalledTimes(2);
  });

  it("replaces pending with a new keyframe tick without aborting the active batch", async () => {
    const { controller, display, reset } = setup();
    const active = deferred();
    display.mockReturnValueOnce(active.promise);
    controller.enqueueVideoFrames([frame(1, "key")]);
    await flush();
    controller.enqueueVideoFrames([frame(2)]);
    const latest = [frame(3, "key"), frame(4)];
    controller.enqueueVideoFrames(latest);
    active.resolve({ ok: true });
    await flush();
    expect(display.mock.calls[1]![0]).toEqual(latest);
    expect(reset).not.toHaveBeenCalled();
  });

  it.each([12, 13])("uses the %i-frame limit only on a single clipped tick", async (count) => {
    const { controller, display } = setup();
    controller.enqueueVideoFrames(
      Array.from({ length: count }, (_, index) => frame(index, index === 0 ? "key" : "delta")),
    );
    await flush();
    expect(display).toHaveBeenCalledTimes(count === 12 ? 1 : 0);
    if (count === 13) {
      controller.enqueueVideoFrames([frame(14)]);
      await flush();
      expect(display).not.toHaveBeenCalled();
      controller.enqueueVideoFrames([frame(15, "key")]);
      await flush();
      expect(display.mock.calls[0]![0]).toEqual([frame(15, "key")]);
    }
  });

  it("keeps decoding consecutive ticks when presentation rejects a candidate", async () => {
    const { controller, display } = setup();
    const canDisplayFrame = jest.fn(() => false);
    const first = [frame(1, "key"), frame(2), frame(3)];
    controller.enqueueVideoFrames(first, { canDisplayFrame });
    await flush();
    controller.enqueueVideoFrames([frame(4)], { canDisplayFrame });
    await flush();
    expect(display.mock.calls.map(([frames]) => frames)).toEqual([first, [frame(4)]]);
    expect(display.mock.calls[0]![2]!.canDisplayFrame).toBe(canDisplayFrame);
    expect(canDisplayFrame).not.toHaveBeenCalled();
  });

  it("does not look back on playback cache misses or after a decoder reset", async () => {
    const { controller, display, renderer } = setup();
    renderer.subscribeMessageRange = jest.fn();
    controller.enqueueVideoFrames([frame(1)]);
    await flush();
    controller.enqueueVideoFrames([frame(2, "key")]);
    await flush();
    controller.resetPlaybackState();
    await flush();
    controller.enqueueVideoFrames([frame(3)]);
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
    expect(renderer.subscribeMessageRange).not.toHaveBeenCalled();
  });

  it("cache eviction alone does not break live decoder continuity", async () => {
    const { controller, display, reset } = setup();
    controller.enqueueVideoFrames([frame(1, "key")]);
    await flush();
    // Evict cached references without touching the decoder.
    jest.spyOn(VideoGopCache.prototype, "addFrames").mockImplementation(function (
      this: VideoGopCache,
    ) {
      this.clearTopic("/camera");
    });
    controller.enqueueVideoFrames([frame(2)]);
    await flush();
    expect(display).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
  });

  it.each(["timeout", "failed"] as const)(
    "handles worker %s without replaying a historical target",
    async (reason) => {
      const { controller, display } = setup();
      display.mockResolvedValueOnce({ ok: false, reason });
      controller.enqueueVideoFrames([frame(1, "key")]);
      await flush();
      controller.enqueueVideoFrames([frame(2)]);
      await flush();
      expect(display).toHaveBeenCalledTimes(reason === "timeout" ? 2 : 1);
    },
  );

  it("invalidates active generations on backwards timestamps but not duplicate timestamps", async () => {
    const { controller, display } = setup();
    const active = deferred();
    display.mockReturnValueOnce(active.promise);
    controller.enqueueVideoFrames([frame(10, "key")]);
    await flush();
    const guard = display.mock.calls[0]![2]!.isVideoFrameRequestCurrent!;
    controller.enqueueVideoFrames([frame(10)]);
    expect(guard()).toBe(true);
    controller.enqueueVideoFrames([frame(1, "key")]);
    expect(guard()).toBe(false);
    active.resolve({ ok: true });
    await flush();
    expect(display.mock.calls.at(-1)![0]).toEqual([frame(1, "key")]);
  });

  it("drops stopped pending, allows only the latest active target, and never drains at EOF", async () => {
    const { controller, display, renderer } = setup();
    const active = deferred();
    display.mockReturnValueOnce(active.promise);
    controller.enqueueVideoFrames([frame(1, "key")]);
    await flush();
    controller.enqueueVideoFrames([frame(2)]);
    renderer.stopped = true;
    controller.updatePlaybackState();
    controller.enqueueVideoFrames([]);
    expect(display.mock.calls[0]![2]!.isVideoFrameRequestCurrent!()).toBe(false);
    active.resolve({ ok: true });
    await flush();
    controller.enqueueVideoFrames([frame(3, "key")]);
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
  });

  it("an explicit stopped seek may submit a full cached GOP larger than the playback limit", async () => {
    const { controller, display, renderer } = setup();
    const frames = Array.from({ length: 20 }, (_, index) =>
      frame(index, index === 0 ? "key" : "delta"),
    );
    controller.enqueueVideoFrames(frames);
    await flush();
    renderer.currentTime = 19n;
    renderer.stopped = true;
    controller.handleSeek();
    expect(display).not.toHaveBeenCalled();
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
    expect(display.mock.calls[0]![0]).toEqual(frames);
    expect(display.mock.calls[0]![1]).toBe("seek");
    expect(display.mock.calls[0]![2]).toMatchObject({
      retainLateTarget: true,
      targetFrameTimeoutMs: 200,
      anyFrameTimeoutMs: 2000,
    });
  });

  it("does not reset the decoder merely because a stopped active result is stale", async () => {
    const { controller, renderer, display, reset } = setup();
    const active = deferred();
    display.mockReturnValueOnce(active.promise);
    controller.enqueueVideoFrames([frame(1, "key")]);
    await flush();
    controller.enqueueVideoFrames([frame(2)]);
    renderer.stopped = true;
    controller.updatePlaybackState();
    active.resolve({ ok: false, reason: "stale" });
    await flush();
    expect(reset).not.toHaveBeenCalled();
    renderer.stopped = false;
    controller.enqueueVideoFrames([frame(3)]);
    await flush();
    expect(display).toHaveBeenCalledTimes(1);
  });

  it("cancels a late target after new input, but not on an empty tick or before done", async () => {
    const { controller } = setup();
    const cancelLateTarget = jest.fn();
    controller.updateOptions({ cancelLateTarget });
    controller.enqueueVideoFrames([frame(1, "key")]);
    expect(cancelLateTarget).not.toHaveBeenCalled();
    await flush();
    expect(cancelLateTarget).toHaveBeenCalledTimes(1);
    controller.enqueueVideoFrames([]);
    await flush();
    expect(cancelLateTarget).toHaveBeenCalledTimes(1);
    controller.enqueueVideoFrames([frame(2)]);
    expect(cancelLateTarget).toHaveBeenCalledTimes(1);
    await flush();
    expect(cancelLateTarget).toHaveBeenCalledTimes(2);
  });

  it("starts explicit range lookback only after the synchronous stack and cancels it when the head moves", async () => {
    const { controller, renderer, display } = setup();
    const unsubscribe = jest.fn();
    renderer.subscribeMessageRange = jest.fn(() => unsubscribe);
    controller.handleSeek();
    expect(renderer.subscribeMessageRange).not.toHaveBeenCalled();
    await flush();
    expect(renderer.subscribeMessageRange).toHaveBeenCalledTimes(1);
    renderer.currentTime++;
    controller.updatePlaybackState();
    await flush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(display).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("retains legacy array payloads during ingest and converts them only after done", async () => {
    const { controller, display } = setup();
    const bytes = [0x65];
    const legacy = { ...frame(1, "key"), message: { ...frame(1, "key").message, data: bytes } };
    const add = jest.spyOn(VideoGopCache.prototype, "addFrames");
    controller.enqueueVideoFrames([legacy as unknown as MessageEvent<CompressedVideo>]);
    expect(add.mock.calls[0]![0][0]!.message).toMatchObject({ data: bytes });
    expect((add.mock.calls[0]![0][0]!.message as { data: unknown }).data).toBe(bytes);
    expect(display).not.toHaveBeenCalled();
    await flush();
    expect(display.mock.calls[0]![0][0]!.message.data).toEqual(new Uint8Array(bytes));
    expect(legacy.message.data).toBe(bytes);
  });

  it("does not decode an old legacy tick after a newer tick supersedes its pending input", async () => {
    const { controller, display } = setup();
    const legacy = { ...frame(1, "key"), message: { ...frame(1, "key").message, data: [0x65] } };
    controller.enqueueVideoFrames([legacy as unknown as MessageEvent<CompressedVideo>]);
    controller.enqueueVideoFrames([frame(2)]);
    await flush();
    expect(display).not.toHaveBeenCalled();
    controller.enqueueVideoFrames([frame(3, "key")]);
    await flush();
    expect(display.mock.calls[0]![0]).toEqual([frame(3, "key")]);
  });

  it.each(["h264", "h265"])(
    "recognizes legacy %s keyframes with the real parser before deferred payload conversion",
    async (format) => {
      jest.restoreAllMocks();
      const { controller, display } = setup();
      const tick = ["delta", "key", "delta", "key", "delta"].map((kind, index) => ({
        ...frame(index),
        message: {
          ...frame(index).message,
          format,
          data:
            format === "h264"
              ? [0, 0, 0, 1, kind === "key" ? 0x65 : 0x41]
              : [0, 0, 0, 1, kind === "key" ? 0x26 : 0x02, 1],
        },
      }));
      const add = jest.spyOn(VideoGopCache.prototype, "addFrames");
      controller.enqueueVideoFrames(tick as unknown as MessageEvent<CompressedVideo>[]);
      expect(display).not.toHaveBeenCalled();
      for (let i = 0; i < tick.length; i++) {
        expect((add.mock.calls[0]![0][i]!.message as { data: unknown }).data).toBe(
          tick[i]!.message.data,
        );
      }
      await flush();
      expect(display).toHaveBeenCalledTimes(1);
      expect(display.mock.calls[0]![0]).toEqual(
        tick.slice(3).map((event) => ({
          ...event,
          message: { ...event.message, data: new Uint8Array(event.message.data) },
        })),
      );
      expect(tick.every((event) => Array.isArray(event.message.data))).toBe(true);
    },
  );
});
