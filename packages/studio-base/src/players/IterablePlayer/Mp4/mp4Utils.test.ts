// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  findLastSampleIndexAtOrBefore,
  findSampleIndexAtOrAfter,
  lengthPrefixedSampleToAnnexB,
  readMp4IndexProgressively,
} from "./mp4Utils";

describe("readMp4IndexProgressively", () => {
  it("uses the parser's next offset to skip mdat before a tail moov", async () => {
    const file = new Uint8Array(10_000);
    const reads: { offset: number; length: number }[] = [];
    let appendCount = 0;
    let ready = false;

    const segments = await readMp4IndexProgressively({
      size: file.byteLength,
      chunkSize: 100,
      read: async (offset, length) => {
        reads.push({ offset, length });
        return file.slice(offset, offset + length);
      },
      append: (_data, offset) => {
        appendCount++;
        if (appendCount === 1) {
          return 9_000;
        }
        ready = true;
        return offset + 100;
      },
      isReady: () => ready,
    });

    expect(reads).toEqual([
      { offset: 0, length: 100 },
      { offset: 9_000, length: 100 },
    ]);
    expect(segments.map((segment) => segment.offset)).toEqual([0, 9_000]);
  });

  it("rejects an index larger than the configured bound", async () => {
    await expect(
      readMp4IndexProgressively({
        size: 1_000,
        chunkSize: 100,
        maxIndexBytes: 150,
        read: async (_offset, length) => new Uint8Array(length),
        append: (_data, offset) => offset + 100,
        isReady: () => false,
      }),
    ).rejects.toThrow("index limit");
  });
});

describe("lengthPrefixedSampleToAnnexB", () => {
  it("prepends parameter sets and converts length prefixes to start codes", () => {
    const parameterSet = Uint8Array.of(0x67, 0x01);
    const sample = Uint8Array.of(0, 0, 0, 2, 0x65, 0xaa, 0, 0, 0, 1, 0x06);

    expect(lengthPrefixedSampleToAnnexB(sample, 4, [parameterSet])).toEqual(
      Uint8Array.of(0, 0, 0, 1, 0x67, 0x01, 0, 0, 0, 1, 0x65, 0xaa, 0, 0, 0, 1, 0x06),
    );
  });

  it("rejects a NAL length beyond the sample", () => {
    expect(() => lengthPrefixedSampleToAnnexB(Uint8Array.of(0, 5, 1), 2)).toThrow(
      "NAL length exceeds",
    );
  });
});

describe("MP4 sample seek helpers", () => {
  const samples = [
    { dts: 0, timescale: 10 },
    { dts: 5, timescale: 10 },
    { dts: 10, timescale: 10 },
  ];

  it("finds the first sample at or after a timestamp", () => {
    expect(findSampleIndexAtOrAfter(samples, 500_000_000n)).toBe(1);
    expect(findSampleIndexAtOrAfter(samples, 600_000_000n)).toBe(2);
    expect(findSampleIndexAtOrAfter(samples, 2_000_000_000n)).toBe(3);
  });

  it("finds the last sample at or before a timestamp", () => {
    expect(findLastSampleIndexAtOrBefore(samples, -1n)).toBeUndefined();
    expect(findLastSampleIndexAtOrBefore(samples, 500_000_000n)).toBe(1);
    expect(findLastSampleIndexAtOrBefore(samples, 999_999_999n)).toBe(1);
    expect(findLastSampleIndexAtOrBefore(samples, 2_000_000_000n)).toBe(2);
  });
});
