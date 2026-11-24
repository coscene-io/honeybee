// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { maskIou } from "../maskCodec";
import { maskOf, polygonsOf, runsOfMask } from "../maskGeometry";
import {
  DEFAULT_MOCK_MASK_PROFILE,
  propagateMockMask,
  synthesizeMockMask,
  validateMockMaskProfile,
} from "./mockMasks";
import { createMockSemanticSegmentationService, createSeedDocument } from "./mockService";
import { frameInstanceKey } from "../service";

const profile = { ...DEFAULT_MOCK_MASK_PROFILE, instances: 2 };

describe("MOCK masks", () => {
  it("are deterministic, bound to the decoded size and continuous in source time", () => {
    const a = synthesizeMockMask(profile, 0, 1, 3.2, 1280, 720);
    expect(synthesizeMockMask(profile, 0, 1, 3.2, 1280, 720)).toEqual(a);
    expect(a).toMatchObject({ width: 1280, height: 720, source: "mock" });
    const runs = runsOfMask(a);
    expect(runs.area).toBeGreaterThan(1000);
    const next = runsOfMask(synthesizeMockMask(profile, 0, 1, 3.2 + 1 / 30, 1280, 720));
    const iou = maskIou(runs, next);
    expect(iou).toBeGreaterThan(0.8);
    expect(iou).toBeLessThan(1);
    // A different camera size re-maps the same shape instead of reusing counts.
    expect(() => runsOfMask({ ...a, width: 960, height: 540 })).toThrow(/bound 960×540/);
  });

  it("bounds the instance count to what the overlay can draw", () => {
    expect(() => validateMockMaskProfile({ ...profile, instances: 65 })).toThrow(/bounded/);
  });

  it("propagates the seed pixels 10 px per frame", () => {
    const seed = synthesizeMockMask(profile, 1, 0, 0, 1280, 720);
    const moved = runsOfMask(propagateMockMask({ kind: "mask", mask: seed }, seed, 2));
    const original = runsOfMask(seed);
    expect(moved.bbox!.x0).toBe(original.bbox!.x0 + 20);
    expect(moved.bbox!.y0).toBe(original.bbox!.y0 + 20);
  });
});

describe("mock service with MOCK masks", () => {
  function service(storage?: Map<string, string>) {
    return createMockSemanticSegmentationService({
      document: createSeedDocument(),
      controls: { delayMs: 0, streamDelayMs: 0 },
      mockMasks: profile,
      ...(storage
        ? {
            storage: {
              getItem: (key: string) => storage.get(key) ?? null, // eslint-disable-line no-restricted-syntax
              setItem: (key: string, value: string) => storage.set(key, value),
              removeItem: (key: string) => storage.delete(key),
            },
            storageKey: "test",
          }
        : {}),
    });
  }

  it("serves masks for loaded windows, never persists untouched ones, and honours deletes", async () => {
    const storage = new Map<string, string>();
    const mock = service(storage);
    const frameWindow = await mock.loadFrameWindow("video-side", 0, 1);
    const key = frameInstanceKey("side-0", "mock-mask-0");
    expect(maskOf(frameWindow.annotations[key])).toMatchObject({
      width: 1280,
      height: 720,
      source: "mock",
    });
    expect(polygonsOf(frameWindow.annotations[key])).toEqual([]);

    await mock.submit({
      id: "delete-1",
      message: "delete one mock observation",
      operations: [
        { id: "op", labelKey: "opLabelEditPolygon", patch: { annotations: { [key]: undefined } } },
      ],
    });
    const saved = storage.get("test")!;
    expect(saved).not.toContain('"source":"mock"');

    const reloaded = service(storage);
    const again = await reloaded.loadFrameWindow("video-side", 0, 1);
    expect(again.annotations[key]).toBeUndefined();
    expect(maskOf(again.annotations[frameInstanceKey("side-1", "mock-mask-0")])?.source).toBe(
      "mock",
    );
  });

  it("propagates a mask seed as masks", async () => {
    const mock = service();
    await mock.loadFrameWindow("video-side", 0, 2);
    const results = [];
    for await (const result of mock.propagate(
      {
        instanceId: "mock-mask-1",
        fromFrameId: "side-0",
        endTimeNs: String(1_700_000_000_000_000_000n + 2n * 200_000_000n),
      },
      new AbortController().signal,
    )) {
      results.push(result);
    }
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.kind).toBe("mask");
      expect(maskOf(result.kind === "empty" ? undefined : result)).toMatchObject({
        width: 1280,
        height: 720,
        source: "propagation",
      });
    }
  });
});
