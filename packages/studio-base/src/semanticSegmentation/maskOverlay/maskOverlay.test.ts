// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import maskFixture from "../fixtures/detSegMasks.json";
import { maskContains, maskRunsFromCounts } from "../maskCodec";
import { DEFAULT_MOCK_MASK_PROFILE, synthesizeMockMask } from "../mockMasks";
import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { frameInstanceKey } from "../service";
import { MaskPlaneCache } from "./maskPlaneCache";
import { buildMaskPlanes, planeBytes, planeFormat } from "./maskPlanes";
import { createMaskOverlaySource, maskOverlayControls } from "./overlaySource";

describe("mask bit planes", () => {
  it("stores every slot as one bit of a transposed texel, overlaps included", () => {
    const cases = maskFixture.cases.slice(0, 10);
    const planes = buildMaskPlanes(
      1280,
      720,
      cases.map((item) => item.counts),
    );
    expect(planes.format).toBe("R16UI");
    expect(planes.areas).toEqual(cases.map((item) => item.area));
    const plane = planes.planes[0]!;
    cases.forEach((item, slot) => {
      const runs = maskRunsFromCounts(item.counts, 1280, 720);
      // Sample pixels inside and outside the bbox; the texel at x * height + y is pixel (x, y).
      for (let k = 0; k < 200; k++) {
        const x = (k * 97 + slot * 13) % 1280;
        const y = (k * 61 + slot * 7) % 720;
        expect(((plane[x * 720 + y]! >> slot) & 1) === 1).toBe(maskContains(runs, x, y));
      }
      const box = runs.bbox!;
      const cx = Math.floor((box.x0 + box.x1) / 2);
      for (let y = box.y0; y <= box.y1; y++) {
        expect(((plane[cx * 720 + y]! >> slot) & 1) === 1).toBe(maskContains(runs, cx, y));
      }
    });
  });

  it("chooses the narrowest integer format and rejects a wrong size", () => {
    expect([1, 8, 9, 16, 17, 32, 33, 64].map(planeFormat)).toEqual([
      "R8UI",
      "R8UI",
      "R16UI",
      "R16UI",
      "R32UI",
      "R32UI",
      "R32UI",
      "R32UI",
    ]);
    expect(planeBytes(1280, 720, 3)).toBe(1280 * 720);
    expect(planeBytes(1280, 720, 40)).toBe(1280 * 720 * 8);
    expect(() => buildMaskPlanes(640, 360, [maskFixture.cases[0]!.counts])).toThrow(/640×360/);
    const many = buildMaskPlanes(
      1280,
      720,
      Array.from({ length: 40 }, (_, i) => maskFixture.cases[i % 18]!.counts),
    );
    expect(many.planes).toHaveLength(2);
    expect(many.areas[39]).toBe(maskFixture.cases[39 % 18]!.area);
  });

  it("splits the prefetch budget between panels so their sets fit together", () => {
    const frame = planeBytes(1280, 720, 3); // R8UI, ~0.9 MB
    const cache = new MaskPlaneCache(undefined, 96 * 1024 * 1024);
    const panels = Array.from({ length: 5 }, () => ({}));
    const release = panels.map((panel) => cache.addConsumer(panel));
    const ahead = cache.framesAhead(frame, 24);
    // Five cameras, each keeping the displayed frame and `ahead` more, stay within the budget.
    expect(5 * (ahead + 1) * frame).toBeLessThanOrEqual(96 * 1024 * 1024);
    expect(ahead).toBeGreaterThanOrEqual(8);
    // Larger planes (40 instances: two R32UI planes) get fewer frames, never a negative count.
    expect(cache.framesAhead(planeBytes(1280, 720, 40), 24)).toBeLessThan(ahead);
    expect(cache.framesAhead(10 * 96 * 1024 * 1024, 24)).toBe(0);
    // One panel left: it may use more of the cache, still capped by what it asked for.
    release.slice(1).forEach((done) => {
      done();
    });
    expect(cache.framesAhead(frame, 24)).toBe(24);
    cache.dispose();
  });

  it("settles when every panel prefetches its share (no rebuild loop while paused)", async () => {
    const counts = maskFixture.cases.slice(0, 3).map((item) => item.counts);
    const frame = planeBytes(1280, 720, counts.length);
    // Room for 5 panels × 4 frames; asking for 8 ahead each would thrash forever.
    const cache = new MaskPlaneCache(undefined, Math.ceil((5 * 4 * frame) / 0.75));
    const panels = Array.from({ length: 5 }, () => ({}));
    panels.forEach((panel) => cache.addConsumer(panel));
    let nextId = 1;
    const sets = panels.map(() =>
      Array.from({ length: 9 }, (_, i) => ({
        id: nextId++,
        topic: "/camera",
        logTimeNs: String(i),
        width: 1280,
        height: 720,
        instanceIds: ["a", "b", "c"],
        counts,
      })),
    );
    const ahead = cache.framesAhead(frame, 8);
    // One "render" of every panel: draw the displayed frame, prefetch its share.
    const renderAll = () => {
      for (const set of sets) {
        cache.get(set[0]!);
        for (const geometry of set.slice(1, 1 + ahead)) {
          cache.request(geometry);
        }
      }
    };
    let built = -1;
    for (let pass = 0; pass < 6 && built !== cache.stats.built; pass++) {
      built = cache.stats.built;
      renderAll();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // Converged: another render requests nothing new and every displayed frame is cached.
    expect(cache.stats.built).toBe(built);
    expect(cache.stats.evicted).toBe(0);
    sets.forEach((set) => {
      expect(cache.get(set[0]!)).toBeDefined();
    });
    cache.dispose();
  });

  it("builds off the render path, then serves cached planes", async () => {
    const cache = new MaskPlaneCache(undefined);
    const geometry = {
      id: 1,
      topic: "/camera",
      logTimeNs: "1",
      width: 1280,
      height: 720,
      instanceIds: ["a"],
      counts: [maskFixture.cases[3]!.counts],
    };
    const ready = new Promise<void>((resolve) => cache.onReady(resolve));
    expect(cache.get(geometry)).toBeUndefined();
    expect(cache.stats.misses).toBe(1);
    await ready;
    expect(cache.get(geometry)?.areas).toEqual([maskFixture.cases[3]!.area]);
    expect(cache.stats.hits).toBe(1);
    cache.dispose();
  });
});

describe("mask overlay source", () => {
  afterEach(() => {
    segmentationSession.setState({ previewRuntime: undefined, runtime: undefined, open: false });
    maskOverlayControls.setState({ opacity: 0.35, peekOriginal: false });
  });

  it("binds masks to exact topic + log time, keeps geometry ids across style changes", async () => {
    const document = createSeedDocument();
    const frame = document.frames.find((item) => item.videoId === "video-side")!;
    const video = document.videos.find((item) => item.id === "video-side")!;
    const mask = synthesizeMockMask(DEFAULT_MOCK_MASK_PROFILE, 0, 0, 0, 1280, 720);
    document.annotations[frameInstanceKey(frame.id, "instance-side")] = {
      frameId: frame.id,
      instanceId: "instance-side",
      kind: "mask",
      mask,
    };
    const runtime = createSegmentationRuntime(document);
    runtime.store.setState({ document });
    segmentationSession.setState({ previewRuntime: runtime, open: false });
    const source = createMaskOverlaySource();
    const topic = video.topic!;
    const shown = source.frame(topic, frame.logTimeNs);
    expect(shown?.geometry).toMatchObject({
      width: 1280,
      height: 720,
      instanceIds: ["instance-side"],
      counts: [mask.counts],
    });
    expect(shown?.style.visible).toEqual([true]);
    // One nanosecond off is a different frame: nothing, never a neighbour.
    expect(source.frame(topic, (BigInt(frame.logTimeNs) + 1n).toString())).toBeUndefined();

    segmentationSession.setState({ runtime, open: true });
    runtime.store.setState({ viewMode: "instance", focus: undefined });
    const hidden = source.frame(topic, frame.logTimeNs);
    expect(hidden?.geometry.id).toBe(shown?.geometry.id);
    expect(hidden?.style.visible).toEqual([false]);
    runtime.store.setState({ viewMode: "all", focus: { type: "instance", id: "instance-side" } });
    expect(source.frame(topic, frame.logTimeNs)?.style.selected).toEqual([true]);
    maskOverlayControls.setState({ peekOriginal: true });
    expect(source.frame(topic, frame.logTimeNs)?.style.visible).toEqual([false]);

    // Playback registers frames every frame: a new frame list must keep built planes (same id)...
    const id = source.frame(topic, frame.logTimeNs)!.geometry.id;
    const extra = { ...frame, id: "extra", logTimeNs: (BigInt(frame.logTimeNs) + 7n).toString() };
    runtime.store.setState({ document: { ...document, frames: [...document.frames, extra] } });
    expect(source.frame(topic, frame.logTimeNs)?.geometry.id).toBe(id);
    // ...while changed counts always get a new one, so a stale plane is never drawn.
    const moved = synthesizeMockMask(DEFAULT_MOCK_MASK_PROFILE, 0, 0, 5, 1280, 720);
    const key = frameInstanceKey(frame.id, "instance-side");
    const current = runtime.store.getState().document!;
    runtime.store.setState({
      document: {
        ...current,
        frames: [...current.frames],
        annotations: {
          ...current.annotations,
          [key]: { ...current.annotations[key]!, kind: "mask", mask: moved },
        },
      },
    });
    expect(moved.counts).not.toBe(mask.counts);
    expect(source.frame(topic, frame.logTimeNs)?.geometry.id).not.toBe(id);
    runtime.dispose();
  });

  it("finds frames registered after the first lookup (read-only preview lists them late)", () => {
    const document = createSeedDocument();
    const template = document.frames.find((item) => item.videoId === "video-side")!;
    const topic = document.videos.find((item) => item.id === "video-side")!.topic!;
    const runtime = createSegmentationRuntime(document);
    runtime.store.setState({ document });
    segmentationSession.setState({ previewRuntime: runtime, open: false });
    const source = createMaskOverlaySource();
    const at = (offset: bigint) => ({
      ...template,
      id: `late-${offset}`,
      logTimeNs: (BigInt(template.logTimeNs) + offset).toString(),
    });
    const withMask = (frame: ReturnType<typeof at>) => {
      const current = runtime.store.getState().document!;
      runtime.store.setState({
        document: {
          ...current,
          annotations: {
            ...current.annotations,
            [frameInstanceKey(frame.id, "instance-side")]: {
              frameId: frame.id,
              instanceId: "instance-side",
              kind: "mask",
              mask: synthesizeMockMask(DEFAULT_MOCK_MASK_PROFILE, 0, 0, 0, 1280, 720),
            },
          },
        },
      });
    };
    for (const offset of [11n, 22n]) {
      const frame = at(offset);
      expect(source.frame(topic, frame.logTimeNs)).toBeUndefined();
      // The runtime grows its frame list in place; the lookup must still see the new frame.
      runtime.registerSource({ videos: [], frames: [frame] });
      withMask(frame);
      expect(source.frame(topic, frame.logTimeNs)?.geometry.instanceIds).toEqual(["instance-side"]);
    }
    runtime.dispose();
  });

  it("prefetches a time window ahead, bounded by a minimum and maximum frame count", () => {
    const seed = createSeedDocument();
    const template = seed.frames.find((item) => item.videoId === "video-side")!;
    const topic = seed.videos.find((item) => item.id === "video-side")!.topic!;
    const base = 1_000_000_000_000n;
    const step = 33_333_333n;
    const frames = Array.from({ length: 40 }, (_, i) => ({
      ...template,
      id: `f${i}`,
      logTimeNs: (base + BigInt(i) * step).toString(),
    }));
    const annotations = { ...seed.annotations };
    for (const item of frames) {
      annotations[frameInstanceKey(item.id, "instance-side")] = {
        frameId: item.id,
        instanceId: "instance-side",
        kind: "mask",
        mask: synthesizeMockMask(DEFAULT_MOCK_MASK_PROFILE, 0, 0, 0, 1280, 720),
      };
    }
    const document = {
      ...seed,
      frames: [...seed.frames.filter((item) => item.videoId !== "video-side"), ...frames],
      annotations,
    };
    const runtime = createSegmentationRuntime(document);
    runtime.store.setState({ document });
    segmentationSession.setState({ previewRuntime: runtime, open: false });
    const source = createMaskOverlaySource();
    const at = frames[0]!.logTimeNs;
    const times = (horizonNs: bigint, minFrames = 8, maxFrames = 24) =>
      source.upcoming(topic, at, { minFrames, maxFrames, horizonNs }).map((item) => item.logTimeNs);
    // Rendering keeps up: the next few frames.
    expect(times(0n)).toEqual(frames.slice(1, 9).map((item) => item.logTimeNs));
    // Rendering skips frames: every frame within the horizon (0.3 s = 9 frames at 30 Hz).
    expect(times(300_000_000n)).toHaveLength(9);
    // Never more than the cap, whatever the horizon.
    expect(times(5_000_000_000n)).toHaveLength(24);
    // Between two registered frames, start at the next later one.
    expect(
      source
        .upcoming(topic, (BigInt(at) + 1n).toString(), {
          minFrames: 2,
          maxFrames: 2,
          horizonNs: 0n,
        })
        .map((item) => item.logTimeNs),
    ).toEqual([frames[1]!.logTimeNs, frames[2]!.logTimeNs]);
    runtime.dispose();
  });
});
