// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { createSourceFrameLoader, readStamps, SOURCE_FRAME_WINDOW_NS } from "./sourceFrames";
import type { SegmentationFrame } from "./types";

const START = 1_700_000_000_000_000_000n;
const TOPIC = "/cam/h264";

/** Irregular 30 Hz-ish camera: gaps of 33 ms and an occasional dropped frame. */
function cameraTimes(count: number): bigint[] {
  const times: bigint[] = [];
  let at = START + 7_000_000n;
  for (let index = 0; index < count; index++) {
    times.push(at);
    at += index % 17 === 16 ? 66_000_000n : 33_000_000n;
  }
  return times;
}

function fakeSource(times: bigint[]) {
  const reads: Array<[bigint, bigint]> = [];
  const payloads: unknown[] = [];
  const subscribe: SubscribeMessageRange = (args) => {
    const start = toNanoSec(args.timeRange!.start);
    const end = toNanoSec(args.timeRange!.end);
    reads.push([start, end]);
    payloads.push(args.payload);
    const batch = times
      .filter((time) => time >= start && time <= end)
      .map((time) => ({
        topic: args.topic,
        receiveTime: fromNanoSec(time),
        message: { timestamp: fromNanoSec(time - 1000n) },
        schemaName: "foxglove.CompressedVideo",
        sizeInBytes: 0,
      }));
    void args.onNewRangeIterator(
      (async function* () {
        yield batch;
      })(),
    );
    return () => {};
  };
  return { subscribe, reads, payloads };
}

it("reads message stamps in the requested range only, without the image payload", async () => {
  const times = cameraTimes(10);
  const { subscribe, payloads } = fakeSource(times);
  const stamps = await readStamps(
    subscribe,
    TOPIC,
    fromNanoSec(times[2]!),
    fromNanoSec(times[5]!),
    new AbortController().signal,
  );
  expect(stamps.map((stamp) => toNanoSec(stamp.receiveTime))).toEqual(times.slice(2, 6));
  expect(toNanoSec(stamps[0]!.timestamp)).toBe(times[2]! - 1000n);
  expect(payloads).toEqual([{ fields: ["header", "timestamp"] }]);
});

it("rejects when the source cannot read ranges", async () => {
  await expect(
    readStamps(
      () => undefined,
      TOPIC,
      fromNanoSec(START),
      fromNanoSec(START + 1n),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "errorRangeReadUnsupported" });
});

function loaderFor(times: bigint[]) {
  const { subscribe, reads } = fakeSource(times);
  const registered = new Map<string, SegmentationFrame>();
  const loader = createSourceFrameLoader({
    subscribeMessageRange: subscribe,
    topic: TOPIC,
    videoId: "video",
    startNs: START,
    endNs: times[times.length - 1]! + 1n,
    register: (frames) => {
      for (const frame of frames) {
        registered.set(frame.id, frame);
      }
    },
    knownLogTimes: () => [...registered.values()].map((frame) => BigInt(frame.logTimeNs)),
  });
  return { loader, reads, registered };
}

it("registers each window once with real log times", async () => {
  const times = cameraTimes(900); // about 31 s
  const { loader, reads, registered } = loaderFor(times);
  await loader.ensureRange(START + 12_000_000_000n, START + 13_000_000_000n);
  await loader.ensureRange(START + 11_000_000_000n, START + 19_000_000_000n);
  expect(reads).toHaveLength(1);
  const expected = times.filter(
    (time) => time >= START + SOURCE_FRAME_WINDOW_NS && time < START + 2n * SOURCE_FRAME_WINDOW_NS,
  );
  expect([...registered.values()].map((frame) => frame.logTimeNs)).toEqual(expected.map(String));
  expect(registered.get(`video:${expected[0]! - 1000n}:${expected[0]!}`)?.timestampSec).toBeCloseTo(
    Number(expected[0]! - START) / 1e9,
  );
});

it("reads later windows until enough following frames are known", async () => {
  const times = cameraTimes(900);
  const { loader, reads, registered } = loaderFor(times);
  const seed = times[280]!; // near the end of the first window
  await loader.ensureFollowing(seed, 100);
  // Windows 0 and 1 were needed. The next window's read started with the first one instead of
  // after it; one more look-ahead read may start before the count is known to be reached.
  const windowOf = ([start]: [bigint, bigint]) => (start - START) / SOURCE_FRAME_WINDOW_NS;
  expect(reads.map(windowOf).slice(0, 2)).toEqual([1n, 0n]);
  expect(reads.length).toBeLessThanOrEqual(3);
  expect(
    [...registered.values()].filter((frame) => BigInt(frame.logTimeNs) > seed).length,
  ).toBeGreaterThanOrEqual(100);
});

it("stops at the end of the recording", async () => {
  const times = cameraTimes(100);
  const { loader, registered } = loaderFor(times);
  await loader.ensureFollowing(times[90]!, 500);
  expect(registered.size).toBe(100);
});

it("clears a failed window's retry timer when disposed", async () => {
  jest.useFakeTimers();
  try {
    const loader = createSourceFrameLoader({
      subscribeMessageRange: (args) => {
        void args.onNewRangeIterator(
          (async function* (): AsyncGenerator<never> {
            yield* [];
            throw new Error("read failed");
          })(),
        );
        return () => {};
      },
      topic: TOPIC,
      videoId: "video",
      startNs: START,
      endNs: START + 1_000_000_000n,
      register: () => {},
      knownLogTimes: () => [],
    });
    await expect(loader.ensureRange(START, START + 1n)).rejects.toThrow("read failed");
    expect(jest.getTimerCount()).toBe(1);
    loader.dispose();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
