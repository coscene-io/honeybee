// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromSec } from "@foxglove/rostime";
import { mockPlayerState } from "@foxglove/studio-base/players/TopicAliasingPlayer/mocks";

import { PlaybackDiagnostics } from "./playbackDiagnostics";
import { DIAGNOSTIC_HISTORY_LIMIT, SliceHistory, VideoRun } from "./videoDiagnostics";

it("retains findings across seek, deduplicates replays and never bridges unloaded ranges", () => {
  const session = new PlaybackDiagnostics();
  const observe = (run: VideoRun, log: number, media: number, header: number, slice: number) => {
    session.inspect(
      "/camera",
      {
        receiveTime: fromSec(log),
        message: { timestamp: fromSec(media), format: "h264", data: [0, 0, 1, header, slice] },
      },
      run,
    );
  };
  for (let replay = 0; replay < 2; replay++) {
    const run = new VideoRun();
    observe(run, 16, 1, 0x65, 0xb0);
    observe(run, 18, 3, 0x41, 0xa0);
    const gap = session.topic("/camera").findings.get("gap")!;
    if (replay === 0) {
      expect([...gap.values()][0]).toMatchObject({ duration: 2, open: true });
    }
    observe(run, 19, 4, 0x65, 0xb0);
    expect([...gap.values()].filter((item) => item.open === false)).toHaveLength(1);
    expect([...gap.values()][0]).toMatchObject({ duration: 3, open: false });
    observe(run, 20, 2, 0x41, 0xc0);
    observe(new VideoRun(), 60, 60, 0x65, 0xb0);
  }
  const topic = session.topic("/camera");
  expect(topic.coverage).toEqual([
    { start: 16000000000n, end: 20000000000n },
    { start: 60000000000n, end: 60000000000n },
  ]);
  expect(topic.slices?.size).toBe(1);
  expect(topic.findings.get("regression")?.size).toBe(1);
  expect(topic.longestGap).toEqual({ duration: 3, clock: "imageClock" });
  expect(new PlaybackDiagnostics().topics.size).toBe(0);
});

it("bounds packet identities, per-kind findings and disjoint coverage across a long session", () => {
  const session = new PlaybackDiagnostics();
  const slices = new SliceHistory("/camera");
  const packet = { key: false, missing: [] };
  for (let i = 0; i <= DIAGNOSTIC_HISTORY_LIMIT; i++) {
    const log = BigInt(i);
    // Include distinct frames with the same log time, as well as unknown HEVC backfills.
    slices.observe(0n, log, { ...packet, bFrame: true }, "h265");
    slices.observe(1n, log, packet, "h265");
    slices.observe(2n, log, { ...packet, bFrame: false }, "h265");
    session.record({ kind: "empty", topic: "/camera", start: log, end: log });
    session.cover("/camera", log, log);
  }
  expect(slices.size).toBe(DIAGNOSTIC_HISTORY_LIMIT);
  expect(slices.unknownCount).toBe(DIAGNOSTIC_HISTORY_LIMIT);
  expect(slices.truncated).toBe(true);
  expect([...slices][0]?.[0]).toBe("0/1");
  // A replay of a retained known slice cannot downgrade it to unknown.
  slices.observe(2n, 1n, packet, "h265");
  slices.observe(1n, 1n, { ...packet, bFrame: true }, "h265");
  expect(slices.unknownCount).toBe(DIAGNOSTIC_HISTORY_LIMIT - 1);
  const topic = session.topic("/camera");
  expect(topic.truncated).toBe(true);
  expect(topic.findings.get("empty")?.size).toBe(DIAGNOSTIC_HISTORY_LIMIT);
  expect(topic.coverage).toHaveLength(DIAGNOSTIC_HISTORY_LIMIT);
  expect(topic.coverage[0]).toEqual({ start: 1n, end: 1n });
});

it.each([DIAGNOSTIC_HISTORY_LIMIT, DIAGNOSTIC_HISTORY_LIMIT + 1])(
  "keeps uncertainty when resolving the retained subset of %i unknown HEVC slices",
  (count) => {
    const slices = new SliceHistory("/camera");
    const packet = { key: false, missing: [] };
    for (let i = 0; i < count; i++) {
      slices.observe(BigInt(i), undefined, packet, "h265");
    }
    for (let i = count - DIAGNOSTIC_HISTORY_LIMIT; i < count; i++) {
      slices.observe(BigInt(i), undefined, { ...packet, bFrame: false }, "h265");
    }
    expect(slices.unknownCount).toBe(0);
    expect(slices.size).toBe(0);
    expect(slices.allObservedSlicesClassified()).toBe(count === DIAGNOSTIC_HISTORY_LIMIT);
  },
);

it("measures continuous keyframe intervals in recording time across reordered presentation timestamps", () => {
  const session = new PlaybackDiagnostics();
  const run = new VideoRun();
  for (const [log, media, byte] of [
    [1, 1, 0x65],
    [2, 3, 0x41],
    [3, 2, 0x41],
    [4, 4, 0x65],
    [4, 4, 0x65], // Redelivering the last keyframe must preserve the measured interval.
  ] as const) {
    session.inspect(
      "/camera",
      {
        receiveTime: fromSec(log),
        message: { timestamp: fromSec(media), format: "h264", data: [0, 0, 1, byte, 0xb0] },
      },
      run,
    );
  }
  const topic = session.topic("/camera");
  expect(topic.recentGap).toEqual({ duration: 3, clock: "recordClock" });
  expect(topic.findings.get("regression")?.size).toBe(1);
});

it("times two panels independently from acceptance and excludes intermediate, cancelled and timed-out frames", () => {
  const session = new PlaybackDiagnostics();
  session.bind("left", "/camera");
  session.bind("right", "/camera");
  const seek = (sequence: number, started: number) => {
    session.update(
      mockPlayerState(undefined, {
        currentTime: fromSec(sequence),
        startTime: fromSec(0),
        messages: [],
        acceptedSeek: { sequence, started, target: fromSec(sequence) },
      }),
      started,
    );
  };
  seek(1, 10);
  seek(2, 20);
  for (const id of ["left", "right"]) {
    session.expectFrame(id, "/camera", 2000000000n, 1900000000n, 10n);
  }
  session.displayed("left", "/camera", 1900000000n, 9n, {}, 30);
  session.displayed("left", "/camera", 1900000000n, 10n, {}, 45);
  session.displayed("right", "/camera", 1900000000n, 10n, {}, 10021);
  expect(session.panel("left", "/camera")).toMatchObject({
    samples: [25],
    successes: 1,
    cancelled: 1,
    timeouts: 0,
  });
  expect(session.panel("right", "/camera")).toMatchObject({
    samples: [],
    successes: 0,
    cancelled: 1,
    timeouts: 1,
  });
});

it("includes panels that bind during seek backfill and excludes panels opened afterwards", () => {
  const session = new PlaybackDiagnostics();
  const seek = { sequence: 1, started: performance.now(), target: fromSec(2) };
  session.update(
    mockPlayerState(undefined, { acceptedSeek: { ...seek, backfillPending: true } }),
    seek.started,
  );
  session.bind("initial image", "/camera");
  const unbind = session.bind("removed", "/camera");
  unbind();
  session.bind("removed", "/camera");
  expect(session.panel("removed", "/camera").pending).toBeUndefined();
  session.update(mockPlayerState(undefined, { acceptedSeek: seek }), seek.started + 50);
  session.expectFrame("initial image", "/camera", 2000000000n, 1900000000n, 1n);
  session.displayed("initial image", "/camera", 1900000000n, 1n, {}, seek.started + 75);
  expect(session.panel("initial image", "/camera").samples).toEqual([75]);
  session.bind("late", "/camera");
  expect(session.panel("late", "/camera").pending).toBeUndefined();
});

it("measures lag against the advancing player clock while a visible image stalls", () => {
  const session = new PlaybackDiagnostics();
  const unbind = session.bind("left", "/camera");
  const panel = session.panel("left", "/camera");
  const advance = (sec: number) => {
    session.update(mockPlayerState(undefined, { currentTime: fromSec(sec) }));
  };
  advance(2);
  expect(session.frameLagMs(panel)).toBeUndefined();
  session.displayed("left", "/camera", 1900000000n, 10n, {});
  expect(session.frameLagMs(panel)).toBe(100);
  advance(5);
  expect(session.frameLagMs(panel)).toBe(3100);
  unbind();
  expect(session.frameLagMs(panel)).toBeUndefined();
});

it("counts a seek that expired before a panel closed, including with diagnostics hidden", () => {
  const session = new PlaybackDiagnostics();
  const unbind = session.bind("left", "/camera");
  session.update(
    mockPlayerState(undefined, {
      acceptedSeek: { sequence: 1, started: performance.now() - 10001, target: fromSec(1) },
    }),
  );
  unbind();
  expect(session.panel("left", "/camera")).toMatchObject({ timeouts: 1, cancelled: 0 });
});

it("starts a new speed sample when a slow seek acknowledges its target before backfill", () => {
  const session = new PlaybackDiagnostics();
  const initial = { currentTime: fromSec(1), lastSeekTime: 1, isPlaying: true };
  session.update(mockPlayerState(undefined, initial), 0);
  const ack = {
    ...initial,
    currentTime: fromSec(100),
    acceptedSeek: { sequence: 1, started: 400, target: fromSec(100) },
  };
  session.update(mockPlayerState(undefined, ack), 500);
  expect(session.actualSpeed).toBeUndefined();
  session.update(mockPlayerState(undefined, { ...ack, lastSeekTime: 2 }), 600);
  expect(session.actualSpeed).toBeUndefined();
  session.update(
    mockPlayerState(undefined, { ...ack, lastSeekTime: 2, currentTime: fromSec(101) }),
    1600,
  );
  expect(session.actualSpeed).toBe(1);
});
