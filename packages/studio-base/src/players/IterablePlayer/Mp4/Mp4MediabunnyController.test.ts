// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { EncodedPacketSink, Input, VideoSampleSink } from "mediabunny";
import type { EncodedPacket, VideoSample } from "mediabunny";

import { fromNanoSec } from "@foxglove/rostime";

import { Mp4MediabunnyController } from "./Mp4MediabunnyController";

jest.mock("mediabunny", () => ({
  CustomSource: jest.fn(),
  EncodedPacketSink: jest.fn(),
  Input: jest.fn(),
  MP4: {},
  VideoSampleSink: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function videoFrameAt(timestampSeconds: number): VideoFrame {
  return {
    close: jest.fn(),
    clone: jest.fn(() => videoFrameAt(timestampSeconds)),
    timestampSeconds,
  } as unknown as VideoFrame;
}

function videoSampleAt(timestampSeconds: number): VideoSample {
  return {
    close: jest.fn(),
    duration: 0.25,
    timestamp: timestampSeconds,
    toVideoFrame: jest.fn(() => videoFrameAt(timestampSeconds)),
  } as unknown as VideoSample;
}

async function* packets(): AsyncGenerator<EncodedPacket> {
  yield {
    duration: 10,
    sequenceNumber: 0,
    timestamp: 0,
  } as EncodedPacket;
}

async function* noSamples(samples: VideoSample[]): AsyncGenerator<VideoSample> {
  for (const sample of samples) {
    yield sample;
  }
}

function frameTimestamp(frame: VideoFrame): number {
  return (frame as unknown as { timestampSeconds: number }).timestampSeconds;
}

describe("Mp4MediabunnyController", () => {
  it("resolves concurrent renderable requests at their own timestamps", async () => {
    const firstSample = deferred<VideoSample>();
    const firstSampleRequested = deferred<void>();
    const getSample = jest
      .fn<Promise<VideoSample>, [number]>()
      .mockImplementation(async (timestampSeconds) => {
        if (timestampSeconds === 1) {
          firstSampleRequested.resolve();
          return await firstSample.promise;
        }
        return videoSampleAt(timestampSeconds);
      });
    const track = {
      canDecode: jest.fn(async () => true),
      getCodec: jest.fn(async () => "avc"),
      getDecoderConfig: jest.fn(async () => ({ codec: "avc1.640028" })),
      getDisplayHeight: jest.fn(async () => 1080),
      getDisplayWidth: jest.fn(async () => 1920),
      getDurationFromMetadata: jest.fn(async () => 10),
      getFirstTimestamp: jest.fn(async () => 0),
      getRotation: jest.fn(async () => 0),
    };

    (Input as jest.Mock).mockImplementation(() => ({
      dispose: jest.fn(),
      getPrimaryVideoTrack: jest.fn(async () => track),
    }));
    (EncodedPacketSink as jest.Mock).mockImplementation(() => ({ packets }));
    (VideoSampleSink as jest.Mock).mockImplementation(() => ({
      getSample,
      samples: jest.fn(() => noSamples([])),
    }));

    const controller = new Mp4MediabunnyController("https://example.com/video.mp4");
    const frameAtOne = controller.getFrame(fromNanoSec(1_000_000_000n));
    await firstSampleRequested.promise;

    const firstFrameAtFour = controller.getFrame(fromNanoSec(4_000_000_000n));
    const frameAtEight = controller.getFrame(fromNanoSec(8_000_000_000n));
    const secondFrameAtFour = controller.getFrame(fromNanoSec(4_000_000_000n));
    firstSample.resolve(videoSampleAt(1));

    const frames = await Promise.all([
      frameAtOne,
      firstFrameAtFour,
      frameAtEight,
      secondFrameAtFour,
    ]);
    expect(frames.map(frameTimestamp)).toEqual([1, 4, 8, 4]);
    expect(getSample.mock.calls.map(([timestampSeconds]) => timestampSeconds)).toEqual([1, 4, 8]);

    await controller.dispose();
  });

  it("disposes promptly while a frame request is blocked on a slow range read", async () => {
    const sampleRequested = deferred<void>();
    let rejectSample!: (error: Error) => void;
    const blockedSample = new Promise<VideoSample>((_resolve, reject) => {
      rejectSample = reject;
    });
    const getSample = jest.fn(async () => {
      sampleRequested.resolve();
      return await blockedSample;
    });
    const track = {
      canDecode: jest.fn(async () => true),
      getCodec: jest.fn(async () => "avc"),
      getDecoderConfig: jest.fn(async () => ({ codec: "avc1.640028" })),
      getDisplayHeight: jest.fn(async () => 1080),
      getDisplayWidth: jest.fn(async () => 1920),
      getDurationFromMetadata: jest.fn(async () => 10),
      getFirstTimestamp: jest.fn(async () => 0),
      getRotation: jest.fn(async () => 0),
    };
    // Mirror Mediabunny semantics: disposing the input cancels in-flight sink operations.
    const inputDispose = jest.fn(() => {
      rejectSample(new Error("Input disposed"));
    });

    (Input as jest.Mock).mockImplementation(() => ({
      dispose: inputDispose,
      getPrimaryVideoTrack: jest.fn(async () => track),
    }));
    (EncodedPacketSink as jest.Mock).mockImplementation(() => ({ packets }));
    (VideoSampleSink as jest.Mock).mockImplementation(() => ({
      getSample,
      samples: jest.fn(() => noSamples([])),
    }));

    const controller = new Mp4MediabunnyController("https://example.com/video.mp4");
    const blockedFrame = controller.getFrame(fromNanoSec(1_000_000_000n));
    await sampleRequested.promise;

    // Without disposing the input first, this would wait for the blocked range read to settle.
    await controller.dispose();
    expect(inputDispose).toHaveBeenCalled();
    await expect(blockedFrame).rejects.toThrow("Input disposed");
  });

  it("clamps pre-roll frames to the timeline start", async () => {
    async function* preRollPackets(): AsyncGenerator<EncodedPacket> {
      yield { duration: 0.04, sequenceNumber: 0, timestamp: -0.02 } as EncodedPacket;
      yield { duration: 0.04, sequenceNumber: 1, timestamp: 0.02 } as EncodedPacket;
      // Ends exactly at the timeline start, so it is never visible.
      yield { duration: 0.01, sequenceNumber: 2, timestamp: -0.01 } as EncodedPacket;
    }
    const track = {
      canDecode: jest.fn(async () => true),
      getCodec: jest.fn(async () => "avc"),
      getDecoderConfig: jest.fn(async () => ({ codec: "avc1.640028" })),
      getDisplayHeight: jest.fn(async () => 1080),
      getDisplayWidth: jest.fn(async () => 1920),
      getDurationFromMetadata: jest.fn(async () => 10),
      getFirstTimestamp: jest.fn(async () => -0.02),
      getRotation: jest.fn(async () => 0),
    };

    (Input as jest.Mock).mockImplementation(() => ({
      dispose: jest.fn(),
      getPrimaryVideoTrack: jest.fn(async () => track),
    }));
    (EncodedPacketSink as jest.Mock).mockImplementation(() => ({ packets: preRollPackets }));
    (VideoSampleSink as jest.Mock).mockImplementation(() => ({
      getSample: jest.fn(),
      samples: jest.fn(() => noSamples([])),
    }));

    const controller = new Mp4MediabunnyController("https://example.com/video.mp4");
    const info = await controller.initialize();
    expect(info.frames).toEqual([
      { timestampNs: 0n, durationNs: 20_000_000n },
      { timestampNs: 20_000_000n, durationNs: 40_000_000n },
    ]);

    await controller.dispose();
  });
});
