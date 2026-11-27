// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSegmentationMaskOverlay } from "../imageSource";
import { createSegmentationSession } from "../runtime";
import { createSegmentationHost } from "../segmentationHost";
import { frameInstanceKey } from "../service";
import {
  createMaskOverlayControls,
  createMaskOverlaySource,
  installMaskOverlaySource,
} from "./overlaySource";
import { DEFAULT_MOCK_MASK_PROFILE, synthesizeMockMask } from "../testing/mockMasks";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument } from "../testing/mockService";

describe("mask overlay source", () => {
  let host = createSegmentationHost();
  const overlaySource = () => createMaskOverlaySource({ session: host.session });
  beforeEach(() => {
    host = createSegmentationHost();
  });
  afterEach(() => {
    host.dispose();
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
    const runtime = createMockSegmentationRuntime(document);
    runtime.store.setState({ document });
    host.session.setState({ previewRuntime: runtime, open: false });
    const source = overlaySource();
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

    host.session.setState({ runtime, open: true });
    runtime.store.setState({ viewMode: "instance", focus: undefined });
    const hidden = source.frame(topic, frame.logTimeNs);
    expect(hidden?.geometry.id).toBe(shown?.geometry.id);
    expect(hidden?.style.visible).toEqual([false]);
    runtime.store.setState({ viewMode: "all", focus: { type: "instance", id: "instance-side" } });
    expect(source.frame(topic, frame.logTimeNs)?.style.selected).toEqual([true]);
    const activePanel = createMaskOverlayControls();
    const otherPanel = createMaskOverlayControls();
    activePanel.setState({ opacity: 0.2, peekOriginal: true });
    const active = source.frame(topic, frame.logTimeNs, activePanel.getState());
    const other = source.frame(topic, frame.logTimeNs, otherPanel.getState());
    expect(active?.style).toMatchObject({ opacity: 0.2, visible: [false] });
    expect(other?.style).toMatchObject({ opacity: 0.5, visible: [true] });
    expect(active?.geometry).toBe(other?.geometry);

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
    const runtime = createMockSegmentationRuntime(document);
    runtime.store.setState({ document });
    host.session.setState({ previewRuntime: runtime, open: false });
    const source = overlaySource();
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
    const runtime = createMockSegmentationRuntime(document);
    runtime.store.setState({ document });
    host.session.setState({ previewRuntime: runtime, open: false });
    const source = overlaySource();
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

describe("installed mask overlay source", () => {
  it("is published on the host's overlay, per host, and withdrawn on dispose", () => {
    const first = createSegmentationHost();
    const second = createSegmentationHost();
    expect(first.maskOverlay.get()).toBeDefined();
    expect(second.maskOverlay.get()).toBeDefined();
    expect(first.maskOverlay.get()).not.toBe(second.maskOverlay.get());
    const changed = jest.fn();
    first.maskOverlay.subscribe(changed);
    first.session.setState({ open: true });
    expect(changed).toHaveBeenCalled();
    first.dispose();
    expect(first.maskOverlay.get()).toBeUndefined();
    expect(second.maskOverlay.get()).toBeDefined();
    second.dispose();
  });

  it("stops watching the session once uninstalled", () => {
    const session = createSegmentationSession();
    const overlay = createSegmentationMaskOverlay();
    const uninstall = installMaskOverlaySource({ session, overlay });
    const changed = jest.fn();
    overlay.subscribe(changed);
    uninstall();
    changed.mockClear();
    session.setState({ open: true });
    expect(changed).not.toHaveBeenCalled();
  });
});
