// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { VideoPlayer } from "./VideoPlayer";

class MockVideoFrame {
  public readonly close = jest.fn();
  public readonly codedWidth = 640;
  public readonly codedHeight = 480;

  public constructor(public readonly timestamp: number) {}
}

class MockEncodedVideoChunk {
  public readonly timestamp: number;

  public constructor(init: EncodedVideoChunkInit) {
    this.timestamp = init.timestamp;
  }
}

class MockVideoDecoder {
  public static readonly instances: MockVideoDecoder[] = [];
  public static isConfigSupported = jest.fn<Promise<VideoDecoderSupport>, [VideoDecoderConfig]>(
    async (config) => ({ supported: true, config }),
  );

  public state: CodecState = "unconfigured";
  public decodeQueueSize = 0;
  public readonly chunks: MockEncodedVideoChunk[] = [];
  public configuredConfig: VideoDecoderConfig | undefined;
  public decodeError: Error | undefined;
  public decodeErrorOnCall: number | undefined;
  public decodeCallCount = 0;
  public configureCount = 0;
  public resetCount = 0;
  readonly #eventTarget = new EventTarget();

  public constructor(private readonly init: VideoDecoderInit) {
    MockVideoDecoder.instances.push(this);
  }

  public configure(config: VideoDecoderConfig): void {
    this.configureCount++;
    this.configuredConfig = config;
    this.state = "configured";
  }

  public decode(chunk: MockEncodedVideoChunk): void {
    const callIndex = this.decodeCallCount++;
    if (
      this.decodeError != undefined &&
      (this.decodeErrorOnCall == undefined || this.decodeErrorOnCall === callIndex)
    ) {
      throw this.decodeError;
    }
    this.chunks.push(chunk);
    this.decodeQueueSize++;
  }

  public emitError(error: DOMException): void {
    this.state = "closed";
    this.decodeQueueSize = 0;
    this.init.error(error);
  }

  public emitFrame(timestamp: number): MockVideoFrame {
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
    this.#eventTarget.dispatchEvent(new Event("dequeue"));
    return this.emitOutput(timestamp);
  }

  public emitOutput(timestamp: number): MockVideoFrame {
    const frame = new MockVideoFrame(timestamp);
    this.init.output(frame as unknown as VideoFrame);
    return frame;
  }

  public consumeWithoutOutput(): void {
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
    this.#eventTarget.dispatchEvent(new Event("dequeue"));
  }

  public addEventListener(type: string, listener: EventListener): void {
    this.#eventTarget.addEventListener(type, listener);
    if (type === "dequeue") {
      this.#dequeueListeners.add(listener);
    }
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.#eventTarget.removeEventListener(type, listener);
    if (type === "dequeue") {
      this.#dequeueListeners.delete(listener);
    }
  }

  public dequeueListenerCount(): number {
    return this.#dequeueListeners.size;
  }

  readonly #dequeueListeners = new Set<EventListener>();

  public reset(): void {
    this.resetCount++;
    this.state = "unconfigured";
    this.decodeQueueSize = 0;
  }

  public close(): void {
    this.state = "closed";
    this.decodeQueueSize = 0;
  }
}

describe("VideoPlayer", () => {
  let originalVideoDecoder: unknown;
  let originalEncodedVideoChunk: unknown;

  beforeAll(() => {
    const globals = globalThis as unknown as {
      VideoDecoder?: unknown;
      EncodedVideoChunk?: unknown;
    };
    originalVideoDecoder = globals.VideoDecoder;
    originalEncodedVideoChunk = globals.EncodedVideoChunk;
    globals.VideoDecoder = MockVideoDecoder;
    globals.EncodedVideoChunk = MockEncodedVideoChunk;
  });

  afterAll(() => {
    const globals = globalThis as unknown as {
      VideoDecoder?: unknown;
      EncodedVideoChunk?: unknown;
    };
    globals.VideoDecoder = originalVideoDecoder;
    globals.EncodedVideoChunk = originalEncodedVideoChunk;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    MockVideoDecoder.instances.length = 0;
    MockVideoDecoder.isConfigSupported.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("configures the decoder with the supported hardware acceleration preference", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });

    const decoder = MockVideoDecoder.instances[0];
    if (decoder == undefined) {
      throw new Error("Expected a VideoDecoder instance");
    }

    expect(MockVideoDecoder.isConfigSupported).toHaveBeenCalledWith({
      codec: "avc1.640028",
      optimizeForLatency: true,
      hardwareAcceleration: "prefer-hardware",
    });
    expect(decoder.configuredConfig).toEqual({
      codec: "avc1.640028",
      optimizeForLatency: true,
      hardwareAcceleration: "prefer-hardware",
    });
  });

  it("does not configure a decoder when reset interrupts initialization", async () => {
    let resolveSupport: ((result: VideoDecoderSupport) => void) | undefined;
    MockVideoDecoder.isConfigSupported.mockImplementationOnce(
      async () =>
        await new Promise<VideoDecoderSupport>((resolve) => {
          resolveSupport = resolve;
        }),
    );
    const player = new VideoPlayer();

    const initPromise = player.init({ codec: "avc1.640028" });
    await Promise.resolve();
    player.resetForSeek();
    resolveSupport?.({ supported: true, config: { codec: "avc1.640028" } });
    await initPromise;

    expect(player.isInitialized()).toBe(false);
  });

  it("resolves decodeAndWaitForFrame with the frame matching the submitted timestamp", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;

    const framePromise = player.decodeAndWaitForFrame(new Uint8Array([1]), 2.9, "key");
    const earlierFrame = decoder.emitFrame(1);
    const targetFrame = decoder.emitFrame(2);

    await expect(framePromise).resolves.toBe(targetFrame);
    expect(earlierFrame.close).not.toHaveBeenCalled();
  });

  it("closes a frame emitted after its exact-timestamp waiter timed out", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;

    const framePromise = player.decodeAndWaitForFrame(new Uint8Array([1]), 10, "key", 1);
    jest.advanceTimersByTime(1);
    await expect(framePromise).resolves.toBeUndefined();

    const lateFrame = decoder.emitFrame(10);
    expect(lateFrame.close).toHaveBeenCalledTimes(1);
    expect(player.bufferedFrameCount()).toBe(0);
  });

  it("queues a batch and returns decoded frames with their metadata without buffering them", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const decoded: Array<{ frame: VideoFrame; metadata: string }> = [];

    const queuePromise = player.queueFrames(
      [
        { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "key" },
        { data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "delta" },
      ],
      (frame) => decoded.push(frame),
    );

    expect(decoder.chunks.map((chunk) => chunk.timestamp)).toEqual([10, 20]);

    const keyFrame = decoder.emitFrame(10);
    const deltaFrame = decoder.emitFrame(20);
    await queuePromise;

    expect(decoded).toEqual([
      { frame: keyFrame, metadata: "key" },
      { frame: deltaFrame, metadata: "delta" },
    ]);
    expect(player.bufferedFrameCount()).toBe(0);
    expect(player.getLatestFrame()).toBeUndefined();
  });

  it("reports decoder queue size as frames are decoded", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;

    const queuePromise = player.queueFrames(
      [
        { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "key" },
        { data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "delta" },
      ],
      () => {},
    );

    expect(player.decodeQueueSize()).toBe(2);

    decoder.emitFrame(10);
    expect(player.decodeQueueSize()).toBe(1);

    decoder.emitFrame(20);
    await queuePromise;
  });

  it("waits for the decoder queue to drain before resolving a queued batch", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const settled = jest.fn();

    const queuePromise = player
      .queueFrames(
        [
          { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "key" },
          { data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "delta" },
        ],
        () => {},
      )
      .then(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(decoder.dequeueListenerCount()).toBe(1);

    decoder.emitFrame(10);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    decoder.emitFrame(20);
    await queuePromise;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(decoder.dequeueListenerCount()).toBe(0);
  });

  it("drops queued callbacks except for the one retained late target", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const decoded = jest.fn();

    const queuePromise = player.queueFrames(
      [
        { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "old" },
        { data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "target" },
      ],
      decoded,
    );
    decoder.consumeWithoutOutput();
    decoder.consumeWithoutOutput();
    await queuePromise;

    player.discardQueuedFramesExcept(20);
    const discardedFrame = decoder.emitOutput(10);
    const targetFrame = decoder.emitOutput(20);

    expect(discardedFrame.close).toHaveBeenCalledTimes(1);
    expect(decoded).toHaveBeenCalledTimes(1);
    expect(decoded).toHaveBeenCalledWith({ frame: targetFrame, metadata: "target" });
  });

  it("rejects a second queued batch until the current decoder queue drains", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;

    const firstBatch = player.queueFrames(
      [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "first" }],
      () => {},
    );
    await expect(
      player.queueFrames(
        [{ data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "second" }],
        () => {},
      ),
    ).rejects.toThrow("Cannot queue a new video batch while the previous batch is decoding");

    decoder.emitFrame(10);
    await firstBatch;
    const secondBatch = player.queueFrames(
      [{ data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "second" }],
      () => {},
    );
    decoder.emitFrame(20);
    await expect(secondBatch).resolves.toBeUndefined();
  });

  it("rejects a queued batch when decode throws synchronously", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    decoder.decodeError = new Error("bad chunk");

    await expect(
      player.queueFrames(
        [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "bad" }],
        () => {},
      ),
    ).rejects.toThrow("bad chunk");
    expect(decoder.dequeueListenerCount()).toBe(0);
  });

  it("resets a partially queued batch after a synchronous decode error and waits for a new keyframe", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const staleDecoded = jest.fn();
    decoder.decodeError = new Error("bad delta");
    decoder.decodeErrorOnCall = 1;

    await expect(
      player.queueFrames(
        [
          { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "stale-key" },
          {
            data: new Uint8Array([2]),
            timestampMicros: 20,
            type: "delta",
            metadata: "bad-delta",
          },
        ],
        staleDecoded,
      ),
    ).rejects.toThrow("bad delta");

    expect(decoder.resetCount).toBe(1);
    expect(decoder.configureCount).toBe(2);
    expect(decoder.decodeQueueSize).toBe(0);
    const staleFrame = decoder.emitOutput(10);
    expect(staleDecoded).not.toHaveBeenCalled();
    expect(staleFrame.close).toHaveBeenCalledTimes(1);

    decoder.decodeError = undefined;
    await expect(
      player.queueFrames(
        [{ data: new Uint8Array([3]), timestampMicros: 30, type: "delta", metadata: "delta" }],
        () => {},
      ),
    ).rejects.toThrow("No video frames were submitted to the decoder");
    expect(decoder.chunks.map((chunk) => chunk.timestamp)).toEqual([10]);

    const recoveredDecoded = jest.fn();
    const recoveredBatch = player.queueFrames(
      [{ data: new Uint8Array([4]), timestampMicros: 40, type: "key", metadata: "recovered" }],
      recoveredDecoded,
    );
    const recoveredFrame = decoder.emitFrame(40);
    await expect(recoveredBatch).resolves.toBeUndefined();
    expect(recoveredDecoded).toHaveBeenCalledWith({
      frame: recoveredFrame,
      metadata: "recovered",
    });
  });

  it("rejects a queued batch and removes its listener when the decoder reports an error", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const decoded = jest.fn();
    const queuePromise = player.queueFrames(
      [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "bad" }],
      decoded,
    );
    expect(decoder.dequeueListenerCount()).toBe(1);

    decoder.emitError(new DOMException("decoder failed", "EncodingError"));

    await expect(queuePromise).rejects.toThrow("decoder failed");
    expect(decoder.dequeueListenerCount()).toBe(0);
    const lateFrame = decoder.emitOutput(10);
    expect(decoded).not.toHaveBeenCalled();
    expect(lateFrame.close).toHaveBeenCalledTimes(1);

    const replacementDecoder = MockVideoDecoder.instances[1]!;
    expect(replacementDecoder.state).toBe("configured");
    await expect(
      player.queueFrames(
        [{ data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "delta" }],
        () => {},
      ),
    ).rejects.toThrow("No video frames were submitted to the decoder");
    expect(replacementDecoder.chunks).toHaveLength(0);

    const recoveredDecoded = jest.fn();
    const recoveredBatch = player.queueFrames(
      [{ data: new Uint8Array([3]), timestampMicros: 30, type: "key", metadata: "recovered" }],
      recoveredDecoded,
    );
    const recoveredFrame = replacementDecoder.emitFrame(30);
    await expect(recoveredBatch).resolves.toBeUndefined();
    expect(recoveredDecoded).toHaveBeenCalledWith({
      frame: recoveredFrame,
      metadata: "recovered",
    });
  });

  it("invalidates queued callbacks when an EncodingError arrives after queue drain", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const decoded = jest.fn();

    const queuePromise = player.queueFrames(
      [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "target" }],
      decoded,
    );
    decoder.consumeWithoutOutput();
    await expect(queuePromise).resolves.toBeUndefined();

    decoder.emitError(new DOMException("decoder failed", "EncodingError"));
    const impossibleLateFrame = decoder.emitOutput(10);

    expect(decoded).not.toHaveBeenCalled();
    expect(impossibleLateFrame.close).toHaveBeenCalledTimes(1);
  });

  it("closes queued frames that arrive after reset", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const decoded = jest.fn();

    const queuePromise = player.queueFrames(
      [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "stale" }],
      decoded,
    );
    expect(decoder.dequeueListenerCount()).toBe(1);
    player.resetForSeek();
    await queuePromise;

    const staleFrame = decoder.emitFrame(10);

    expect(decoder.dequeueListenerCount()).toBe(0);
    expect(decoded).not.toHaveBeenCalled();
    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(player.bufferedFrameCount()).toBe(0);
  });

  it("settles a queued batch and removes its dequeue listener when closed", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;

    const queuePromise = player.queueFrames(
      [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "pending" }],
      () => {},
    );
    expect(decoder.dequeueListenerCount()).toBe(1);

    player.close();

    await queuePromise;
    expect(decoder.dequeueListenerCount()).toBe(0);
  });
});
