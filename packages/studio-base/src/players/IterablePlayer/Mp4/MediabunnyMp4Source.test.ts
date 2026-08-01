// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  MAX_MP4_RANGE_WINDOW_SIZE_IN_BYTES,
  MEDIABUNNY_MP4_CACHE_SIZE_IN_BYTES,
  createMediabunnyMp4SourceOptions,
} from "./MediabunnyMp4Source";

describe("createMediabunnyMp4SourceOptions", () => {
  it("serves an end-exclusive source read from a containing on-demand window", async () => {
    const reads: { offset: bigint; size: bigint }[] = [];
    const sourceReads: { offset: number; length: number }[] = [];
    const options = createMediabunnyMp4SourceOptions(
      {
        size: async () => 10_000n,
        read: async (offset, size) => {
          reads.push({ offset, size });
          return Uint8Array.from(
            { length: Number(size) },
            (_value, index) => (Number(offset) + index) % 256,
          );
        },
      },
      (range) => {
        sourceReads.push(range);
      },
      { maxRangeWindowSize: 100 },
    );

    expect(await options.getSize()).toBe(10_000);
    expect(await options.read(125, 175)).toEqual(
      Uint8Array.from({ length: 50 }, (_value, index) => 125 + index),
    );
    expect(reads).toEqual([{ offset: 100n, size: 100n }]);
    expect(sourceReads).toEqual([{ offset: 100, length: 100 }]);
    expect(options.prefetchProfile).toBe("none");
    expect(options.maxCacheSize).toBe(MEDIABUNNY_MP4_CACHE_SIZE_IN_BYTES);
  });

  it("keeps sparse reads bounded instead of expanding them to the entire file", async () => {
    const reads: { offset: bigint; size: bigint }[] = [];
    const options = createMediabunnyMp4SourceOptions({
      size: async () => 10_000_000n,
      read: async (offset, size) => {
        reads.push({ offset, size });
        return new Uint8Array(Number(size));
      },
    });

    await options.getSize();
    await options.read(8, 16);
    await options.read(9_999_900, 9_999_908);

    expect(reads).toHaveLength(2);
    expect(reads.every((read) => read.size <= BigInt(MAX_MP4_RANGE_WINDOW_SIZE_IN_BYTES))).toBe(
      true,
    );
    expect(reads.reduce((sum, read) => sum + read.size, 0n)).toBeLessThan(10_000_000n);
  });

  it("rejects file sizes that cannot be represented safely by the browser source API", async () => {
    const options = createMediabunnyMp4SourceOptions({
      size: async () => BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      read: async () => new Uint8Array(),
    });

    await expect(options.getSize()).rejects.toThrow("too large for browser random access");
  });
});
