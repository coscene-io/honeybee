// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

import {
  cameraFrameStrip,
  cameraStepTarget,
  segmentationCameraStep,
  segmentationPlaybackStep,
  sortCameraFrames,
} from "./cameraFrames";
import { type SegmentationRuntime } from "./runtime";
import { mainSegmentationCanvas } from "./segmentationChrome";
import { type SourceFrameLoader } from "./sourceFrames";
import { testHost, installSegmentationTestHost } from "./testing/host";
import type { SegmentationFrame } from "./types";

installSegmentationTestHost();

const BASE = 1_774_926_583_000_000_000n;

/** Real-looking head camera gaps (ns): 30–36 ms with one 55 ms gap. */
const GAPS = [33_197_332n, 30_510_005n, 35_814_573n, 55_474_087n, 32_303_124n, 33_420_802n];

function frames(videoId: string, count: number, start = BASE): SegmentationFrame[] {
  const result: SegmentationFrame[] = [];
  let at = start;
  for (let index = 0; index < count; index++) {
    result.push({
      id: `${videoId}:${at}`,
      videoId,
      index: 0,
      timestampSec: 0,
      logTimeNs: at.toString(),
      imageUrl: "",
    });
    at += GAPS[index % GAPS.length]!;
  }
  return result;
}

/** Reverses neighbouring pairs, like the stream's backward steps around 39.18 s. */
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = 0; index + 1 < copy.length; index += 2) {
    [copy[index], copy[index + 1]] = [copy[index + 1]!, copy[index]!];
  }
  return copy.reverse();
}

const loadedEverywhere = () => true;

describe("sortCameraFrames", () => {
  it("orders by log time, not by arrival order, and drops duplicate times", () => {
    const head = frames("head", 6);
    const sorted = sortCameraFrames([...shuffled(head), head[2]!]);
    expect(sorted.map((frame) => frame.id)).toEqual(head.map((frame) => frame.id));
  });
});

describe("cameraFrameStrip", () => {
  const head = frames("head", 60);
  const current = head[30]!;

  it("lists 20 real frames on each side of the shown frame with annotation states", () => {
    const annotated = new Set([head[29]!.id, head[30]!.id, head[45]!.id]);
    const cells = cameraFrameStrip({
      frames: shuffled(head),
      currentFrameId: current.id,
      isAnnotated: (id) => annotated.has(id),
      isLoaded: loadedEverywhere,
    });
    expect(cells).toHaveLength(41);
    expect(cells[20]).toMatchObject({ offset: 0, frameId: current.id, state: "annotated" });
    expect(cells[19]).toMatchObject({ offset: -1, logTimeNs: head[29]!.logTimeNs });
    expect(cells[19]!.state).toBe("annotated");
    expect(cells[21]!.state).toBe("empty");
    expect(cells[35]).toMatchObject({ offset: 15, frameId: head[45]!.id, state: "annotated" });
    expect(cells[0]).toMatchObject({ offset: -20, frameId: head[10]!.id });
    expect(cells[40]).toMatchObject({ offset: 20, frameId: head[50]!.id });
  });

  it("shows unread source as unloaded, never as absent", () => {
    const boundary = BigInt(head[33]!.logTimeNs);
    const cells = cameraFrameStrip({
      // Only the frames up to +3 are known; the cache may still hold one later frame.
      frames: [...head.slice(0, 34), head[50]!],
      currentFrameId: current.id,
      isAnnotated: () => false,
      isLoaded: (_from, to) => to <= boundary,
    });
    expect(cells.slice(21, 24).map((cell) => cell.state)).toEqual(["empty", "empty", "empty"]);
    expect(cells.slice(24).every((cell) => cell.state === "unloaded")).toBe(true);
    expect(cells.slice(24).some((cell) => cell.frameId != undefined)).toBe(false);
  });

  it("marks the recording edge as outside once everything there has been read", () => {
    const cells = cameraFrameStrip({
      frames: head,
      currentFrameId: head[2]!.id,
      isAnnotated: () => false,
      isLoaded: loadedEverywhere,
    });
    expect(cells.slice(0, 18).every((cell) => cell.state === "outside")).toBe(true);
    expect(cells[18]).toMatchObject({ offset: -2, frameId: head[0]!.id });
  });

  it("without a loader (read-only overview) only the shown frame is known", () => {
    const cells = cameraFrameStrip({
      frames: head,
      currentFrameId: current.id,
      isAnnotated: () => true,
    });
    expect(cells.filter((cell) => cell.state === "unloaded")).toHaveLength(40);
    expect(cells[20]!.state).toBe("annotated");
  });
});

describe("cameraStepTarget", () => {
  const head = frames("head", 30);
  it("steps to the adjacent real frame across irregular, out-of-order times", () => {
    const list = shuffled(head);
    const at = BigInt(head[3]!.logTimeNs);
    expect(cameraStepTarget(list, at, 1, 1)).toBe(BigInt(head[4]!.logTimeNs));
    expect(cameraStepTarget(list, at, -1, 1)).toBe(BigInt(head[2]!.logTimeNs));
    // The 55 ms gap after frame 3 is still one step.
    expect(BigInt(head[4]!.logTimeNs) - at).toBe(55_474_087n);
  });

  it("counts whole frames and stops at the ends", () => {
    const at = BigInt(head[5]!.logTimeNs);
    expect(cameraStepTarget(head, at, 1, 10)).toBe(BigInt(head[15]!.logTimeNs));
    expect(cameraStepTarget(head, at, -1, 10)).toBe(BigInt(head[0]!.logTimeNs));
    expect(cameraStepTarget(head, BigInt(head[29]!.logTimeNs), 1, 1)).toBeUndefined();
  });

  it("works from a time between frames", () => {
    const between = BigInt(head[3]!.logTimeNs) + 1n;
    expect(cameraStepTarget(head, between, 1, 1)).toBe(BigInt(head[4]!.logTimeNs));
    expect(cameraStepTarget(head, between, -1, 1)).toBe(BigInt(head[3]!.logTimeNs));
  });
});

describe("mainSegmentationCanvas", () => {
  it("picks the largest canvas, first on ties", () => {
    const canvas = (panelId: string, area: number) => ({
      panelId,
      enterInline: () => {},
      enterMaximize: () => {},
      area: () => area,
    });
    expect(
      mainSegmentationCanvas([canvas("stereo", 70_000), canvas("head", 630_000), canvas("t", 1)])
        ?.panelId,
    ).toBe("head");
    expect(mainSegmentationCanvas([canvas("a", 5), canvas("b", 5)])?.panelId).toBe("a");
  });
});

describe("segmentationPlaybackStep", () => {
  const head = frames("head", 40);
  const stereo = frames("stereo", 40, BASE + 6_806_029n);
  const ensured: Array<[string, bigint, number]> = [];

  function openSession(panelId: string, shown: Record<string, string>) {
    const store = createStore(() => ({
      document: { frames: [...shuffled(head), ...stereo] },
      drawing: undefined as { instanceId: string; frameId: string } | undefined,
      propagation: { status: "idle" },
    }));
    testHost().chrome.setState({
      canvases: [
        {
          panelId: "Image!head",
          topic: "/camera/head_rgbd/h264",
          enterInline() {},
          enterMaximize() {},
        },
        {
          panelId: "Image!stereo",
          topic: "/camera/head_stereo/h264",
          enterInline() {},
          enterMaximize() {},
        },
      ],
    });
    testHost().session.setState({
      open: true,
      runtime: { store } as unknown as SegmentationRuntime,
      panelId,
      surfaces: Object.fromEntries(
        Object.entries(shown).map(([id, frameId]) => [id, { frameId, sourceReady: true }]),
      ),
    });
    return store;
  }

  beforeEach(() => {
    ensured.length = 0;
    for (const videoId of ["head", "stereo"]) {
      testHost().sourceFrames.register({
        videoId,
        ensureRange: async () => {},
        ensurePreceding: async () => {},
        ensureFollowing: async (from: bigint, count: number) => {
          ensured.push([videoId, from, count]);
        },
        isLoaded: () => true,
        subscribe: () => () => {},
        dispose: () => {},
      } satisfies SourceFrameLoader);
    }
  });
  afterEach(() => {
    testHost().session.setState({
      open: false,
      runtime: undefined,
      panelId: undefined,
      surfaces: {},
    });
    testHost().chrome.setState({ canvases: [] });
  });

  it("keeps the player's own step, modifiers included, outside annotation", () => {
    const seek = jest.fn();
    const modifiers = { altKey: true, shiftKey: false };
    expect(segmentationPlaybackStep(testHost(), 1, modifiers, seek)).toEqual({
      handled: false,
      modifiers,
    });
    expect(segmentationCameraStep(testHost(), 1)).toBeUndefined();
    expect(seek).not.toHaveBeenCalled();
  });

  it("steps the target camera to its exact next and previous log time", async () => {
    openSession("Image!head", { "Image!head": head[10]!.id, "Image!stereo": stereo[10]!.id });
    const seek = jest.fn();
    expect(segmentationPlaybackStep(testHost(), 1, undefined, seek)).toEqual({ handled: true });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seek).toHaveBeenLastCalledWith(BigInt(head[11]!.logTimeNs));
    expect(ensured[0]).toEqual(["head", BigInt(head[10]!.logTimeNs), 1]);
    // A step that was never displayed must not shift the next one.
    testHost().cameraStep.pending = undefined;
    await segmentationCameraStep(testHost(), -1)!.then((target) => {
      expect(target).toBe(BigInt(head[9]!.logTimeNs));
    });
  });

  it("Shift steps ten frames; Alt falls back to the default fixed step", async () => {
    openSession("Image!head", { "Image!head": head[10]!.id });
    const seek = jest.fn();
    segmentationPlaybackStep(testHost(), 1, { altKey: false, shiftKey: true }, seek);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seek).toHaveBeenLastCalledWith(BigInt(head[20]!.logTimeNs));
    expect(
      segmentationPlaybackStep(testHost(), 1, { altKey: true, shiftKey: false }, seek),
    ).toEqual({
      handled: false,
      modifiers: { altKey: false, shiftKey: false },
    });
  });

  it("follows the target canvas: selecting a stereo polygon retargets stepping", async () => {
    openSession("Image!head", { "Image!head": head[10]!.id, "Image!stereo": stereo[20]!.id });
    testHost().session.setState({ panelId: "Image!stereo" });
    await expect(segmentationCameraStep(testHost(), 1)).resolves.toBe(
      BigInt(stereo[21]!.logTimeNs),
    );
  });

  it("keeps moving on repeated presses before the stepped frame is shown", async () => {
    openSession("Image!head", { "Image!head": head[10]!.id });
    await expect(segmentationCameraStep(testHost(), 1)).resolves.toBe(BigInt(head[11]!.logTimeNs));
    await expect(segmentationCameraStep(testHost(), 1)).resolves.toBe(BigInt(head[12]!.logTimeNs));
    testHost().session.setState({
      surfaces: { "Image!head": { frameId: head[12]!.id, sourceReady: true } },
    });
    await expect(segmentationCameraStep(testHost(), 1)).resolves.toBe(BigInt(head[13]!.logTimeNs));
  });

  it("steps from the player clock while the camera shows no frame for it", async () => {
    // Annotated at frame 30, then the timeline was dragged to the recording start, before any
    // camera frame: the surface still names frame 30 but has nothing decoded.
    openSession("Image!head", { "Image!head": head[30]!.id });
    testHost().session.setState({
      surfaces: { "Image!head": { frameId: head[30]!.id, sourceReady: false } },
    });
    const start = BigInt(head[0]!.logTimeNs) - 50_000_000n;
    const seek = jest.fn();
    segmentationPlaybackStep(testHost(), 1, undefined, seek, start);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seek).toHaveBeenLastCalledWith(BigInt(head[0]!.logTimeNs));
    expect(ensured.at(-1)).toEqual(["head", start, 1]);
    // Backward from the start: no earlier frame, so nothing moves.
    seek.mockClear();
    segmentationPlaybackStep(testHost(), -1, undefined, seek, start);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seek).not.toHaveBeenCalled();
  });

  it("keeps stepping from a requested frame while it decodes", async () => {
    openSession("Image!head", { "Image!head": head[10]!.id });
    const clock = BigInt(head[10]!.logTimeNs);
    await expect(segmentationCameraStep(testHost(), 1, 1, clock)).resolves.toBe(
      BigInt(head[11]!.logTimeNs),
    );
    // The seek is under way: the old frame is no longer ready and the clock has not moved yet.
    testHost().session.setState({
      surfaces: { "Image!head": { frameId: head[10]!.id, sourceReady: false } },
    });
    await expect(segmentationCameraStep(testHost(), 1, 1, clock)).resolves.toBe(
      BigInt(head[12]!.logTimeNs),
    );
    await expect(
      segmentationCameraStep(testHost(), 1, 1, BigInt(head[12]!.logTimeNs)),
    ).resolves.toBe(BigInt(head[13]!.logTimeNs));
  });

  it("does not move while a polygon is being drawn", async () => {
    const store = openSession("Image!head", { "Image!head": head[10]!.id });
    store.setState({ drawing: { instanceId: "instance-1", frameId: head[10]!.id } });
    const seek = jest.fn();
    expect(segmentationPlaybackStep(testHost(), 1, undefined, seek)).toEqual({ handled: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seek).not.toHaveBeenCalled();
  });

  describe("a step whose frames are still being read", () => {
    let release: (error?: Error) => void = () => {};
    beforeEach(() => {
      testHost().sourceFrames.register({
        videoId: "head",
        ensureRange: async () => {},
        ensurePreceding: async () => {},
        ensureFollowing: async () => {
          await new Promise<void>((resolve, reject) => {
            release = (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            };
          });
        },
        isLoaded: () => true,
        subscribe: () => () => {},
        dispose: () => {},
      } satisfies SourceFrameLoader);
    });
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    it.each([
      [
        "the session ends",
        () => {
          testHost().session.setState({ open: false });
        },
      ],
      [
        "another canvas takes the edit",
        () => {
          testHost().session.setState({ panelId: "Image!stereo" });
        },
      ],
      [
        "a seek makes the retained frame unavailable",
        () => {
          testHost().session.setState({
            surfaces: { "Image!head": { frameId: head[10]!.id, sourceReady: false } },
          });
        },
      ],
      [
        "the canvas shows another frame",
        () => {
          testHost().session.setState({
            surfaces: { "Image!head": { frameId: head[25]!.id, sourceReady: true } },
          });
        },
      ],
    ])("does not jump late when %s", async (_case, change) => {
      openSession("Image!head", { "Image!head": head[10]!.id });
      const seek = jest.fn();
      segmentationPlaybackStep(testHost(), 1, undefined, seek);
      change();
      release();
      await settle();
      expect(seek).not.toHaveBeenCalled();
    });

    it("drops a step when the playback seek generation changes before the surface updates", async () => {
      openSession("Image!head", { "Image!head": head[10]!.id });
      let playbackCurrent = true;
      const step = segmentationCameraStep(testHost(), 1, 1, undefined, () => playbackCurrent);
      playbackCurrent = false;
      release();
      await expect(step).resolves.toBeUndefined();
    });

    it("does not jump late once propagation holds the editor", async () => {
      const store = openSession("Image!head", { "Image!head": head[10]!.id });
      const seek = jest.fn();
      segmentationPlaybackStep(testHost(), 1, undefined, seek);
      store.setState({ propagation: { status: "running" } });
      release();
      await settle();
      expect(seek).not.toHaveBeenCalled();
    });

    it("keeps only the newest of overlapping steps", async () => {
      openSession("Image!head", { "Image!head": head[10]!.id });
      const first = segmentationCameraStep(testHost(), 1)!;
      const releaseFirst = release;
      const second = segmentationCameraStep(testHost(), 1)!;
      releaseFirst();
      release();
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBe(BigInt(head[11]!.logTimeNs));
    });

    it("reports a failed read and still steps within the frames already known", async () => {
      const store = openSession("Image!head", { "Image!head": head[10]!.id }) as unknown as {
        getState: () => { error?: string };
      };
      const seek = jest.fn();
      segmentationPlaybackStep(testHost(), 1, undefined, seek);
      release(new Error("network down"));
      await settle();
      expect(store.getState().error).toBe(
        "Could not read the next frames of this camera: network down",
      );
      expect(seek).toHaveBeenLastCalledWith(BigInt(head[11]!.logTimeNs));
    });
  });
});
