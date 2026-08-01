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

/**
 * Adapts the exact-range MP4 reader to Mediabunny's end-exclusive CustomSource API. Small adjacent
 * sample reads share deterministic, on-demand windows, but Mediabunny's adaptive/background
 * prefetch stays disabled. The 8 MiB Mediabunny cache plus the 192 MiB HTTP cache remain bounded at
 * 200 MiB.
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
      let windowStart = Math.floor(start / windowSize) * windowSize;
      let windowEnd = Math.min(fileSize, windowStart + windowSize);
      // A request crossing a window boundary is normally one compressed sample. Fetch it exactly;
      // the next request will populate the following aligned window.
      if (end > windowEnd || requestedLength >= windowSize) {
        windowStart = start;
        windowEnd = end;
      }

      const range = { offset: windowStart, length: windowEnd - windowStart };
      onRead?.(range);
      const data = await readable.read(BigInt(range.offset), BigInt(range.length));
      return data.subarray(start - range.offset, end - range.offset);
    },
    maxCacheSize: MEDIABUNNY_MP4_CACHE_SIZE_IN_BYTES,
    prefetchProfile: "none",
  };
}
