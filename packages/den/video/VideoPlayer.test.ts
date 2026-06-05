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
  public readonly chunks: MockEncodedVideoChunk[] = [];

  public constructor(private readonly init: VideoDecoderInit) {
    MockVideoDecoder.instances.push(this);
  }

  public configure(_config: VideoDecoderConfig): void {
    this.state = "configured";
  }

  public decode(chunk: MockEncodedVideoChunk): void {
    this.chunks.push(chunk);
  }

  public emitFrame(timestamp: number): MockVideoFrame {
    const frame = new MockVideoFrame(timestamp);
    this.init.output(frame as unknown as VideoFrame);
    return frame;
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
});
