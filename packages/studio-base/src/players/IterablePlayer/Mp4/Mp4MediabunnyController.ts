// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { CustomSource, Input, MP4, VideoSampleSink } from "mediabunny";
import type { VideoSample } from "mediabunny";

import {
  REMOTE_MP4_CACHE_SIZE_IN_BYTES,
  createMediabunnyMp4SourceOptions,
} from "./MediabunnyMp4Source";
import type { Mp4SourceByteRange } from "./MediabunnyMp4Source";
import { RemoteMp4Readable } from "./RemoteMp4Readable";

const MAX_REPORTED_RANGES = 128;

type ReadSnapshot = {
  requestCount: number;
  requestedBytes: number;
};

export type Mp4MediabunnyReadSummary = {
  requestCount: number;
  requestedBytes: number;
  recentRanges: Mp4SourceByteRange[];
};

export type Mp4MediabunnyInfo = {
  codec: string;
  codecFamily: string;
  width: number;
  height: number;
  rotation: number;
  startTimestampSeconds: number;
  endTimestampSeconds: number;
  durationSeconds: number;
  initializationReads: Mp4MediabunnyReadSummary;
};

export type Mp4MediabunnyFrame = {
  frame: VideoFrame;
  requestedTimeSeconds?: number;
  presentationTimeSeconds: number;
  durationSeconds: number;
  width: number;
  height: number;
  rotation: number;
  reads: Mp4MediabunnyReadSummary;
};

/**
 * Development spike for range-backed MP4 demux and presentation-order WebCodecs decode. Mediabunny
 * owns sample indexing, random-access-point decode, B-frame reordering, and VFR timestamps; the
 * existing RemoteMp4Readable remains the only HTTP transport.
 */
export class Mp4MediabunnyController {
  readonly #readable: RemoteMp4Readable;
  #input?: Input;
  #sink?: VideoSampleSink;
  #info?: Mp4MediabunnyInfo;
  #timelineStartTimestamp = 0;
  #requestCount = 0;
  #requestedBytes = 0;
  #recentRanges: ({ sequence: number } & Mp4SourceByteRange)[] = [];

  public constructor(url: string) {
    this.#readable = new RemoteMp4Readable(url, {
      cacheSizeInBytes: REMOTE_MP4_CACHE_SIZE_IN_BYTES,
      onRangeFetch: (range) => {
        this.#recordRead(range);
      },
    });
  }

  public async initialize(): Promise<Mp4MediabunnyInfo> {
    if (this.#info) {
      return this.#info;
    }

    const readSnapshot = this.#snapshotReads();
    const source = new CustomSource(createMediabunnyMp4SourceOptions(this.#readable));
    const input = new Input({ source, formats: [MP4] });
    this.#input = input;

    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        throw new Error("The MP4 does not contain a video track");
      }

      const decoderConfig = await track.getDecoderConfig();
      const codecFamily = await track.getCodec();
      if (!decoderConfig || !codecFamily) {
        throw new Error("The MP4 video codec is not recognized");
      }
      if (!(await track.canDecode())) {
        throw new Error(
          `This browser's WebCodecs implementation cannot decode ${decoderConfig.codec}`,
        );
      }

      const [firstTimestamp, metadataEndTimestamp, width, height, rotation] = await Promise.all([
        track.getFirstTimestamp(),
        track.getDurationFromMetadata(),
        track.getDisplayWidth(),
        track.getDisplayHeight(),
        track.getRotation(),
      ]);
      const startTimestamp = Math.max(0, firstTimestamp);
      const endTimestamp = metadataEndTimestamp ?? (await track.computeDuration());
      if (!Number.isFinite(endTimestamp) || endTimestamp <= startTimestamp) {
        throw new Error(`The MP4 has an invalid video duration: ${endTimestamp}`);
      }

      this.#timelineStartTimestamp = startTimestamp;
      this.#sink = new VideoSampleSink(track);
      this.#info = {
        codec: decoderConfig.codec,
        codecFamily,
        width,
        height,
        rotation,
        startTimestampSeconds: startTimestamp,
        endTimestampSeconds: endTimestamp,
        durationSeconds: endTimestamp - startTimestamp,
        initializationReads: this.#readsSince(readSnapshot),
      };
      return this.#info;
    } catch (error) {
      input.dispose();
      this.#input = undefined;
      throw error;
    }
  }

  /** Returns the frame whose presentation interval contains the requested relative timeline time. */
  public async seekFrame(requestedTimeSeconds: number): Promise<Mp4MediabunnyFrame> {
    const info = await this.initialize();
    if (!Number.isFinite(requestedTimeSeconds)) {
      throw new Error(`Invalid MP4 seek time: ${requestedTimeSeconds}`);
    }

    const relativeTime = Math.max(0, Math.min(requestedTimeSeconds, info.durationSeconds));
    const readSnapshot = this.#snapshotReads();
    const sample = await this.#requireSink().getSample(this.#timelineStartTimestamp + relativeTime);
    if (!sample) {
      throw new Error(`No decoded video frame is available at ${requestedTimeSeconds}s`);
    }

    try {
      return {
        frame: sample.toVideoFrame(),
        requestedTimeSeconds,
        presentationTimeSeconds: sample.timestamp - this.#timelineStartTimestamp,
        durationSeconds: sample.duration,
        width: sample.displayWidth,
        height: sample.displayHeight,
        rotation: sample.rotation,
        reads: this.#readsSince(readSnapshot),
      };
    } finally {
      sample.close();
    }
  }

  /**
   * Decodes sequential frames in presentation order starting at a relative timeline time. Calling
   * `abort()` forwards cancellation immediately to Mediabunny's iterator.
   */
  public frames(startTimeSeconds: number, signal: AbortSignal): AsyncGenerator<Mp4MediabunnyFrame> {
    const info = this.#info;
    if (!info) {
      throw new Error("Mediabunny MP4 controller is not initialized");
    }
    if (!Number.isFinite(startTimeSeconds)) {
      throw new Error(`Invalid MP4 playback time: ${startTimeSeconds}`);
    }

    const relativeStart = Math.max(0, Math.min(startTimeSeconds, info.durationSeconds));
    const iterator = this.#requireSink()
      .samples(
        this.#timelineStartTimestamp + relativeStart,
        this.#timelineStartTimestamp + info.durationSeconds,
      )
      [Symbol.asyncIterator]();
    let currentSample: VideoSample | undefined;
    let termination: Promise<void> | undefined;

    const closeCurrentSample = () => {
      currentSample?.close();
      currentSample = undefined;
    };
    const terminate = async (): Promise<void> => {
      if (!termination) {
        closeCurrentSample();
        termination = iterator.return().then(() => undefined);
      }
      await termination;
    };
    const isAborted = () => signal.aborted;
    const handleAbort = () => {
      void terminate();
    };
    const finish = async (): Promise<IteratorReturnResult<void>> => {
      signal.removeEventListener("abort", handleAbort);
      await terminate();
      return { done: true, value: undefined };
    };
    signal.addEventListener("abort", handleAbort, { once: true });

    return {
      next: async () => {
        closeCurrentSample();
        if (isAborted()) {
          return await finish();
        }

        const readSnapshot = this.#snapshotReads();
        const result = await iterator.next();
        if (result.done === true) {
          return await finish();
        }
        if (isAborted()) {
          result.value.close();
          return await finish();
        }

        const sample = result.value;
        currentSample = sample;
        return {
          done: false,
          value: {
            frame: sample.toVideoFrame(),
            presentationTimeSeconds: sample.timestamp - this.#timelineStartTimestamp,
            durationSeconds: sample.duration,
            width: sample.displayWidth,
            height: sample.displayHeight,
            rotation: sample.rotation,
            reads: this.#readsSince(readSnapshot),
          },
        };
      },
      return: finish,
      throw: async (error) => {
        await finish();
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  public getReadSummary(): Mp4MediabunnyReadSummary {
    return {
      requestCount: this.#requestCount,
      requestedBytes: this.#requestedBytes,
      recentRanges: this.#recentRanges.map(({ offset, length }) => ({ offset, length })),
    };
  }

  public dispose(): void {
    this.#sink = undefined;
    this.#info = undefined;
    this.#input?.dispose();
    this.#input = undefined;
  }

  #requireSink(): VideoSampleSink {
    if (!this.#sink) {
      throw new Error("Mediabunny MP4 controller is not initialized");
    }
    return this.#sink;
  }

  #recordRead(range: Mp4SourceByteRange): void {
    this.#requestCount++;
    this.#requestedBytes += range.length;
    this.#recentRanges.push({ sequence: this.#requestCount, ...range });
    if (this.#recentRanges.length > MAX_REPORTED_RANGES) {
      this.#recentRanges.splice(0, this.#recentRanges.length - MAX_REPORTED_RANGES);
    }
  }

  #snapshotReads(): ReadSnapshot {
    return { requestCount: this.#requestCount, requestedBytes: this.#requestedBytes };
  }

  #readsSince(snapshot: ReadSnapshot): Mp4MediabunnyReadSummary {
    return {
      requestCount: this.#requestCount - snapshot.requestCount,
      requestedBytes: this.#requestedBytes - snapshot.requestedBytes,
      recentRanges: this.#recentRanges
        .filter((range) => range.sequence > snapshot.requestCount)
        .map(({ offset, length }) => ({ offset, length })),
    };
  }
}
