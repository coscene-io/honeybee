// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { OrbitTargetIndicator } from "./OrbitTargetIndicator";
import { LAYER_DEFAULT, LAYER_SELECTED } from "../layers";

/** Mirrors the private timings in OrbitTargetIndicator */
const HOLD_MS = 1000;
const FADE_MS = 600;

/** Arbitrary starting timestamp, standing in for `performance.now()` */
const T0 = 10_000;

function opacities(indicator: OrbitTargetIndicator): number[] {
  return indicator.children.map(
    (child) => ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity,
  );
}

describe("OrbitTargetIndicator", () => {
  let indicator: OrbitTargetIndicator;

  beforeEach(() => {
    indicator = new OrbitTargetIndicator();
  });

  afterEach(() => {
    indicator.dispose();
  });

  it("starts hidden", () => {
    expect(indicator.visible).toBe(false);
    expect(indicator.children).toHaveLength(3);
  });

  it("draws in both the default and the selected-object pass", () => {
    // When a renderable is selected the scene is redrawn on LAYER_SELECTED after a dimming backdrop
    // and a depth clear, so the marker has to be on both layers to stay visible
    for (const child of indicator.children) {
      expect(child.layers.isEnabled(LAYER_DEFAULT)).toBe(true);
      expect(child.layers.isEnabled(LAYER_SELECTED)).toBe(true);
    }
  });

  it("is excluded from picking", () => {
    for (const child of indicator.children) {
      expect(child.userData.picking).toBe(false);
    }
  });

  it("becomes visible at full opacity when held", () => {
    indicator.hold();
    expect(indicator.visible).toBe(true);
    expect(opacities(indicator)).toEqual([1, 1, 1]);
  });

  it("scales itself to keep a constant on-screen size", () => {
    indicator.hold();
    indicator.update(0.05, T0);
    expect(indicator.scale.toArray()).toEqual([0.05, 0.05, 0.05]);

    // Zooming out makes a pixel cover more world units; the marker grows to match
    indicator.update(0.2, T0);
    expect(indicator.scale.toArray()).toEqual([0.2, 0.2, 0.2]);
  });

  it("requests no further frames while held", () => {
    indicator.hold();
    expect(indicator.update(1, T0)).toBe(false);
    expect(indicator.update(1, T0 + 10_000)).toBe(false);
    expect(indicator.visible).toBe(true);
  });

  it("stays fully opaque during the hold window after release", () => {
    indicator.hold();
    indicator.release(T0);

    // Still animating, so it must keep asking for frames to start the fade on time
    expect(indicator.update(1, T0 + HOLD_MS / 2)).toBe(true);
    expect(opacities(indicator)).toEqual([1, 1, 1]);
    expect(indicator.visible).toBe(true);
  });

  it("fades out once the hold window expires", () => {
    indicator.hold();
    indicator.release(T0);

    expect(indicator.update(1, T0 + HOLD_MS + FADE_MS / 2)).toBe(true);
    for (const opacity of opacities(indicator)) {
      expect(opacity).toBeCloseTo(0.5);
    }
    expect(indicator.visible).toBe(true);
  });

  it("hides itself once the fade completes", () => {
    indicator.hold();
    indicator.release(T0);

    expect(indicator.update(1, T0 + HOLD_MS + FADE_MS)).toBe(false);
    expect(indicator.visible).toBe(false);

    // Nothing left to animate
    expect(indicator.update(1, T0 + HOLD_MS + FADE_MS + 1000)).toBe(false);
  });

  it("restores full opacity when held again mid-fade", () => {
    indicator.hold();
    indicator.release(T0);
    indicator.update(1, T0 + HOLD_MS + FADE_MS / 2);

    indicator.hold();
    expect(opacities(indicator)).toEqual([1, 1, 1]);
    expect(indicator.update(1, T0 + HOLD_MS + FADE_MS * 2)).toBe(false);
    expect(indicator.visible).toBe(true);
  });

  it("ignores release() when it was never held", () => {
    indicator.release(T0);
    expect(indicator.visible).toBe(false);
    expect(indicator.update(1, T0 + HOLD_MS + FADE_MS)).toBe(false);
  });

  it("ignores a second release() so the fade is not restarted", () => {
    indicator.hold();
    indicator.release(T0);
    // A stray release (e.g. a trailing pointercancel) must not push the fade back
    indicator.release(T0 + 5000);
    expect(indicator.update(1, T0 + HOLD_MS + FADE_MS)).toBe(false);
    expect(indicator.visible).toBe(false);
  });

  it("hide() cancels an in-progress fade", () => {
    indicator.hold();
    indicator.release(T0);
    indicator.hide();

    expect(indicator.visible).toBe(false);
    expect(indicator.update(1, T0 + HOLD_MS / 2)).toBe(false);
  });

  it("does nothing while hidden", () => {
    indicator.scale.setScalar(1);
    expect(indicator.update(0.5, T0)).toBe(false);
    expect(indicator.scale.toArray()).toEqual([1, 1, 1]);
  });
});
