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
    this.timestamp = Number(init.timestamp);
  }
}

class MockVideoDecoder {
  public static readonly instances: MockVideoDecoder[] = [];
  public static isConfigSupported = jest.fn(async () => ({ supported: true }));

  public state: CodecState = "unconfigured";
  public decodeQueueSize = 0;
  public readonly chunks: MockEncodedVideoChunk[] = [];
  public configuredConfig: VideoDecoderConfig | undefined;
  readonly #eventTarget = new EventTarget();

  public constructor(private readonly init: VideoDecoderInit) {
    MockVideoDecoder.instances.push(this);
  }

  public configure(config: VideoDecoderConfig): void {
    this.configuredConfig = config;
    this.state = "configured";
  }

  public decode(chunk: MockEncodedVideoChunk): void {
    this.chunks.push(chunk);
    this.decodeQueueSize++;
  }

  public emitFrame(timestamp: number): MockVideoFrame {
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
    this.#eventTarget.dispatchEvent(new Event("dequeue"));
    const frame = new MockVideoFrame(timestamp);
    this.init.output(frame as unknown as VideoFrame);
    return frame;
  }

  public addEventListener(type: string, listener: EventListener): void {
    this.#eventTarget.addEventListener(type, listener);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.#eventTarget.removeEventListener(type, listener);
  }

  public reset(): void {
    this.state = "unconfigured";
  }

  public close(): void {
    this.state = "closed";
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

    player.queueFrames(
      [
        { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "key" },
        { data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "delta" },
      ],
      (frame) => decoded.push(frame),
    );

    expect(decoder.chunks.map((chunk) => chunk.timestamp)).toEqual([10, 20]);

    const keyFrame = decoder.emitFrame(10);
    const deltaFrame = decoder.emitFrame(20);

    expect(decoded).toEqual([
      { frame: keyFrame, metadata: "key" },
      { frame: deltaFrame, metadata: "delta" },
    ]);
    expect(player.bufferedFrameCount()).toBe(0);
    expect(player.getLatestFrame()).toBeUndefined();
  });

  it("reports decoder queue size and resolves when it drops below the requested threshold", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;

    player.queueFrames(
      [
        { data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "key" },
        { data: new Uint8Array([2]), timestampMicros: 20, type: "delta", metadata: "delta" },
      ],
      () => {},
    );

    expect(player.decodeQueueSize()).toBe(2);

    let resolved = false;
    const waitPromise = player.waitForDecodeQueueBelow(2).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    decoder.emitFrame(10);
    await waitPromise;
    expect(resolved).toBe(true);
    expect(player.decodeQueueSize()).toBe(1);
  });

  it("closes queued frames that arrive after reset", async () => {
    const player = new VideoPlayer();
    await player.init({ codec: "avc1.640028" });
    const decoder = MockVideoDecoder.instances[0]!;
    const decoded = jest.fn();

    player.queueFrames(
      [{ data: new Uint8Array([1]), timestampMicros: 10, type: "key", metadata: "stale" }],
      decoded,
    );
    player.resetForSeek();

    const staleFrame = decoder.emitFrame(10);

    expect(decoded).not.toHaveBeenCalled();
    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(player.bufferedFrameCount()).toBe(0);
  });
});
