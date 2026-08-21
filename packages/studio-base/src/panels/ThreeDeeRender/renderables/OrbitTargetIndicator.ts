// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { LAYER_SELECTED } from "../IRenderer";

/** Length of each axis bar in CSS pixels, measured tip to tip through the center */
const AXIS_LENGTH_PX = 40;
/** Thickness of each axis bar in CSS pixels */
const AXIS_THICKNESS_PX = 3;
/** How long the indicator stays fully opaque after the drag ends */
const HOLD_MS = 1000;
/** How long the fade-out takes once the hold expires */
const FADE_MS = 600;
/** Draw after everything else so the pivot is never hidden inside a model */
const RENDER_ORDER = 10000;

// Same axis colors used by the coordinate frame axes, see Axis.ts
const RED_COLOR = 0x9c3948;
const GREEN_COLOR = 0x88dd04;
const BLUE_COLOR = 0x2b90fb;

/**
 * A transient X/Y/Z axis marker drawn at the camera's orbit target (the point the camera pans and
 * rotates around) so the user can see where the pivot moved to while dragging.
 *
 * The marker is sized in CSS pixels rather than world units: callers pass the current world units
 * per pixel to `update()` and this object scales itself to stay a constant size on screen at any
 * zoom level.
 */
export class OrbitTargetIndicator extends THREE.Object3D {
  #geometry: THREE.BoxGeometry;
  #materials: THREE.MeshBasicMaterial[] = [];
  /** True while a drag is in progress, which pins the indicator at full opacity */
  #held = false;
  /** Timestamp in `performance.now()` milliseconds at which the fade-out starts */
  #fadeStartMs?: number;

  public constructor() {
    super();
    this.name = "OrbitTargetIndicator";
    this.visible = false;

    // A unit cube stretched into a thin rod along each axis. The parent (this object) carries the
    // world-units-per-pixel scale, so these dimensions are in CSS pixels.
    this.#geometry = new THREE.BoxGeometry(1, 1, 1);

    const bars: [color: number, scale: THREE.Vector3Tuple][] = [
      [RED_COLOR, [AXIS_LENGTH_PX, AXIS_THICKNESS_PX, AXIS_THICKNESS_PX]],
      [GREEN_COLOR, [AXIS_THICKNESS_PX, AXIS_LENGTH_PX, AXIS_THICKNESS_PX]],
      [BLUE_COLOR, [AXIS_THICKNESS_PX, AXIS_THICKNESS_PX, AXIS_LENGTH_PX]],
    ];

    for (const [color, scale] of bars) {
      const material = new THREE.MeshBasicMaterial({
        color,
        // The pivot is a UI affordance, not part of the scene, so it should stay visible even when
        // the target is inside a mesh
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
      });
      const bar = new THREE.Mesh(this.#geometry, material);
      bar.scale.set(...scale);
      bar.renderOrder = RENDER_ORDER;
      bar.frustumCulled = false;
      bar.userData.picking = false;
      // While a renderable is selected the scene is drawn again on LAYER_SELECTED, after a dimming
      // backdrop and a depth clear. Draw in that pass too, otherwise the pivot is dimmed by the
      // backdrop and can be painted over by the selected model.
      bar.layers.enable(LAYER_SELECTED);
      this.#materials.push(material);
      this.add(bar);
    }
  }

  public dispose(): void {
    this.#geometry.dispose();
    for (const material of this.#materials) {
      material.dispose();
    }
  }

  /** Reveal the indicator and pin it at full opacity until `release()` is called */
  public hold(): void {
    this.#held = true;
    this.#fadeStartMs = undefined;
    this.visible = true;
    this.#setOpacity(1);
  }

  /** Called when the drag ends: stay visible for `HOLD_MS`, then fade out over `FADE_MS` */
  public release(nowMs: number): void {
    if (!this.#held) {
      return;
    }
    this.#held = false;
    this.#fadeStartMs = nowMs + HOLD_MS;
  }

  /** Hide immediately, cancelling any in-progress fade */
  public hide(): void {
    this.#held = false;
    this.#fadeStartMs = undefined;
    this.visible = false;
  }

  /**
   * Advance the fade animation and rescale the marker to a constant on-screen size.
   *
   * @param worldUnitsPerPixel Size of one CSS pixel in world units at the indicator's depth
   * @param nowMs Current time from `performance.now()`
   * @returns true if another frame is needed to continue the animation
   */
  public update(worldUnitsPerPixel: number, nowMs: number): boolean {
    if (!this.visible) {
      return false;
    }
    this.scale.setScalar(worldUnitsPerPixel);

    if (this.#held || this.#fadeStartMs == undefined) {
      return false;
    }

    const elapsedMs = nowMs - this.#fadeStartMs;
    if (elapsedMs <= 0) {
      // Still inside the hold window, but we need to keep rendering so the fade starts on time
      return true;
    }
    if (elapsedMs >= FADE_MS) {
      this.hide();
      return false;
    }
    this.#setOpacity(1 - elapsedMs / FADE_MS);
    return true;
  }

  #setOpacity(opacity: number): void {
    for (const material of this.#materials) {
      material.opacity = opacity;
    }
  }
}
