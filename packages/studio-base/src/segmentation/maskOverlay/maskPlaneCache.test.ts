// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MaskPlaneCache } from "./maskPlaneCache";
import { planeBytes } from "./maskPlanes";
import { encodeCounts } from "../maskCodec";
import maskFixture from "../testing/fixtures/masks.json";

function geometryOf(id: number, counts: readonly string[], logTimeNs = String(id)) {
  return { id, topic: "/camera", logTimeNs, width: 1280, height: 720, instanceIds: [], counts };
}

async function settle(cache: MaskPlaneCache, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  void cache;
}

describe("mask plane cache", () => {
  it("splits the prefetch budget between panels so their sets fit together", () => {
    const frame = planeBytes(1280, 720, 3); // R8UI, ~0.9 MB
    const cache = new MaskPlaneCache(undefined, 96 * 1024 * 1024);
    const panels = Array.from({ length: 5 }, () => ({}));
    const release = panels.map((panel) => cache.addConsumer(panel));
    panels.forEach((panel) => {
      cache.updateConsumer(panel, { active: true });
    });
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
    panels.forEach((panel) => {
      cache.updateConsumer(panel, { active: true });
    });
    const ahead = cache.framesAhead(frame, 8);
    // One "render" of every panel: draw the displayed frame, prefetch its share.
    const renderAll = () => {
      sets.forEach((set, index) => {
        cache.updateConsumer(panels[index]!, { active: true, displayed: set[0]!.id });
      });
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

describe("mask plane cache budget and failures", () => {
  const counts = maskFixture.cases.slice(0, 3).map((item) => item.counts);
  const frame = planeBytes(1280, 720, counts.length);

  it("splits prefetch only between panels that have masks", () => {
    const cache = new MaskPlaneCache(undefined, 96 * 1024 * 1024);
    const panels = Array.from({ length: 6 }, () => ({}));
    panels.forEach((panel) => cache.addConsumer(panel));
    panels.forEach((panel, index) => {
      cache.updateConsumer(panel, { active: index < 2 });
    });
    const twoActive = cache.framesAhead(frame, 200);
    panels.forEach((panel) => {
      cache.updateConsumer(panel, { active: true });
    });
    // Four panels on other topics or unannotated frames no longer shrink the masked ones' share.
    expect(twoActive).toBeGreaterThan(cache.framesAhead(frame, 200));
    expect(twoActive).toBe(Math.floor((96 * 1024 * 1024 * 0.75) / 2 / frame) - 1);
    cache.dispose();
  });

  it("never evicts a frame a panel is drawing, so masks do not blink when the budget is tight", async () => {
    // Room for four frames only; six panels each draw their own frame and prefetch more.
    const cache = new MaskPlaneCache(undefined, 4 * frame);
    const panels = Array.from({ length: 6 }, () => ({}));
    panels.forEach((panel) => cache.addConsumer(panel));
    const displayed = panels.map((_, index) => geometryOf(index + 1, counts));
    panels.forEach((panel, index) => {
      cache.updateConsumer(panel, { active: true, displayed: displayed[index]!.id });
      cache.get(displayed[index]!);
    });
    await settle(cache);
    for (let id = 100; id < 110; id++) {
      cache.request(geometryOf(id, counts));
    }
    await settle(cache);
    for (const geometry of displayed) {
      expect(cache.get(geometry)).toBeDefined();
    }
    expect(cache.stats.cachedBytes).toBeGreaterThan(4 * frame);
    cache.dispose();
  });

  it("retries a failed build after a delay, but not a permanent failure", async () => {
    let now = 0;
    const cache = new MaskPlaneCache(undefined, 96 * 1024 * 1024, () => now);
    const bad = geometryOf(1, ["not RLE \u0000"]);
    cache.get(bad);
    await settle(cache);
    expect(cache.error(bad)).toBeDefined();
    const errors = cache.stats.errors;
    cache.get(bad);
    await settle(cache);
    expect(cache.stats.errors).toBe(errors);
    now += 5000;
    cache.get(bad);
    await settle(cache);
    expect(cache.stats.errors).toBe(errors + 1);

    const huge = {
      ...geometryOf(
        2,
        Array.from({ length: 17 }, () => encodeCounts([0, 3840 * 2160])),
      ),
      width: 3840,
      height: 2160,
    };
    cache.request(huge);
    now += 5000;
    cache.request(huge);
    expect(cache.error(huge)).toBe("Mask planes exceed the cache budget");
    expect(cache.stats.errors).toBe(errors + 2);
    cache.dispose();
  });

  it("falls back to main-thread builds when the worker cannot deliver a reply", async () => {
    const worker = {
      postMessage: jest.fn(),
      terminate: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      onerror: undefined as unknown,
      onmessageerror: undefined as ((event: MessageEvent) => void) | undefined,
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const OriginalWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = function Worker() {};
    try {
      const cache = new MaskPlaneCache(() => worker as unknown as Worker);
      const geometry = geometryOf(1, counts);
      expect(cache.get(geometry)).toBeUndefined();
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      worker.onmessageerror!(new MessageEvent("messageerror"));
      expect(worker.terminate).toHaveBeenCalled();
      await settle(cache);
      expect(cache.get(geometry)?.areas).toHaveLength(3);
      // The fallback is reported, not silent.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("building masks on the main thread"),
        undefined,
      );
      cache.dispose();
    } finally {
      warn.mockRestore();
      (globalThis as { Worker?: unknown }).Worker = OriginalWorker;
    }
  });
});
