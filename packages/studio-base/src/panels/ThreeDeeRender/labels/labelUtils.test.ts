/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { setupJestCanvasMock } from "jest-canvas-mock";
import * as THREE from "three";

import { LabelMaterial, LabelPool } from "@foxglove/three-text";

import {
  acquirePooledLabel,
  applyLabelHighlightStyle,
  DEFAULT_LABEL_ANCHOR_X,
  DEFAULT_LABEL_ANCHOR_Y,
  HIGHLIGHT_LABEL_RENDER_ORDER,
  matchesLabelFilter,
  normalizeLabelFilter,
  releasePooledLabel,
  setLabelContrastingColors,
} from "./labelUtils";

describe("labelUtils", () => {
  beforeEach(() => {
    setupJestCanvasMock();
  });

  it("resets mutated label state across pool reuse without losing pickingMaterial", () => {
    const pool = new LabelPool();
    const first = acquirePooledLabel(pool);
    const originalPickingMaterial = first.mesh.userData.pickingMaterial;
    expect(originalPickingMaterial).toBeDefined();

    // Simulate aggressive mutation from MeasurementTool / RenderableTextAnnotation
    first.visible = false;
    first.position.set(10, 20, 30);
    first.quaternion.set(0, 0.707, 0, 0.707);
    first.scale.set(2, 3, 4);
    first.renderOrder = 9999999;
    first.mesh.renderOrder = 9999999;
    first.layers.set(1);
    first.mesh.layers.set(1);
    first.userData.pose = { position: { x: 1, y: 2, z: 3 } };
    first.userData.picking = false;
    first.mesh.userData.picking = false;
    first.setBillboard(false);
    first.setSizeAttenuation(false);
    first.setAnchorPoint(0, 0);
    first.setText("mutated");
    first.material.depthTest = false;
    first.material.depthWrite = false;
    first.material.transparent = true;

    releasePooledLabel(pool, first);

    const recycled = acquirePooledLabel(pool);
    expect(recycled).toBe(first);
    expect(recycled.visible).toBe(true);
    expect(recycled.position.toArray()).toEqual([0, 0, 0]);
    expect(recycled.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(recycled.scale.toArray()).toEqual([1, 1, 1]);
    expect(recycled.renderOrder).toBe(0);
    expect(recycled.mesh.renderOrder).toBe(0);
    expect(recycled.layers.mask).toBe(1);
    expect(recycled.mesh.layers.mask).toBe(1);
    expect(recycled.userData.pose).toBeUndefined();
    expect(recycled.userData.picking).toBeUndefined();
    expect(recycled.mesh.userData.picking).toBeUndefined();
    expect(recycled.mesh.userData.pickingMaterial).toBe(originalPickingMaterial);
    expect(recycled.material.depthTest).toBe(true);
    expect(recycled.material.depthWrite).toBe(true);
    expect(recycled.material.transparent).toBe(false);

    const mat = recycled.material as LabelMaterial;
    expect(mat.uniforms.uBillboard?.value).toBe(true);
    expect(mat.uniforms.uSizeAttenuation?.value).toBe(true);
    expect(mat.uniforms.uAnchorPoint?.value).toEqual([
      DEFAULT_LABEL_ANCHOR_X,
      DEFAULT_LABEL_ANCHOR_Y,
    ]);

    releasePooledLabel(pool, recycled);
    pool.dispose();
  });

  it("reuses pooled labels under rapid acquire/release churn without creating extras", () => {
    const pool = new LabelPool();
    const seen = new Set<object>();

    for (let round = 0; round < 10; round++) {
      const batch = [];
      for (let i = 0; i < 8; i++) {
        const label = acquirePooledLabel(pool);
        label.setText(`label_${round}_${i}`);
        seen.add(label);
        batch.push(label);
      }
      for (const label of batch) {
        releasePooledLabel(pool, label);
      }
    }

    expect(seen.size).toBe(8);
    pool.dispose();
  });

  it("applies contrasting auto-background and explicit background colors", () => {
    const pool = new LabelPool();
    const label = acquirePooledLabel(pool);
    const mat = label.material as LabelMaterial;

    // Dark foreground -> white background
    setLabelContrastingColors(label, { r: 0.1, g: 0.1, b: 0.1, a: 0.8 });
    expect(mat.uniforms.uBackgroundColor?.value).toEqual([1, 1, 1, 0.8]);

    // Bright foreground -> black background
    setLabelContrastingColors(label, { r: 0.9, g: 0.9, b: 0.9, a: 1 });
    expect(mat.uniforms.uBackgroundColor?.value).toEqual([0, 0, 0, 1]);

    setLabelContrastingColors(label, { r: 1, g: 1, b: 1, a: 0.25 }, undefined, 1);
    expect(mat.uniforms.uBackgroundColor?.value).toEqual([0, 0, 0, 1]);

    // Explicit background color
    setLabelContrastingColors(label, { r: 1, g: 1, b: 1, a: 1 }, { r: 0, g: 0, b: 1, a: 0.5 });
    expect(mat.uniforms.uBackgroundColor?.value).toEqual([0, 0, 1, 0.5]);

    releasePooledLabel(pool, label);
    pool.dispose();
  });

  it("toggles highlight style and restores normal colors and depth testing", () => {
    const pool = new LabelPool();
    const label = acquirePooledLabel(pool);
    const mat = label.material as LabelMaterial;
    const normalBg = new THREE.Color(0.2, 0.3, 0.4);

    applyLabelHighlightStyle(label, {
      highlighted: true,
      colorScheme: "dark",
      normalForeground: 1,
      normalBackground: normalBg,
    });
    expect(label.renderOrder).toBe(HIGHLIGHT_LABEL_RENDER_ORDER);
    expect(label.mesh.renderOrder).toBe(HIGHLIGHT_LABEL_RENDER_ORDER);
    expect(label.material.transparent).toBe(true);
    expect(label.material.depthTest).toBe(false);
    expect(label.material.depthWrite).toBe(false);
    expect(label.pickingMaterial.depthTest).toBe(false);

    applyLabelHighlightStyle(label, {
      highlighted: false,
      colorScheme: "dark",
      normalForeground: 1,
      normalBackground: normalBg,
    });
    expect(label.renderOrder).toBe(0);
    expect(label.mesh.renderOrder).toBe(0);
    expect(label.material.transparent).toBe(false);
    expect(label.material.depthTest).toBe(true);
    expect(label.material.depthWrite).toBe(true);
    expect(label.pickingMaterial.depthTest).toBe(true);
    expect(mat.uniforms.uColor?.value).toEqual([1, 1, 1, 1]);
    expect(mat.uniforms.uBackgroundColor?.value).toEqual([0.2, 0.3, 0.4, 1]);

    releasePooledLabel(pool, label);
    pool.dispose();
  });

  it("matches case-insensitive search filters cleanly", () => {
    expect(normalizeLabelFilter("  Base_Link  ")).toBe("base_link");
    expect(normalizeLabelFilter(undefined)).toBe("");
    expect(matchesLabelFilter("robot/base_link", "base_link")).toBe(true);
    expect(matchesLabelFilter("robot/camera", "base_link")).toBe(false);
    expect(matchesLabelFilter("robot/base_link", "")).toBe(false);
  });
});
