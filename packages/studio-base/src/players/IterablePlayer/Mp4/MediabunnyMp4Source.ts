// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import type { CustomSourceOptions } from "mediabunny";

export const MEDIABUNNY_MP4_CACHE_SIZE_IN_BYTES = 8 * 1024 * 1024;
export const REMOTE_MP4_CACHE_SIZE_IN_BYTES = 192 * 1024 * 1024;
export const MAX_MP4_RANGE_WINDOW_SIZE_IN_BYTES = 512 * 1024;

const MINIMUM_FILE_WINDOW_COUNT = 16;

export type Mp4SourceByteRange = {
  offset: number;
  length: number;
};

export type Mp4RandomAccessReadable = {
  size(): Promise<bigint>;
  read(offset: bigint, size: bigint): Promise<Uint8Array>;
};

function toExactBuffer(data: Uint8Array, sliceStart: number, length: number): Uint8Array {
  if (
    sliceStart === 0 &&
    length === data.byteLength &&
    data.byteOffset === 0 &&
    data.buffer.byteLength === data.byteLength
  ) {
    return data;
  }
  return data.slice(sliceStart, sliceStart + length);
}

/**
 * Adapts the exact-range MP4 reader to Mediabunny's end-exclusive CustomSource API. Small adjacent
 * sample reads share deterministic, on-demand windows of at most 512 KiB; a small read that
 * straddles a window boundary resolves through each covering window so fetches stay aligned and
 * cache-reusable. Reads that are already larger than a window are fetched at exactly their
 * requested size. Mediabunny's adaptive/background prefetch stays disabled. The 8 MiB Mediabunny
 * cache plus the 192 MiB HTTP cache remain bounded at 200 MiB.
 */
export function createMediabunnyMp4SourceOptions(
  readable: Mp4RandomAccessReadable,
  onRead?: (range: Mp4SourceByteRange) => void,
  options: { maxRangeWindowSize?: number } = {},
): CustomSourceOptions {
  const maxRangeWindowSize = options.maxRangeWindowSize ?? MAX_MP4_RANGE_WINDOW_SIZE_IN_BYTES;
  if (!Number.isSafeInteger(maxRangeWindowSize) || maxRangeWindowSize <= 0) {
    throw new Error(`Invalid MP4 range window size: ${maxRangeWindowSize}`);
  }

  let fileSize: number | undefined;
  return {
    getSize: async () => {
      const size = await readable.size();
      if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Remote MP4 is too large for browser random access: ${size} bytes`);
      }
      fileSize = Number(size);
      return fileSize;
    },
    read: async (start, end) => {
      if (fileSize == undefined) {
        throw new Error("Mediabunny requested MP4 bytes before the file size");
      }

      const requestedLength = end - start;
      const windowSize = Math.min(
        maxRangeWindowSize,
        Math.max(1, Math.ceil(fileSize / MINIMUM_FILE_WINDOW_COUNT)),
      );

      if (requestedLength >= windowSize) {
        const range = { offset: start, length: requestedLength };
        onRead?.(range);
        const data = await readable.read(BigInt(range.offset), BigInt(range.length));
        return toExactBuffer(data, 0, requestedLength);
      }

      // Small reads always resolve through window-aligned fetches — including reads that
      // straddle a window boundary, which fetch each covering window. Keeping every fetch
      // aligned means a straddling read never re-downloads bytes that the neighboring
      // windows already provide (and will provide to subsequent sequential reads).
      const firstWindowStart = Math.floor(start / windowSize) * windowSize;
      const lastWindowStart = Math.floor((end - 1) / windowSize) * windowSize;
      const windows: Mp4SourceByteRange[] = [];
      for (let offset = firstWindowStart; offset <= lastWindowStart; offset += windowSize) {
        const length = Math.min(fileSize, offset + windowSize) - offset;
        windows.push({ offset, length });
        onRead?.({ offset, length });
      }
      const buffers = await Promise.all(
        windows.map(async (range) => await readable.read(BigInt(range.offset), BigInt(range.length))),
      );

      if (windows.length === 1) {
        return toExactBuffer(buffers[0]!, start - windows[0]!.offset, requestedLength);
      }

      const stitched = new Uint8Array(requestedLength);
      for (let index = 0; index < windows.length; index++) {
        const range = windows[index]!;
        const from = Math.max(start, range.offset);
        const to = Math.min(end, range.offset + range.length);
        stitched.set(buffers[index]!.subarray(from - range.offset, to - range.offset), from - start);
      }
      return stitched;
    },
    maxCacheSize: MEDIABUNNY_MP4_CACHE_SIZE_IN_BYTES,
    prefetchProfile: "none",
  };
}
