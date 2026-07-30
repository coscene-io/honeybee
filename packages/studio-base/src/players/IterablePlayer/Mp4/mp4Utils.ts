// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MP4BoxBuffer, Sample } from "mp4box";

const START_CODE = Uint8Array.of(0, 0, 0, 1);
const NANOSECONDS_PER_SECOND = 1_000_000_000n;

export const MP4_INDEX_CHUNK_SIZE = 1024 * 1024;
export const MP4_MAX_INDEX_BYTES = 200 * 1024 * 1024;

export type Mp4IndexSegment = {
  offset: number;
  data: Uint8Array;
};

type ProgressiveIndexOptions = {
  size: number;
  read: (offset: number, length: number) => Promise<Uint8Array>;
  append: (data: Uint8Array, offset: number) => number;
  isReady: () => boolean;
  chunkSize?: number;
  maxIndexBytes?: number;
};

/**
 * Feeds sparse ranges to mp4box until `moov` is ready. mp4box's returned offset skips over `mdat`,
 * which is what makes moov-at-end files cheap to initialize instead of downloading their media.
 */
export async function readMp4IndexProgressively({
  size,
  read,
  append,
  isReady,
  chunkSize = MP4_INDEX_CHUNK_SIZE,
  maxIndexBytes = MP4_MAX_INDEX_BYTES,
}: ProgressiveIndexOptions): Promise<Mp4IndexSegment[]> {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`Invalid MP4 file size: ${size}`);
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid MP4 index chunk size: ${chunkSize}`);
  }

  const segments: Mp4IndexSegment[] = [];
  let offset = 0;
  let totalBytes = 0;

  while (!isReady()) {
    if (offset >= size) {
      throw new Error("MP4 metadata is incomplete: the moov box was not found");
    }

    const length = Math.min(chunkSize, size - offset);
    const data = await read(offset, length);
    if (data.byteLength !== length) {
      throw new Error(
        `Short MP4 range read at offset ${offset}: expected ${length}, got ${data.byteLength}`,
      );
    }

    totalBytes += data.byteLength;
    if (totalBytes > maxIndexBytes) {
      throw new Error(
        `MP4 metadata exceeds the ${Math.floor(maxIndexBytes / (1024 * 1024))} MiB index limit`,
      );
    }
    segments.push({ offset, data });

    const nextOffset = append(data, offset);
    if (isReady()) {
      break;
    }
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > size) {
      throw new Error(`mp4box requested an invalid next offset: ${nextOffset}`);
    }

    // Do not append bytes that were already included in the current range. When mp4box sees an
    // mdat before moov, nextOffset jumps directly to the box after mdat.
    offset = Math.max(offset + data.byteLength, nextOffset);
  }

  return segments;
}

export function toMp4BoxBuffer(data: Uint8Array, offset: number): MP4BoxBuffer {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return MP4BoxBuffer.fromArrayBuffer(buffer, offset);
}

function readNaluLength(view: DataView, offset: number, lengthSize: number): number {
  switch (lengthSize) {
    case 1:
      return view.getUint8(offset);
    case 2:
      return view.getUint16(offset, false);
    case 4:
      return view.getUint32(offset, false);
    default:
      throw new Error(`Unsupported NAL length field size: ${lengthSize} bytes`);
  }
}

/** Converts one MP4 length-prefixed AVC/HEVC sample to Annex-B without re-encoding it. */
export function lengthPrefixedSampleToAnnexB(
  sampleData: Uint8Array,
  nalLengthSize: number,
  prependNalus: readonly Uint8Array[] = [],
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (const nalu of prependNalus) {
    chunks.push(START_CODE, nalu);
    totalLength += START_CODE.byteLength + nalu.byteLength;
  }

  const view = new DataView(sampleData.buffer, sampleData.byteOffset, sampleData.byteLength);
  let offset = 0;
  while (offset < sampleData.byteLength) {
    if (offset + nalLengthSize > sampleData.byteLength) {
      throw new Error("Malformed MP4 sample: truncated NAL length prefix");
    }
    const length = readNaluLength(view, offset, nalLengthSize);
    offset += nalLengthSize;
    if (offset + length > sampleData.byteLength) {
      throw new Error("Malformed MP4 sample: NAL length exceeds the remaining buffer");
    }
    const nalu = sampleData.subarray(offset, offset + length);
    chunks.push(START_CODE, nalu);
    totalLength += START_CODE.byteLength + nalu.byteLength;
    offset += length;
  }

  const output = new Uint8Array(totalLength);
  let outputOffset = 0;
  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  return output;
}

export function sampleTimeNs(sample: Pick<Sample, "dts" | "timescale">): bigint {
  if (
    !Number.isSafeInteger(sample.dts) ||
    !Number.isSafeInteger(sample.timescale) ||
    sample.timescale <= 0
  ) {
    throw new Error(`Invalid MP4 sample timestamp ${sample.dts}/${sample.timescale}`);
  }
  return (BigInt(sample.dts) * NANOSECONDS_PER_SECOND) / BigInt(sample.timescale);
}

export function sampleEndTimeNs(sample: Pick<Sample, "dts" | "duration" | "timescale">): bigint {
  if (!Number.isSafeInteger(sample.duration)) {
    throw new Error(`Invalid MP4 sample duration: ${sample.duration}`);
  }
  return (
    ((BigInt(sample.dts) + BigInt(sample.duration)) * NANOSECONDS_PER_SECOND) /
    BigInt(sample.timescale)
  );
}

export function findSampleIndexAtOrAfter(
  samples: readonly Pick<Sample, "dts" | "timescale">[],
  timeNs: bigint,
): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (sampleTimeNs(samples[middle]!) < timeNs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function findLastSampleIndexAtOrBefore(
  samples: readonly Pick<Sample, "dts" | "timescale">[],
  timeNs: bigint,
): number | undefined {
  const index = findSampleIndexAtOrAfter(samples, timeNs);
  if (index < samples.length && sampleTimeNs(samples[index]!) === timeNs) {
    return index;
  }
  return index > 0 ? index - 1 : undefined;
}
