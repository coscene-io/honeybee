// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createFile, ISOFile, Movie, Sample, Track, VisualSampleEntry } from "mp4box";

import { RemoteFileReadable } from "@foxglove/studio-base/players/IterablePlayer/Mcap/RemoteFileReadable";

import {
  findLastSampleIndexAtOrBefore,
  lengthPrefixedSampleToAnnexB,
  Mp4IndexSegment,
  readMp4IndexProgressively,
  sampleEndTimeNs,
  sampleTimeNs,
  toMp4BoxBuffer,
} from "./mp4Utils";

const PLAYBACK_RANGE_WINDOW_SIZE = 4 * 1024 * 1024;
const HEVC_NALU_TYPE_VPS = 32;
const HEVC_NALU_TYPE_SPS = 33;
const HEVC_NALU_TYPE_PPS = 34;

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export type Mp4VideoFormat = "h264" | "h265";

export type Mp4VideoFrame = {
  timestampNs: bigint;
  data: Uint8Array;
  format: Mp4VideoFormat;
};

export type Mp4VideoInfo = {
  format: Mp4VideoFormat;
  width: number;
  height: number;
  samples: readonly Sample[];
  startTimeNs: bigint;
  endTimeNs: bigint;
  hasBFrames: boolean;
};

type RandomAccessReadable = {
  open(): Promise<void>;
  size(): Promise<bigint>;
  read(offset: bigint, size: bigint): Promise<Uint8Array>;
};

function videoFormatForCodec(codec: string): Mp4VideoFormat | undefined {
  if (codec.startsWith("avc1") || codec.startsWith("avc3")) {
    return "h264";
  }
  if (codec.startsWith("hvc1") || codec.startsWith("hev1")) {
    return "h265";
  }
  return undefined;
}

function isVisualSampleEntry(entry: unknown): entry is VisualSampleEntry {
  return typeof entry === "object" && entry != undefined && ("avcC" in entry || "hvcC" in entry);
}

function extractParameterSets(
  entry: VisualSampleEntry,
  format: Mp4VideoFormat,
): { nalLengthSize: number; parameterSets: Uint8Array[] } {
  if (format === "h264") {
    const avcC = entry.avcC;
    if (!avcC) {
      throw new Error("H.264 track is missing its avcC configuration box");
    }
    return {
      nalLengthSize: avcC.lengthSizeMinusOne + 1,
      parameterSets: [...avcC.SPS, ...avcC.PPS].map((nalu) => nalu.data.slice()),
    };
  }

  const hvcC = entry.hvcC;
  if (!hvcC) {
    throw new Error("H.265 track is missing its hvcC configuration box");
  }
  const nalusByType = new Map(
    hvcC.nalu_arrays.map((array) => [array.nalu_type, array.map((nalu) => nalu.data.slice())]),
  );
  const parameterSets = [
    ...(nalusByType.get(HEVC_NALU_TYPE_VPS) ?? []),
    ...(nalusByType.get(HEVC_NALU_TYPE_SPS) ?? []),
    ...(nalusByType.get(HEVC_NALU_TYPE_PPS) ?? []),
  ];
  return { nalLengthSize: hvcC.lengthSizeMinusOne + 1, parameterSets };
}

function installParserCallbacks(parser: ISOFile): {
  getMovie: () => Movie | undefined;
  getError: () => Error | undefined;
} {
  let movie: Movie | undefined;
  let error: Error | undefined;
  parser.onReady = (info) => {
    movie = info;
  };
  parser.onError = (module, message) => {
    error = new Error(`mp4box error while parsing ${module}: ${message}`);
  };
  return {
    getMovie: () => movie,
    getError: () => error,
  };
}

/** Range-backed, demux-only H.264/H.265 reader. Encoded NAL payloads are never transcoded. */
export class Mp4Demuxer {
  readonly #readable: RandomAccessReadable;
  #fileSize?: number;
  #indexSegments?: readonly Mp4IndexSegment[];
  #track?: Track;
  #samples?: readonly Sample[];
  #format?: Mp4VideoFormat;
  #nalLengthSize?: number;
  #parameterSets?: readonly Uint8Array[];

  public constructor(url: string, readable: RandomAccessReadable = new RemoteFileReadable(url)) {
    this.#readable = readable;
  }

  public async initialize(): Promise<Mp4VideoInfo> {
    await this.#readable.open();
    const fileSizeBigInt = await this.#readable.size();
    if (fileSizeBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`MP4 file is too large for browser random access: ${fileSizeBigInt} bytes`);
    }
    const fileSize = Number(fileSizeBigInt);
    this.#fileSize = fileSize;

    const parser = createFile(false);
    const parserState = installParserCallbacks(parser);
    const indexSegments = await readMp4IndexProgressively({
      size: fileSize,
      read: async (offset, length) => await this.#readable.read(BigInt(offset), BigInt(length)),
      append: (data, offset) => {
        const nextOffset = parser.appendBuffer(toMp4BoxBuffer(data, offset));
        const parserError = parserState.getError();
        if (parserError) {
          throw parserError;
        }
        return nextOffset;
      },
      isReady: () => parserState.getMovie() != undefined,
    });
    const parserError = parserState.getError();
    if (parserError) {
      throw parserError;
    }

    const movie = parserState.getMovie();
    if (!movie) {
      throw new Error("MP4 metadata is incomplete: mp4box did not parse a moov box");
    }
    if (movie.isFragmented) {
      throw new Error("Fragmented MP4 files are not supported by the remote MP4 source");
    }

    const track = movie.videoTracks[0];
    if (!track) {
      throw new Error("MP4 file has no video track");
    }
    const format = videoFormatForCodec(track.codec);
    if (!format) {
      throw new Error(
        `Unsupported MP4 video codec "${track.codec}"; only H.264 (avc1/avc3) and H.265 (hvc1/hev1) are supported`,
      );
    }

    const samples = parser.getTrackSamplesInfo(track.id);
    if (samples.length === 0) {
      throw new Error("MP4 video track has no indexed samples");
    }
    const sampleEntry = parser.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
    if (!isVisualSampleEntry(sampleEntry)) {
      throw new Error("MP4 video track is missing its avcC/hvcC sample description");
    }
    const { nalLengthSize, parameterSets } = extractParameterSets(sampleEntry, format);
    if (parameterSets.length === 0) {
      throw new Error("MP4 video track contains no codec parameter sets");
    }

    this.#indexSegments = indexSegments;
    this.#track = track;
    this.#samples = samples;
    this.#format = format;
    this.#nalLengthSize = nalLengthSize;
    this.#parameterSets = parameterSets;

    const firstSample = samples[0]!;
    const lastSample = samples[samples.length - 1]!;
    const startTimeNs = sampleTimeNs(firstSample);
    const sampleEndNs = sampleEndTimeNs(lastSample);
    const trackEndNs =
      startTimeNs + (BigInt(track.duration) * 1_000_000_000n) / BigInt(track.timescale);

    return {
      format,
      width: track.video?.width ?? 0,
      height: track.video?.height ?? 0,
      samples,
      startTimeNs,
      endTimeNs: sampleEndNs > trackEndNs ? sampleEndNs : trackEndNs,
      hasBFrames: samples.some((sample) => sample.cts !== sample.dts),
    };
  }

  public async frameAtOrBefore(timeNs: bigint): Promise<Mp4VideoFrame | undefined> {
    const samples = this.#requireSamples();
    const index = findLastSampleIndexAtOrBefore(samples, timeNs);
    if (index == undefined) {
      return undefined;
    }
    return await this.#readFrame(samples[index]!);
  }

  public async *frames(
    startTimeNs: bigint,
    endTimeNs: bigint,
    abortSignal?: AbortSignal,
  ): AsyncIterableIterator<Mp4VideoFrame> {
    if (endTimeNs < startTimeNs) {
      return;
    }

    const parser = createFile(false);
    const parserState = installParserCallbacks(parser);
    for (const segment of this.#requireIndexSegments()) {
      parser.appendBuffer(toMp4BoxBuffer(segment.data, segment.offset));
      const parserError = parserState.getError();
      if (parserError) {
        throw parserError;
      }
    }
    const parserError = parserState.getError();
    if (parserError) {
      throw parserError;
    }
    if (!parserState.getMovie()) {
      throw new Error("Failed to restore the MP4 sample index");
    }

    const track = this.#requireTrack();
    const pendingSamples: Sample[] = [];
    parser.onSamples = (_id, _user, samples) => {
      pendingSamples.push(...samples);
    };
    parser.setExtractionOptions(track.id, undefined, { nbSamples: 1 });
    const seekResult = parser.seek(Number(startTimeNs) / 1e9, true);
    let nextOffset = seekResult.offset;
    parser.start();

    try {
      while (nextOffset < this.#requireFileSize()) {
        if (isAborted(abortSignal)) {
          return;
        }

        while (pendingSamples.length > 0) {
          const sample = pendingSamples.shift()!;
          const timestampNs = sampleTimeNs(sample);
          if (timestampNs > endTimeNs) {
            parser.releaseUsedSamples(track.id, sample.number + 1);
            return;
          }
          if (!sample.data) {
            throw new Error(`mp4box extracted sample ${sample.number} without data`);
          }

          if (timestampNs >= startTimeNs) {
            const frame = this.#frameFromSampleData(sample, sample.data);
            parser.releaseUsedSamples(track.id, sample.number + 1);
            yield frame;
          } else {
            parser.releaseUsedSamples(track.id, sample.number + 1);
          }
        }

        const fileSize = this.#requireFileSize();
        const length = Math.min(PLAYBACK_RANGE_WINDOW_SIZE, fileSize - nextOffset);
        const data = await this.#readable.read(BigInt(nextOffset), BigInt(length));
        if (isAborted(abortSignal)) {
          return;
        }
        if (data.byteLength !== length) {
          throw new Error(
            `Short MP4 range read at offset ${nextOffset}: expected ${length}, got ${data.byteLength}`,
          );
        }
        const requestedOffset = nextOffset;
        const parserNextOffset = parser.appendBuffer(toMp4BoxBuffer(data, requestedOffset));
        const extractionError = parserState.getError();
        if (extractionError) {
          throw extractionError;
        }
        if (!Number.isSafeInteger(parserNextOffset) || parserNextOffset < 0) {
          throw new Error(`mp4box requested an invalid media offset: ${parserNextOffset}`);
        }
        nextOffset = Math.max(requestedOffset + data.byteLength, parserNextOffset);
      }

      while (pendingSamples.length > 0) {
        const sample = pendingSamples.shift()!;
        const timestampNs = sampleTimeNs(sample);
        if (timestampNs > endTimeNs) {
          parser.releaseUsedSamples(track.id, sample.number + 1);
          return;
        }
        if (!sample.data) {
          throw new Error(`mp4box extracted sample ${sample.number} without data`);
        }
        if (timestampNs >= startTimeNs) {
          const frame = this.#frameFromSampleData(sample, sample.data);
          parser.releaseUsedSamples(track.id, sample.number + 1);
          yield frame;
        } else {
          parser.releaseUsedSamples(track.id, sample.number + 1);
        }
      }
    } finally {
      parser.stop();
      parser.unsetExtractionOptions(track.id);
    }
  }

  async #readFrame(sample: Sample): Promise<Mp4VideoFrame> {
    const data = await this.#readable.read(BigInt(sample.offset), BigInt(sample.size));
    if (data.byteLength !== sample.size) {
      throw new Error(
        `Short MP4 sample read at offset ${sample.offset}: expected ${sample.size}, got ${data.byteLength}`,
      );
    }
    return this.#frameFromSampleData(sample, data);
  }

  #frameFromSampleData(sample: Sample, data: Uint8Array): Mp4VideoFrame {
    return {
      timestampNs: sampleTimeNs(sample),
      data: lengthPrefixedSampleToAnnexB(
        data,
        this.#requireNalLengthSize(),
        sample.is_sync ? this.#requireParameterSets() : [],
      ),
      format: this.#requireFormat(),
    };
  }

  #requireFileSize(): number {
    if (this.#fileSize == undefined) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#fileSize;
  }

  #requireIndexSegments(): readonly Mp4IndexSegment[] {
    if (!this.#indexSegments) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#indexSegments;
  }

  #requireTrack(): Track {
    if (!this.#track) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#track;
  }

  #requireSamples(): readonly Sample[] {
    if (!this.#samples) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#samples;
  }

  #requireFormat(): Mp4VideoFormat {
    if (!this.#format) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#format;
  }

  #requireNalLengthSize(): number {
    if (this.#nalLengthSize == undefined) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#nalLengthSize;
  }

  #requireParameterSets(): readonly Uint8Array[] {
    if (!this.#parameterSets) {
      throw new Error("MP4 demuxer is not initialized");
    }
    return this.#parameterSets;
  }
}
