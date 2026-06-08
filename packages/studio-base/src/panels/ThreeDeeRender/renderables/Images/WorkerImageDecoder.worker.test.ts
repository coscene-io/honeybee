// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CompressedVideo } from "./ImageTypes";

const mockVideoPlayers: MockVideoPlayer[] = [];

jest.mock("@coscene-io/comlink", () => ({
  expose: jest.fn(),
  transfer: <T>(value: T) => value,
}));

jest.mock("@foxglove/den/video", () => {
  class MockedVideoPlayer {
    public initialized = false;
    public readonly init = jest.fn(async () => {
      this.initialized = true;
    });
    public readonly isInitialized = jest.fn(() => this.initialized);
    public readonly resetForSeek = jest.fn(() => {
      this.initialized = false;
    });
    public readonly queueFrames = jest.fn();

    public constructor() {
      mockVideoPlayers.push(this as unknown as MockVideoPlayer);
    }
  }

  return {
    H264: {
      IsKeyframe: (data: Uint8Array) => data[4] === 0x65,
      ParseDecoderConfig: (data: Uint8Array) =>
        data[5] === 0xff ? undefined : { codec: "avc1.mock" },
    },
    H265: {
      IsKeyframe: jest.fn(() => false),
      ParseDecoderConfig: jest.fn(() => undefined),
    },
    VideoPlayer: MockedVideoPlayer,
  };
});

type MockVideoPlayer = {
  initialized: boolean;
  init: jest.Mock<Promise<void>, [VideoDecoderConfig]>;
  isInitialized: jest.Mock<boolean, []>;
  resetForSeek: jest.Mock<void, []>;
  queueFrames: jest.Mock;
};

let service: typeof import("./WorkerImageDecoder.worker").service;

function h264Frame(sec: number, kind: "key" | "delta"): CompressedVideo {
  return {
    format: "h264",
    data: new Uint8Array([0, 0, 0, 1, kind === "key" ? 0x65 : 0x41, 0]),
    timestamp: { sec, nsec: 0 },
    frame_id: "camera",
  };
}

function emitLastQueuedFrame(player: MockVideoPlayer): VideoFrame {
  const call = player.queueFrames.mock.calls[player.queueFrames.mock.calls.length - 1]!;
  const queuedFrames = call[0] as Array<{
    metadata: { originalTimestamp: bigint; receiveTime: bigint };
  }>;
  const onFrame = call[1] as (frame: {
    frame: VideoFrame;
    metadata: { originalTimestamp: bigint; receiveTime: bigint };
  }) => void;
  const frame = { close: jest.fn() } as unknown as VideoFrame;
  onFrame({
    frame,
    metadata: queuedFrames[queuedFrames.length - 1]!.metadata,
  });
  return frame;
}

function emitQueuedFrame(player: MockVideoPlayer, index: number): VideoFrame {
  const call = player.queueFrames.mock.calls[player.queueFrames.mock.calls.length - 1]!;
  const queuedFrames = call[0] as Array<{
    metadata: { originalTimestamp: bigint; receiveTime: bigint };
  }>;
  const onFrame = call[1] as (frame: {
    frame: VideoFrame;
    metadata: { originalTimestamp: bigint; receiveTime: bigint };
  }) => void;
  const frame = { close: jest.fn() } as unknown as VideoFrame;
  onFrame({
    frame,
    metadata: queuedFrames[index]!.metadata,
  });
  return frame;
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("WorkerImageDecoder worker video batches", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockVideoPlayers.length = 0;
    jest.clearAllMocks();
    service = (await import("./WorkerImageDecoder.worker")).service;
  });

  afterEach(() => {
    service.resetVideoDecoder();
  });

  it("keeps a stable stream timestamp base across forward batches", async () => {
    const firstResultPromise = service.decodeVideoFrames({
      requestId: 1,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 1n },
        { frame: h264Frame(2, "delta"), receiveTime: 2n },
      ],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    expect(
      player.queueFrames.mock.calls[0]![0].map(
        (frame: { timestampMicros: number }) => frame.timestampMicros,
      ),
    ).toEqual([0, 1_000_000]);
    emitLastQueuedFrame(player);
    await expect(firstResultPromise).resolves.toMatchObject({ type: "TargetFrame" });

    const secondResultPromise = service.decodeVideoFrames({
      requestId: 2,
      frames: [
        { frame: h264Frame(3, "key"), receiveTime: 3n },
        { frame: h264Frame(4, "delta"), receiveTime: 4n },
      ],
    });
    await flushPromises();

    expect(
      player.queueFrames.mock.calls[1]![0].map(
        (frame: { timestampMicros: number }) => frame.timestampMicros,
      ),
    ).toEqual([2_000_000, 3_000_000]);
    emitLastQueuedFrame(player);
    await expect(secondResultPromise).resolves.toMatchObject({ type: "TargetFrame" });
  });

  it("clears the stream timestamp base on decoder reset", async () => {
    const firstResultPromise = service.decodeVideoFrames({
      requestId: 1,
      frames: [{ frame: h264Frame(5, "key"), receiveTime: 5n }],
    });
    await flushPromises();
    const player = mockVideoPlayers[0]!;
    emitLastQueuedFrame(player);
    await firstResultPromise;

    service.resetVideoDecoder();

    const secondResultPromise = service.decodeVideoFrames({
      requestId: 2,
      frames: [{ frame: h264Frame(10, "key"), receiveTime: 10n }],
    });
    await flushPromises();

    expect(
      player.queueFrames.mock.calls[1]![0].map(
        (frame: { timestampMicros: number }) => frame.timestampMicros,
      ),
    ).toEqual([0]);
    emitLastQueuedFrame(player);
    await expect(secondResultPromise).resolves.toMatchObject({ type: "TargetFrame" });
  });

  it("uses unique decode timestamps for duplicate original timestamps", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 10n },
        { frame: h264Frame(1, "delta"), receiveTime: 20n },
      ],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    expect(
      player.queueFrames.mock.calls[0]![0].map(
        (frame: { timestampMicros: number }) => frame.timestampMicros,
      ),
    ).toEqual([0, 1]);

    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });
    emitQueuedFrame(player, 0);
    await flushPromises();
    expect(settled).toBe(false);

    emitQueuedFrame(player, 1);
    await expect(resultPromise).resolves.toMatchObject({
      type: "TargetFrame",
      originalTimestamp: 1_000_000_000n,
      receiveTime: 20n,
    });
  });

  it("returns FrameOutOfOrder when a replay batch contains decreasing original timestamps", async () => {
    const result = await service.decodeVideoFrames({
      requestId: 1,
      frames: [
        { frame: h264Frame(2, "key"), receiveTime: 20n },
        { frame: h264Frame(1, "delta"), receiveTime: 10n },
      ],
    });

    expect(result).toEqual({ type: "FrameOutOfOrder", requestId: 1 });
    expect(mockVideoPlayers[0]?.resetForSeek).toHaveBeenCalled();
  });

  it("resolves awaitTargetFrame when the target frame arrives after an intermediate frame", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 0,
      anyFrameTimeoutMs: 1000,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 10n },
        { frame: h264Frame(2, "delta"), receiveTime: 20n },
      ],
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = mockVideoPlayers[0]!;
    const intermediateFrame = emitQueuedFrame(player, 0);
    await expect(resultPromise).resolves.toMatchObject({
      type: "IntermediateFrame",
      originalTimestamp: 1_000_000_000n,
      receiveTime: 10n,
    });
    expect((intermediateFrame as unknown as { close: jest.Mock }).close).not.toHaveBeenCalled();

    const awaitPromise = service.awaitTargetFrame({ requestId: 1 });
    const targetFrame = emitQueuedFrame(player, 1);
    await expect(awaitPromise).resolves.toMatchObject({
      type: "TargetFrame",
      originalTimestamp: 2_000_000_000n,
      receiveTime: 20n,
    });
    expect((targetFrame as unknown as { close: jest.Mock }).close).not.toHaveBeenCalled();
  });

  it("aborts pending awaitTargetFrame on decoder reset", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 0,
      anyFrameTimeoutMs: 1000,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 10n },
        { frame: h264Frame(2, "delta"), receiveTime: 20n },
      ],
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    emitQueuedFrame(mockVideoPlayers[0]!, 0);
    await expect(resultPromise).resolves.toMatchObject({ type: "IntermediateFrame" });

    const awaitPromise = service.awaitTargetFrame({ requestId: 1 });
    service.resetVideoDecoder();
    await expect(awaitPromise).resolves.toEqual({ type: "Aborted", requestId: 1 });
  });

  it("closes late non-target frames after returning an intermediate frame", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 0,
      anyFrameTimeoutMs: 1000,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 10n },
        { frame: h264Frame(2, "delta"), receiveTime: 20n },
        { frame: h264Frame(3, "delta"), receiveTime: 30n },
      ],
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = mockVideoPlayers[0]!;
    emitQueuedFrame(player, 0);
    await expect(resultPromise).resolves.toMatchObject({ type: "IntermediateFrame" });

    const lateNonTarget = emitQueuedFrame(player, 1);
    expect((lateNonTarget as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
  });
});
