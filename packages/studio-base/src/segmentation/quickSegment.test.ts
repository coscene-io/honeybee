/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { quickSegment } from "./quickSegment";

const RECORD = "warehouses/w/projects/p/records/r";

type Response = {
  mask?: { counts: string };
  score: number;
  width: number;
  height: number;
};

function setup(response: Response, frame = { width: 4, height: 2 }) {
  Object.assign(globalThis, {
    createImageBitmap: jest.fn(async () => ({ ...frame, close: () => undefined })),
    OffscreenCanvas: class {
      public getContext() {
        return { drawImage: () => undefined };
      }
      public async convertToBlob() {
        // jsdom Blobs have no arrayBuffer(); browsers do.
        return { arrayBuffer: async () => new TextEncoder().encode("jpeg").buffer };
      }
    },
    fetch: jest.fn(async () => ({ blob: async () => new Blob(["frame"]) })),
  });
  const segmentFrame = jest.fn(async () => response);
  return {
    segmentFrame,
    client: { segmentFrame } as unknown as Parameters<typeof quickSegment>[0],
  };
}

const request = {
  topic: "/camera",
  // 1000.000123456 s: the wire time truncates to 1000.000123 s.
  logTimeNs: "1000000123456",
  width: 4,
  height: 2,
  imageUrl: "blob:frame",
  points: [
    { x: 0.5, y: 0.5, positive: true },
    { x: 1, y: 0, positive: false },
  ],
};

describe("quickSegment", () => {
  it("sends the displayed frame and every point in source pixels to SegmentFrame", async () => {
    const { client, segmentFrame } = setup({
      mask: { counts: "152" },
      score: 0.9,
      width: 4,
      height: 2,
    });
    const signal = new AbortController().signal;
    const result = await quickSegment(client, RECORD, request, signal);
    expect(result).toEqual({ mask: { counts: "152", width: 4, height: 2 }, score: 0.9 });
    const [sent, options] = segmentFrame.mock.calls[0] as unknown as [
      {
        record: string;
        topic: string;
        frameTime: { seconds: bigint; nanos: number };
        image: Uint8Array;
        points: { x: number; y: number; negative: boolean }[];
      },
      { signal?: AbortSignal },
    ];
    expect(sent.record).toBe(RECORD);
    expect(sent.topic).toBe("/camera");
    expect(sent.frameTime).toEqual({ seconds: 1000n, nanos: 123000 });
    expect(new TextDecoder().decode(sent.image)).toBe("jpeg");
    expect(sent.points).toEqual([
      { x: 2, y: 1, negative: false },
      { x: 4, y: 0, negative: true },
    ]);
    expect(options.signal).toBe(signal);
  });

  it("reports no foreground as an unset mask", async () => {
    const { client } = setup({ score: 0, width: 4, height: 2 });
    await expect(quickSegment(client, RECORD, request)).resolves.toEqual({
      mask: undefined,
      score: 0,
    });
  });

  it("rejects a displayed frame whose size differs from the source", async () => {
    const { client, segmentFrame } = setup(
      { score: 0, width: 4, height: 2 },
      { width: 2, height: 1 },
    );
    await expect(quickSegment(client, RECORD, request)).rejects.toThrow("2×1");
    expect(segmentFrame).not.toHaveBeenCalled();
  });

  it("rejects a mask the server computed at another size", async () => {
    const { client } = setup({ mask: { counts: "8" }, score: 1, width: 8, height: 1 });
    await expect(quickSegment(client, RECORD, request)).rejects.toThrow("8×1");
  });
});
