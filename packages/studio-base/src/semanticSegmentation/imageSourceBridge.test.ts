// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  createSegmentationMaskOverlay,
  createSegmentationPanelBridge,
  type SegmentationRendererSources,
} from "./imageSource";

const sources = (): SegmentationRendererSources => ({
  imageMetadata: () => undefined,
  image: () => undefined,
  viewControls: { reset: jest.fn(), zoom: jest.fn(), panBy: jest.fn() },
  cachedFrames: () => [],
});

describe("segmentation mask overlay channel", () => {
  it("notifies subscribers when the source or its content changes, until they unsubscribe", () => {
    const overlay = createSegmentationMaskOverlay();
    const listener = jest.fn();
    const unsubscribe = overlay.subscribe(listener);
    const source = { frame: () => undefined, upcoming: () => [] };
    overlay.set(source);
    expect(overlay.get()).toBe(source);
    overlay.invalidate();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    overlay.set(undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is not shared between channels", () => {
    const a = createSegmentationMaskOverlay();
    const b = createSegmentationMaskOverlay();
    a.set({ frame: () => undefined, upcoming: () => [] });
    expect(b.get()).toBeUndefined();
  });
});

describe("segmentation panel bridge", () => {
  const shared = () => ({
    maskOverlay: createSegmentationMaskOverlay(),
    maskPlanes: { get: () => ({}) as never, dispose: () => {} },
  });

  it("offers what the renderer publishes until it withdraws it", () => {
    const bridge = createSegmentationPanelBridge(shared());
    expect(bridge.sources()).toBeUndefined();
    const offered = sources();
    const withdraw = bridge.publish(offered);
    expect(bridge.sources()).toBe(offered);
    withdraw();
    expect(bridge.sources()).toBeUndefined();
  });

  it("keeps a newer publication when an older one is withdrawn late", () => {
    const bridge = createSegmentationPanelBridge(shared());
    const withdrawFirst = bridge.publish(sources());
    const second = sources();
    bridge.publish(second);
    withdrawFirst();
    expect(bridge.sources()).toBe(second);
  });

  it("tells subscribers about each drawn frame until they unsubscribe", () => {
    const bridge = createSegmentationPanelBridge(shared());
    const once = jest.fn();
    const unsubscribeOnce = bridge.subscribeFrames(() => {
      once();
      unsubscribeOnce();
    });
    const every = jest.fn();
    bridge.subscribeFrames(every);
    bridge.notifyFrame();
    bridge.notifyFrame();
    expect(once).toHaveBeenCalledTimes(1);
    expect(every).toHaveBeenCalledTimes(2);
  });

  it("gives each panel its own sources but the host's overlay", () => {
    const common = shared();
    const a = createSegmentationPanelBridge(common);
    const b = createSegmentationPanelBridge(common);
    a.publish(sources());
    expect(b.sources()).toBeUndefined();
    expect(a.maskOverlay).toBe(b.maskOverlay);
  });
});
