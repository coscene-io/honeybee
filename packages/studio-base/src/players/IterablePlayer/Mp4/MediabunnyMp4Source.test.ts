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
      undefined,
      { maxRangeWindowSize: 100 },
    );

    expect(await options.getSize()).toBe(10_000);
    const result = await options.read(125, 175);
    expect(result).toBeInstanceOf(Uint8Array);
    if (!(result instanceof Uint8Array)) {
      throw new Error("Expected an in-memory MP4 range");
    }
    expect(result).toEqual(Uint8Array.from({ length: 50 }, (_value, index) => 125 + index));
    expect(result.byteOffset).toBe(0);
    expect(result.buffer.byteLength).toBe(result.byteLength);
    expect(reads).toEqual([{ offset: 100n, size: 100n }]);
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

  it("resolves a window-straddling read through the covering aligned windows", async () => {
    const reads: { offset: bigint; size: bigint }[] = [];
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
      undefined,
      { maxRangeWindowSize: 100 },
    );

    await options.getSize();
    const result = await options.read(180, 220);
    expect(result).toEqual(Uint8Array.from({ length: 40 }, (_value, index) => (180 + index) % 256));
    // Both fetches stay window-aligned so neither range is downloaded twice.
    expect(reads).toEqual([
      { offset: 100n, size: 100n },
      { offset: 200n, size: 100n },
    ]);
  });

  it("truncates the final covering window at the end of the file", async () => {
    const reads: { offset: bigint; size: bigint }[] = [];
    const options = createMediabunnyMp4SourceOptions(
      {
        size: async () => 1_950n,
        read: async (offset, size) => {
          reads.push({ offset, size });
          return new Uint8Array(Number(size));
        },
      },
      undefined,
      { maxRangeWindowSize: 100 },
    );

    await options.getSize();
    const result = await options.read(1_890, 1_930);
    expect(result).toBeInstanceOf(Uint8Array);
    if (!(result instanceof Uint8Array)) {
      throw new Error("Expected an in-memory MP4 range");
    }
    expect(result.byteLength).toBe(40);
    expect(reads).toEqual([
      { offset: 1_800n, size: 100n },
      { offset: 1_900n, size: 50n },
    ]);
  });

  it("fetches reads larger than the coalescing window at their exact requested size", async () => {
    const reads: { offset: bigint; size: bigint }[] = [];
    const requestedData = new Uint8Array(250);
    const options = createMediabunnyMp4SourceOptions(
      {
        size: async () => 10_000n,
        read: async (offset, size) => {
          reads.push({ offset, size });
          return requestedData;
        },
      },
      undefined,
      { maxRangeWindowSize: 100 },
    );

    await options.getSize();
    await expect(options.read(125, 375)).resolves.toBe(requestedData);
    expect(reads).toEqual([{ offset: 125n, size: 250n }]);
  });
});
