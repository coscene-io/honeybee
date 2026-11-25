// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import {
  createSegmentationMaskOverlay,
  type SegmentationMaskGeometry,
  type SegmentationMaskOverlaySource,
  type SegmentationPanelBridge,
} from "@foxglove/studio-base/semanticSegmentation/imageSource";
import { MaskPlaneCache } from "@foxglove/studio-base/semanticSegmentation/maskOverlay/maskPlaneCache";
import maskFixture from "@foxglove/studio-base/semanticSegmentation/testing/fixtures/masks.json";

import { SegmentationMaskLayer } from "./SegmentationMaskLayer";
import type { ImageRenderable } from "../Images/ImageRenderable";

let mockCache: MaskPlaneCache;
let bridge: Pick<SegmentationPanelBridge, "maskOverlay" | "maskPlanes">;

const STYLE = { colors: [[1, 0, 0] as const], visible: [true], selected: [false], opacity: 0.4 };

function geometry(id: number, logTimeNs: string): SegmentationMaskGeometry {
  return {
    id,
    topic: "/camera",
    logTimeNs,
    width: 1280,
    height: 720,
    instanceIds: ["a"],
    counts: [maskFixture.cases[0]!.counts],
  };
}

function renderable(receiveTime: bigint): ImageRenderable {
  const object = new THREE.Object3D() as unknown as ImageRenderable;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  object.userData = {
    topic: "/camera",
    mesh,
    displayedFrameState: { receiveTime },
  } as unknown as ImageRenderable["userData"];
  return object;
}

function source(frames: Map<string, SegmentationMaskGeometry>): SegmentationMaskOverlaySource {
  return {
    frame: (topic, logTimeNs) => {
      const found = topic === "/camera" ? frames.get(logTimeNs) : undefined;
      return found ? { geometry: found, style: STYLE } : undefined;
    },
    upcoming: () => [],
  };
}

async function built(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function overlayOf(object: THREE.Object3D): THREE.Object3D | undefined {
  return object.children.find((child) => child.name === "SegmentationMaskOverlay");
}

describe("SegmentationMaskLayer", () => {
  beforeEach(() => {
    mockCache = new MaskPlaneCache(undefined);
    bridge = {
      maskOverlay: createSegmentationMaskOverlay(),
      maskPlanes: { get: () => mockCache, dispose: () => {} },
    };
  });
  afterEach(() => {
    bridge.maskOverlay.set(undefined);
    mockCache.dispose();
  });

  it("draws nothing and takes no prefetch share without a mask source", () => {
    const layer = new SegmentationMaskLayer(bridge, () => 4096, jest.fn());
    const image = renderable(10n);
    layer.update(image);
    expect(overlayOf(image)).toBeUndefined();
    expect(mockCache.framesAhead(1, 100)).toBe(100);
    layer.dispose();
  });

  it("shows masks for exactly the displayed log time, never a neighbouring frame", async () => {
    bridge.maskOverlay.set(source(new Map([["10", geometry(1, "10")]])));
    const onChange = jest.fn();
    const layer = new SegmentationMaskLayer(bridge, () => 4096, onChange);
    const image = renderable(10n);

    layer.update(image);
    // Planes are built off the render frame: nothing yet, and a redraw is requested when ready.
    expect(overlayOf(image)).toBeUndefined();
    await built();
    expect(onChange).toHaveBeenCalled();
    layer.update(image);
    expect(overlayOf(image)?.visible).toBe(true);

    image.userData.displayedFrameState = {
      receiveTime: 11n,
    } as unknown as ImageRenderable["userData"]["displayedFrameState"];
    layer.update(image);
    expect(overlayOf(image)?.visible).toBe(false);
    layer.dispose();
  });

  it("refuses masks larger than the GPU texture limit", async () => {
    bridge.maskOverlay.set(source(new Map([["10", geometry(1, "10")]])));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const layer = new SegmentationMaskLayer(bridge, () => 512, jest.fn());
    const image = renderable(10n);
    layer.update(image);
    await built();
    layer.update(image);
    expect(overlayOf(image)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    layer.dispose();
  });

  it("detaches and leaves the shared cache on dispose", async () => {
    bridge.maskOverlay.set(source(new Map([["10", geometry(1, "10")]])));
    const leave = jest.fn();
    const addConsumer = mockCache.addConsumer.bind(mockCache);
    jest.spyOn(mockCache, "addConsumer").mockImplementation((consumer) => {
      const remove = addConsumer(consumer);
      return () => {
        leave();
        remove();
      };
    });
    const layer = new SegmentationMaskLayer(bridge, () => 4096, jest.fn());
    const image = renderable(10n);
    layer.update(image);
    await built();
    layer.update(image);
    expect(overlayOf(image)).toBeDefined();
    layer.dispose();
    expect(overlayOf(image)).toBeUndefined();
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
