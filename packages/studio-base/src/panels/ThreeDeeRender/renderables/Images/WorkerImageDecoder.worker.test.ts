// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CompressedVideo } from "./ImageTypes";

const mockVideoPlayers: MockVideoPlayer[] = [];
const mockH264GetFrameInfo = jest.fn((data: Uint8Array) => ({
  isKeyFrame: data[4] === 0x65,
  mayNeedRewrite: data[5] === 0xfe,
}));
const mockH264RewriteForLowLatencyDecoding = jest.fn(
  (data: Uint8Array) => new Uint8Array([...data, 0xaa]),
);
let mockInitImpl: (() => Promise<void>) | undefined;
let mockQueueFramesImpl:
  | ((
      frames: readonly unknown[],
      onFrame: (frame: { frame: VideoFrame; metadata: unknown }) => void,
    ) => void | Promise<void>)
  | undefined;

jest.mock("@coscene-io/comlink", () => ({
  expose: jest.fn(),
  transfer: <T>(value: T) => value,
}));

jest.mock("@foxglove/den/video", () => {
  class MockedVideoPlayer {
    readonly #errorListeners = new Set<(error: Error) => void>();
    public initialized = false;
    public readonly init = jest.fn(async () => {
      if (mockInitImpl != undefined) {
        await mockInitImpl();
      }
      this.initialized = true;
    });
    public readonly isInitialized = jest.fn(() => this.initialized);
    public readonly resetForSeek = jest.fn(() => {
      this.initialized = false;
    });
    public readonly discardQueuedFramesExcept = jest.fn();
    public readonly queueFrames = jest.fn(
      async (
        frames: readonly unknown[],
        onFrame: (frame: { frame: VideoFrame; metadata: unknown }) => void,
      ) => {
        await mockQueueFramesImpl?.(frames, onFrame);
      },
    );
    public readonly on = jest.fn((event: string, listener: (error: Error) => void) => {
      if (event === "error") {
        this.#errorListeners.add(listener);
      }
      return this;
    });
    public readonly off = jest.fn((event: string, listener: (error: Error) => void) => {
      if (event === "error") {
        this.#errorListeners.delete(listener);
      }
      return this;
    });
    public emitError(error: Error): void {
      for (const listener of this.#errorListeners) {
        listener(error);
      }
    }

    public constructor() {
      mockVideoPlayers.push(this as unknown as MockVideoPlayer);
    }
  }

  return {
    H264: {
      IsKeyframe: (data: Uint8Array) => data[4] === 0x65,
      GetFrameInfo: mockH264GetFrameInfo,
      RewriteForLowLatencyDecoding: mockH264RewriteForLowLatencyDecoding,
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
  discardQueuedFramesExcept: jest.Mock<void, [number?]>;
  queueFrames: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  emitError: (error: Error) => void;
};

let service: typeof import("./WorkerImageDecoder.worker").service;

function h264Frame(sec: number, kind: "key" | "delta", marker = 0): CompressedVideo {
  return {
    format: "h264",
    data: new Uint8Array([0, 0, 0, 1, kind === "key" ? 0x65 : 0x41, marker]),
    timestamp: { sec, nsec: 0 },
    frame_id: "camera",
  };
}

function emitQueuedFrameFromCall(
  player: MockVideoPlayer,
  callIndex: number,
  frameIndex: number,
): VideoFrame {
  const call = player.queueFrames.mock.calls[callIndex]!;
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
    metadata: queuedFrames[frameIndex]!.metadata,
  });
  return frame;
}

function emitLastQueuedFrame(player: MockVideoPlayer): VideoFrame {
  const call = player.queueFrames.mock.calls[player.queueFrames.mock.calls.length - 1]!;
  const queuedFrames = call[0] as Array<{
    metadata: { originalTimestamp: bigint; receiveTime: bigint };
  }>;
  return emitQueuedFrameFromCall(
    player,
    player.queueFrames.mock.calls.length - 1,
    queuedFrames.length - 1,
  );
}

function emitQueuedFrame(player: MockVideoPlayer, index: number): VideoFrame {
  return emitQueuedFrameFromCall(player, player.queueFrames.mock.calls.length - 1, index);
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
    mockInitImpl = undefined;
    mockQueueFramesImpl = undefined;
    service = (await import("./WorkerImageDecoder.worker")).service;
  });

  afterEach(() => {
    jest.useRealTimers();
    service.resetVideoDecoder();
  });

  it("keeps a stable stream timestamp base across forward batches", async () => {
    const firstResultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
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
      targetFrameTimeoutMs: 1000,
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

  it("rejects a second batch while the previous batch is pending", async () => {
    const firstResultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    expect(player.queueFrames).toHaveBeenCalledTimes(1);

    const secondResultPromise = service.decodeVideoFrames({
      requestId: 2,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(2, "delta"), receiveTime: 2n }],
    });

    await expect(secondResultPromise).rejects.toThrow(
      "Cannot decode a new video batch while another batch is in progress",
    );
    expect(player.queueFrames).toHaveBeenCalledTimes(1);

    emitQueuedFrameFromCall(player, 0, 0);
    await expect(firstResultPromise).resolves.toMatchObject({ type: "TargetFrame" });
  });

  it("rebases after reset without reusing a decoder timestamp", async () => {
    const firstResultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(5, "key"), receiveTime: 5n }],
    });
    await flushPromises();
    const player = mockVideoPlayers[0]!;
    emitLastQueuedFrame(player);
    await firstResultPromise;

    service.resetVideoDecoder();

    const secondResultPromise = service.decodeVideoFrames({
      requestId: 2,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(5, "key"), receiveTime: 10n }],
    });
    await flushPromises();

    expect(
      player.queueFrames.mock.calls[1]![0].map(
        (frame: { timestampMicros: number }) => frame.timestampMicros,
      ),
    ).toEqual([1]);
    emitLastQueuedFrame(player);
    await expect(secondResultPromise).resolves.toMatchObject({ type: "TargetFrame" });
  });

  it("uses unique decode timestamps for duplicate original timestamps", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
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
      batchIndex: 1,
    });
  });

  it("identifies the target by batch position when publish and receive timestamps repeat", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 10n },
        { frame: h264Frame(1, "delta"), receiveTime: 10n },
      ],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
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
      receiveTime: 10n,
      batchIndex: 1,
    });
  });

  it("rewrites H264 frames marked mayNeedRewrite before queueing", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(1, "key", 0xfe), receiveTime: 1n }],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    const queuedFrames = player.queueFrames.mock.calls[0]![0] as Array<{ data: Uint8Array }>;
    expect(mockH264RewriteForLowLatencyDecoding).toHaveBeenCalledWith(
      new Uint8Array([0, 0, 0, 1, 0x65, 0xfe]),
    );
    expect(queuedFrames[0]!.data).toEqual(new Uint8Array([0, 0, 0, 1, 0x65, 0xfe, 0xaa]));

    emitLastQueuedFrame(player);
    await expect(resultPromise).resolves.toMatchObject({ type: "TargetFrame" });
  });

  it("rejects empty batches and invalid timeout ranges", async () => {
    await expect(
      service.decodeVideoFrames({ requestId: 1, targetFrameTimeoutMs: 30, frames: [] }),
    ).rejects.toThrow("Cannot decode an empty video batch");
    await expect(
      service.decodeVideoFrames({
        requestId: 2,
        targetFrameTimeoutMs: 100,
        anyFrameTimeoutMs: 30,
        frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
      }),
    ).rejects.toThrow("anyFrameTimeoutMs must be greater than or equal to targetFrameTimeoutMs");
  });

  it("starts frame timeouts only after the decoder queue drains", async () => {
    jest.useFakeTimers();
    let resolveDrain: (() => void) | undefined;
    mockQueueFramesImpl = async () => {
      await new Promise<void>((resolve) => {
        resolveDrain = resolve;
      });
    };

    let settled = false;
    const resultPromise = service
      .decodeVideoFrames({
        requestId: 1,
        targetFrameTimeoutMs: 30,
        frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await flushPromises();

    await jest.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    resolveDrain?.();
    await flushPromises();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(30);
    await expect(resultPromise).resolves.toEqual({ type: "Timeout", requestId: 1 });
  });

  it("returns an exact target that is the first output after the target timeout", async () => {
    jest.useFakeTimers();
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 30,
      anyFrameTimeoutMs: 100,
      frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
    });
    await flushPromises();

    await jest.advanceTimersByTimeAsync(30);
    const targetFrame = emitLastQueuedFrame(mockVideoPlayers[0]!);

    await expect(resultPromise).resolves.toMatchObject({
      type: "TargetFrame",
      frame: targetFrame,
      originalTimestamp: 1_000_000_000n,
      receiveTime: 1n,
    });
    await expect(service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 })).resolves.toEqual({
      type: "Aborted",
      requestId: 1,
    });
  });

  it("aborts the active batch when the decoder fails after its queue drains", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    player.emitError(new DOMException("decoder failed", "EncodingError"));

    await expect(resultPromise).resolves.toEqual({ type: "Aborted", requestId: 1 });
    await expect(service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 })).resolves.toEqual({
      type: "Aborted",
      requestId: 1,
    });
    expect(player.resetForSeek).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("aborts the only late-target waiter on a post-drain decoder error", async () => {
    jest.useFakeTimers();
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 30,
      frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
    });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(30);
    await expect(resultPromise).resolves.toEqual({ type: "Timeout", requestId: 1 });

    const awaitTargetPromise = service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 });
    const player = mockVideoPlayers[0]!;
    player.emitError(new DOMException("decoder failed", "EncodingError"));

    await expect(awaitTargetPromise).resolves.toEqual({ type: "Aborted", requestId: 1 });
    expect(player.resetForSeek).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("aborts a late-target waiter when its timeout expires", async () => {
    jest.useFakeTimers();
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 30,
      frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
    });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(30);
    await expect(resultPromise).resolves.toEqual({ type: "Timeout", requestId: 1 });

    const awaitTargetPromise = service.awaitTargetFrame({ requestId: 1, timeoutMs: 100 });
    await jest.advanceTimersByTimeAsync(100);

    await expect(awaitTargetPromise).resolves.toEqual({ type: "Aborted", requestId: 1 });
    expect(mockVideoPlayers[0]!.resetForSeek).not.toHaveBeenCalled();
  });

  it("does not return a decoded target until the decoder queue drains", async () => {
    let resolveDrain: (() => void) | undefined;
    mockQueueFramesImpl = async () => {
      await new Promise<void>((resolve) => {
        resolveDrain = resolve;
      });
    };

    let settled = false;
    const resultPromise = service
      .decodeVideoFrames({
        requestId: 1,
        targetFrameTimeoutMs: 30,
        frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await flushPromises();

    emitLastQueuedFrame(mockVideoPlayers[0]!);
    await flushPromises();
    expect(settled).toBe(false);

    resolveDrain?.();
    await expect(resultPromise).resolves.toMatchObject({ type: "TargetFrame" });
  });

  it("preserves a reordered target that arrives before an earlier frame", async () => {
    let resolveDrain: (() => void) | undefined;
    mockQueueFramesImpl = async () => {
      await new Promise<void>((resolve) => {
        resolveDrain = resolve;
      });
    };

    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 30,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 1n },
        { frame: h264Frame(2, "delta"), receiveTime: 2n },
      ],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    const targetFrame = emitQueuedFrame(player, 1);
    const earlierFrame = emitQueuedFrame(player, 0);
    expect((earlierFrame as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);

    resolveDrain?.();
    await expect(resultPromise).resolves.toMatchObject({
      type: "TargetFrame",
      frame: targetFrame,
      receiveTime: 2n,
    });
  });

  it("handles an asynchronous queueFrames rejection", async () => {
    mockQueueFramesImpl = async () => {
      throw new Error("decoder reset");
    };

    await expect(
      service.decodeVideoFrames({
        requestId: 1,
        targetFrameTimeoutMs: 30,
        frames: [{ frame: h264Frame(1, "key"), receiveTime: 1n }],
      }),
    ).resolves.toEqual({ type: "Aborted", requestId: 1 });
    await expect(service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 })).resolves.toEqual({
      type: "Aborted",
      requestId: 1,
    });
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("does not report a timeout when no frame can be submitted", async () => {
    await expect(
      service.decodeVideoFrames({
        requestId: 1,
        targetFrameTimeoutMs: 30,
        frames: [{ frame: h264Frame(1, "key", 0xff), receiveTime: 1n }],
      }),
    ).resolves.toEqual({ type: "Aborted", requestId: 1 });
    await expect(service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 })).resolves.toEqual({
      type: "Aborted",
      requestId: 1,
    });
    expect(mockVideoPlayers[0]?.queueFrames).not.toHaveBeenCalled();
  });

  it("returns FrameOutOfOrder when a replay batch contains decreasing original timestamps", async () => {
    const result = await service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [
        { frame: h264Frame(2, "key"), receiveTime: 20n },
        { frame: h264Frame(1, "delta"), receiveTime: 10n },
      ],
    });

    expect(result).toEqual({ type: "FrameOutOfOrder", requestId: 1 });
    expect(mockVideoPlayers[0]?.resetForSeek).toHaveBeenCalled();
  });

  it.each(["key", "delta"] as const)(
    "returns FrameOutOfOrder when a new %s batch starts before the previous batch",
    async (kind) => {
      const firstResultPromise = service.decodeVideoFrames({
        requestId: 1,
        targetFrameTimeoutMs: 1000,
        frames: [{ frame: h264Frame(2, "key"), receiveTime: 20n }],
      });
      await flushPromises();
      const player = mockVideoPlayers[0]!;
      emitLastQueuedFrame(player);
      await expect(firstResultPromise).resolves.toMatchObject({ type: "TargetFrame" });

      await expect(
        service.decodeVideoFrames({
          requestId: 2,
          targetFrameTimeoutMs: 1000,
          frames: [{ frame: h264Frame(1, kind), receiveTime: 10n }],
        }),
      ).resolves.toEqual({ type: "FrameOutOfOrder", requestId: 2 });
      expect(player.queueFrames).toHaveBeenCalledTimes(1);
      expect(player.resetForSeek).toHaveBeenCalledTimes(1);
    },
  );

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
    const intermediateFrame = emitQueuedFrameFromCall(player, 0, 0);
    await expect(resultPromise).resolves.toMatchObject({
      type: "IntermediateFrame",
      originalTimestamp: 1_000_000_000n,
      receiveTime: 10n,
    });
    expect(player.discardQueuedFramesExcept).toHaveBeenLastCalledWith(1_000_000);
    expect((intermediateFrame as unknown as { close: jest.Mock }).close).not.toHaveBeenCalled();

    const awaitPromise = service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 });
    const targetFrame = emitQueuedFrame(player, 1);
    await expect(awaitPromise).resolves.toMatchObject({
      type: "TargetFrame",
      originalTimestamp: 2_000_000_000n,
      receiveTime: 20n,
    });
    expect((targetFrame as unknown as { close: jest.Mock }).close).not.toHaveBeenCalled();
  });

  it("aborts an active exact replay batch and closes its late outputs on reset", async () => {
    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      anyFrameTimeoutMs: 1000,
      frames: [
        { frame: h264Frame(1, "key"), receiveTime: 10n },
        { frame: h264Frame(2, "delta"), receiveTime: 20n },
      ],
    });
    await flushPromises();

    const player = mockVideoPlayers[0]!;
    service.resetVideoDecoder();

    await expect(resultPromise).resolves.toMatchObject({ type: "Aborted", requestId: 1 });
    expect(player.resetForSeek).toHaveBeenCalled();
    const staleFrame = emitQueuedFrame(player, 0);
    expect((staleFrame as unknown as { close: jest.Mock }).close).toHaveBeenCalledTimes(1);
  });

  it("does not queue frames after reset interrupts decoder initialization", async () => {
    let resolveInit: (() => void) | undefined;
    mockInitImpl = async () => {
      await new Promise<void>((resolve) => {
        resolveInit = resolve;
      });
    };

    const resultPromise = service.decodeVideoFrames({
      requestId: 1,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(1, "key"), receiveTime: 10n }],
    });
    await flushPromises();
    const player = mockVideoPlayers[0]!;

    service.resetVideoDecoder();
    resolveInit?.();

    await expect(resultPromise).resolves.toEqual({ type: "Aborted", requestId: 1 });
    expect(player.queueFrames).not.toHaveBeenCalled();
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

    const awaitPromise = service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 });
    service.resetVideoDecoder();
    await expect(awaitPromise).resolves.toEqual({ type: "Aborted", requestId: 1 });
  });

  it("aborts the previous awaitTargetFrame when a new batch starts", async () => {
    const firstResultPromise = service.decodeVideoFrames({
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
    emitQueuedFrame(player, 0);
    await expect(firstResultPromise).resolves.toMatchObject({ type: "IntermediateFrame" });
    const awaitFirstTarget = service.awaitTargetFrame({ requestId: 1, timeoutMs: 10_000 });

    const secondResultPromise = service.decodeVideoFrames({
      requestId: 2,
      targetFrameTimeoutMs: 1000,
      frames: [{ frame: h264Frame(3, "key"), receiveTime: 30n }],
    });
    await expect(awaitFirstTarget).resolves.toEqual({ type: "Aborted", requestId: 1 });
    await flushPromises();

    emitLastQueuedFrame(player);
    await expect(secondResultPromise).resolves.toMatchObject({ type: "TargetFrame" });
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
