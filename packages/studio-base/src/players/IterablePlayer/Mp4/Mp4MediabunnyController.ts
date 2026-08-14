// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { CustomSource, EncodedPacketSink, Input, MP4, VideoSampleSink } from "mediabunny";
import type { EncodedPacket, VideoSample } from "mediabunny";

import { toNanoSec, type Time } from "@foxglove/rostime";

import {
  REMOTE_MP4_CACHE_SIZE_IN_BYTES,
  createMediabunnyMp4SourceOptions,
} from "./MediabunnyMp4Source";
import { RemoteMp4Readable } from "./RemoteMp4Readable";
import type { RemoteVideoFrameProvider } from "./RemoteVideoFrameRegistry";

const MAX_SEQUENTIAL_FRAME_GAP_NS = 2_000_000_000n;

export type Mp4FrameIndexEntry = {
  timestampNs: bigint;
  durationNs: bigint;
};

export type Mp4MediabunnyInfo = {
  codec: string;
  codecFamily: "avc" | "hevc";
  width: number;
  height: number;
  rotation: number;
  startTimestampSeconds: number;
  durationSeconds: number;
  endTimeNs: bigint;
  frames: readonly Mp4FrameIndexEntry[];
};

type DecodedFrame = {
  frame: VideoFrame;
  timestampNs: bigint;
  durationNs: bigint;
};

type PendingFrameRequest = {
  timestampNs: bigint;
  resolve: (frame: VideoFrame) => void;
  reject: (error: unknown) => void;
};

function secondsToNanoseconds(seconds: number): bigint {
  if (!Number.isFinite(seconds)) {
    throw new Error(`Invalid MP4 timestamp: ${seconds}`);
  }
  return BigInt(Math.round(seconds * 1e9));
}

function decodedFrameFromSample(sample: VideoSample, timelineStartTimestamp: number): DecodedFrame {
  return {
    frame: sample.toVideoFrame(),
    timestampNs: secondsToNanoseconds(sample.timestamp - timelineStartTimestamp),
    durationNs: secondsToNanoseconds(sample.duration),
  };
}

/**
 * Range-backed MP4 index and frame provider. Mediabunny owns random-access-point selection,
 * decode-order submission, presentation-order output, B-frame reordering, and VFR timestamps.
 */
export class Mp4MediabunnyController implements RemoteVideoFrameProvider {
  readonly #readable: RemoteMp4Readable;
  #input?: Input;
  #sink?: VideoSampleSink;
  #info?: Mp4MediabunnyInfo;
  #timelineStartTimestamp = 0;
  #cachedFrame?: DecodedFrame;
  #frameIterator?: AsyncGenerator<VideoSample>;
  #pendingFrameRequests: PendingFrameRequest[] = [];
  #processingFrameRequests?: Promise<void>;
  #disposed = false;

  public constructor(url: string) {
    this.#readable = new RemoteMp4Readable(url, {
      cacheSizeInBytes: REMOTE_MP4_CACHE_SIZE_IN_BYTES,
    });
  }

  public async initialize(): Promise<Mp4MediabunnyInfo> {
    if (this.#info) {
      return this.#info;
    }
    if (this.#disposed) {
      throw new Error("The remote MP4 decoder has been disposed");
    }

    const source = new CustomSource(createMediabunnyMp4SourceOptions(this.#readable));
    const input = new Input({ source, formats: [MP4] });
    this.#input = input;

    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        throw new Error("The MP4 does not contain a video track");
      }

      const [decoderConfig, codecFamily] = await Promise.all([
        track.getDecoderConfig(),
        track.getCodec(),
      ]);
      if (!decoderConfig || (codecFamily !== "avc" && codecFamily !== "hevc")) {
        throw new Error("Only H.264 and H.265 MP4 video tracks are supported");
      }
      if (!(await track.canDecode())) {
        throw new Error(
          `This browser's WebCodecs implementation cannot decode ${decoderConfig.codec}`,
        );
      }

      const [firstTimestamp, metadataDuration, width, height, rotation] = await Promise.all([
        track.getFirstTimestamp(),
        track.getDurationFromMetadata(),
        track.getDisplayWidth(),
        track.getDisplayHeight(),
        track.getRotation(),
      ]);
      const timelineStartTimestamp = Math.max(0, firstTimestamp);
      const packetSink = new EncodedPacketSink(track);
      const packets: EncodedPacket[] = [];
      for await (const packet of packetSink.packets(undefined, undefined, {
        metadataOnly: true,
      })) {
        if (packet.timestamp + packet.duration >= timelineStartTimestamp) {
          packets.push(packet);
        }
      }
      if (packets.length === 0) {
        throw new Error("The MP4 video track contains no frames");
      }

      const frames = packets
        .map((packet) => ({
          timestampNs: secondsToNanoseconds(packet.timestamp - timelineStartTimestamp),
          durationNs: secondsToNanoseconds(packet.duration),
          sequenceNumber: packet.sequenceNumber,
        }))
        .filter((frame) => frame.timestampNs + frame.durationNs > 0n)
        .sort((left, right) => {
          if (left.timestampNs !== right.timestampNs) {
            return left.timestampNs < right.timestampNs ? -1 : 1;
          }
          return left.sequenceNumber - right.sequenceNumber;
        })
        // Pre-roll samples (edit-list trims) can start before the timeline while remaining visible
        // at the start. Clamp them to 0 so backfill never emits negative receive times, which
        // getFrame() would reject as outside the timeline.
        .map(({ timestampNs, durationNs }) =>
          timestampNs < 0n
            ? { timestampNs: 0n, durationNs: timestampNs + durationNs }
            : { timestampNs, durationNs },
        );

      const lastFrame = frames[frames.length - 1]!;
      const frameEndNs = lastFrame.timestampNs + lastFrame.durationNs;
      const metadataEndNs =
        metadataDuration == undefined
          ? 0n
          : secondsToNanoseconds(metadataDuration - timelineStartTimestamp);
      const endTimeNs = frameEndNs > metadataEndNs ? frameEndNs : metadataEndNs;
      if (endTimeNs <= 0n) {
        throw new Error(`The MP4 has an invalid video duration: ${metadataDuration}`);
      }

      this.#timelineStartTimestamp = timelineStartTimestamp;
      this.#sink = new VideoSampleSink(track);
      this.#info = {
        codec: decoderConfig.codec,
        codecFamily,
        width,
        height,
        rotation,
        startTimestampSeconds: timelineStartTimestamp,
        durationSeconds: Number(endTimeNs) / 1e9,
        endTimeNs,
        frames,
      };
      return this.#info;
    } catch (error) {
      input.dispose();
      this.#input = undefined;
      throw error;
    }
  }

  public async getFrame(timestamp: Time): Promise<VideoFrame> {
    if (this.#disposed) {
      throw new Error("The remote MP4 decoder has been disposed");
    }
    const timestampNs = toNanoSec(timestamp);
    return await new Promise<VideoFrame>((resolve, reject) => {
      this.#pendingFrameRequests.push({ timestampNs, resolve, reject });
      this.#startProcessingFrameRequests();
    });
  }

  public async dispose(): Promise<void> {
    this.#disposed = true;
    const error = new Error("The remote MP4 decoder has been disposed");
    for (const request of this.#pendingFrameRequests.splice(0)) {
      request.reject(error);
    }
    // Dispose the input before waiting on frame work: Mediabunny cancels in-flight reads and sink
    // operations on dispose, so a frame request blocked on a slow range request cannot stall
    // teardown until the network settles.
    this.#input?.dispose();
    this.#input = undefined;
    await this.#processingFrameRequests;
    await this.#stopFrameIterator();
    this.#cachedFrame?.frame.close();
    this.#cachedFrame = undefined;
    this.#sink = undefined;
    this.#info = undefined;
  }

  async #getFrameInternal(timestampNs: bigint): Promise<VideoFrame> {
    if (this.#disposed) {
      throw new Error("The remote MP4 decoder has been disposed");
    }
    const info = await this.initialize();
    if (timestampNs < 0n || timestampNs > info.endTimeNs) {
      throw new Error(`MP4 frame time ${timestampNs}ns is outside the video timeline`);
    }

    const cached = this.#cachedFrame;
    if (
      cached &&
      timestampNs >= cached.timestampNs &&
      timestampNs < cached.timestampNs + cached.durationNs
    ) {
      return cached.frame.clone();
    }

    const canContinueSequentially =
      cached != undefined &&
      timestampNs > cached.timestampNs &&
      timestampNs - cached.timestampNs <= MAX_SEQUENTIAL_FRAME_GAP_NS;
    if (canContinueSequentially && this.#frameIterator) {
      while (this.#cachedFrame!.timestampNs < timestampNs) {
        const result = await this.#frameIterator.next();
        if (result.done === true) {
          break;
        }
        const decoded = decodedFrameFromSample(result.value, this.#timelineStartTimestamp);
        result.value.close();
        if (decoded.timestampNs <= this.#cachedFrame!.timestampNs) {
          decoded.frame.close();
          continue;
        }
        this.#replaceCachedFrame(decoded);
      }
      const sequentialFrame = this.#cachedFrame;
      if (
        sequentialFrame &&
        timestampNs >= sequentialFrame.timestampNs &&
        timestampNs < sequentialFrame.timestampNs + sequentialFrame.durationNs
      ) {
        return sequentialFrame.frame.clone();
      }
    }

    await this.#stopFrameIterator();
    const sample = await this.#requireSink().getSample(
      this.#timelineStartTimestamp + Number(timestampNs) / 1e9,
    );
    if (!sample) {
      throw new Error(`No decoded MP4 frame is available at ${timestampNs}ns`);
    }
    try {
      this.#replaceCachedFrame(decodedFrameFromSample(sample, this.#timelineStartTimestamp));
    } finally {
      sample.close();
    }

    const frame = this.#cachedFrame!;
    this.#frameIterator = this.#requireSink().samples(
      this.#timelineStartTimestamp + Number(frame.timestampNs) / 1e9,
      this.#timelineStartTimestamp + info.durationSeconds,
    );
    return frame.frame.clone();
  }

  #replaceCachedFrame(frame: DecodedFrame): void {
    this.#cachedFrame?.frame.close();
    this.#cachedFrame = frame;
  }

  #startProcessingFrameRequests(): void {
    this.#processingFrameRequests ??= this.#processFrameRequests().finally(() => {
      this.#processingFrameRequests = undefined;
      if (!this.#disposed && this.#pendingFrameRequests.length > 0) {
        this.#startProcessingFrameRequests();
      }
    });
  }

  async #processFrameRequests(): Promise<void> {
    while (!this.#disposed && this.#pendingFrameRequests.length > 0) {
      // Requests from different renderables can be pending at the same time, and each can still be
      // current for its own consumer. Only coalesce requests for the exact same presentation time.
      const requestsByTimestamp = new Map<bigint, PendingFrameRequest[]>();
      for (const request of this.#pendingFrameRequests.splice(0)) {
        const requests = requestsByTimestamp.get(request.timestampNs);
        if (requests) {
          requests.push(request);
        } else {
          requestsByTimestamp.set(request.timestampNs, [request]);
        }
      }

      for (const [timestampNs, requests] of requestsByTimestamp) {
        try {
          const frame = await this.#getFrameInternal(timestampNs);
          for (let index = 0; index < requests.length; index++) {
            requests[index]!.resolve(index === requests.length - 1 ? frame : frame.clone());
          }
        } catch (error) {
          for (const request of requests) {
            request.reject(error);
          }
        }
      }
    }
  }

  async #stopFrameIterator(): Promise<void> {
    const iterator = this.#frameIterator;
    this.#frameIterator = undefined;
    try {
      await iterator?.return(undefined);
    } catch {
      // The iterator may reject while tearing down a disposed input; stopping must not throw.
    }
  }

  #requireSink(): VideoSampleSink {
    if (!this.#sink) {
      throw new Error("The remote MP4 decoder is not initialized");
    }
    return this.#sink;
  }
}
