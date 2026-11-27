// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { Label, LabelMaterial, LabelPool } from "@foxglove/three-text";

import { getLuminance, SRGBToLinear } from "../color";

export const DEFAULT_LABEL_ANCHOR_X = 0.5;
export const DEFAULT_LABEL_ANCHOR_Y = 0.5;

const cameraSpaceAnchor = new THREE.Vector3();

export class ViewportLabelPool extends LabelPool {
  protected override createLabel(): Label {
    const label = super.createLabel();
    // Three r166 invokes the mesh hook. three-text 0.6.1 uses it for the picking material only.
    const beforeRender = label.mesh.onBeforeRender.bind(label.mesh);
    label.mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      beforeRender(renderer, scene, camera, geometry, material, group);
      // three-text overrides this hook to set its shader viewport and DPR.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      label.material.onBeforeRender(renderer, scene, camera, geometry, label.mesh, group);
    };
    return label;
  }
}

/** Cover the billboard that three-text expands in its shader when Three.js tests the mesh frustum. */
export function updateBillboardBounds(
  label: Label,
  worldAnchor: THREE.Vector3,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  canvasSize: THREE.Vector2,
): void {
  const { uniforms } = label.material as LabelMaterial;
  const [width, height] = uniforms.uLabelSize!.value as [number, number];
  const [anchorX, anchorY] = uniforms.uAnchorPoint!.value as [number, number];
  let extentX = width * Math.max(anchorX, 1 - anchorX);
  let extentY = height * Math.max(anchorY, 1 - anchorY);
  if (uniforms.uSizeAttenuation!.value === false) {
    // Fixed-size labels use CSS pixels. Convert them back to world units at the anchor depth.
    const depth =
      camera instanceof THREE.PerspectiveCamera
        ? Math.abs(cameraSpaceAnchor.copy(worldAnchor).applyMatrix4(camera.matrixWorldInverse).z)
        : 1;
    const projection = camera.projectionMatrix.elements;
    extentX *= (2 * depth) / (Math.max(1, canvasSize.width) * Math.abs(projection[0]!));
    extentY *= (2 * depth) / (Math.max(1, canvasSize.height) * Math.abs(projection[5]!));
  }
  const sphere = (label.mesh.boundingSphere ??= new THREE.Sphere());
  sphere.center.set(0, 0, 0);
  const scale = Math.abs(uniforms.uScale!.value as number);
  sphere.radius = scale * Math.sqrt(extentX * extentX + extentY * extentY);
}

/** Render order for highlighted / selected 3D labels so they remain legible above geometry. */
export const HIGHLIGHT_LABEL_RENDER_ORDER = 9999998;

/** Render order for tool overlay labels (e.g. MeasurementTool). */
export const LATE_LABEL_RENDER_ORDER = 9999999;

export type LabelRgbaColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
};

type HighlightPalette = {
  readonly fg: readonly [number, number, number];
  readonly bg: readonly [number, number, number];
};

// High-contrast theme-aware highlight palettes stored in linear sRGB for Label.setColor/setBackgroundColor.
const DARK_HIGHLIGHT_PALETTE: HighlightPalette = {
  // #0f172a foreground on #f59e0b amber pill
  fg: [SRGBToLinear(15 / 255), SRGBToLinear(23 / 255), SRGBToLinear(42 / 255)],
  bg: [SRGBToLinear(245 / 255), SRGBToLinear(158 / 255), SRGBToLinear(11 / 255)],
};

const LIGHT_HIGHLIGHT_PALETTE: HighlightPalette = {
  // #ffffff foreground on #1d4ed8 royal-blue pill
  fg: [1, 1, 1],
  bg: [SRGBToLinear(29 / 255), SRGBToLinear(78 / 255), SRGBToLinear(216 / 255)],
};

/**
 * Reset all mutable scene graph and material state on a pooled `@foxglove/three-text` Label so
 * labels recycled across heterogeneous 3D/Image renderables never leak state (e.g. anchorPoint,
 * sizeAttenuation, depthTest, renderOrder, layers, or transforms).
 */
export function resetLabel(label: Label): void {
  label.visible = true;
  label.position.set(0, 0, 0);
  label.quaternion.identity();
  label.scale.set(1, 1, 1);
  label.renderOrder = 0;
  label.mesh.renderOrder = 0;
  label.mesh.boundingSphere = ReactNull;
  label.layers.set(0);
  label.mesh.layers.set(0);
  label.userData.pose = undefined;
  label.userData.labelPrimitiveIndex = undefined;
  label.userData.picking = undefined;
  label.mesh.userData.picking = undefined;

  label.setBillboard(true);
  label.setSizeAttenuation(true);
  label.setAnchorPoint(DEFAULT_LABEL_ANCHOR_X, DEFAULT_LABEL_ANCHOR_Y);
  label.setColor(0, 0, 0, 1);
  label.setBackgroundColor(1, 1, 1, 1);
  label.material.depthTest = true;
  label.material.depthWrite = true;
  label.material.transparent = false;
  label.pickingMaterial.depthTest = true;
  label.pickingMaterial.depthWrite = true;
}

/**
 * Acquire a Label from the shared `LabelPool` and reset it to clean defaults.
 */
export function acquirePooledLabel(labelPool: LabelPool): Label {
  const label = labelPool.acquire();
  resetLabel(label);
  return label;
}

/**
 * Reset a Label and return it to the shared `LabelPool` for reuse.
 */
export function releasePooledLabel(labelPool: LabelPool, label: Label): void {
  resetLabel(label);
  label.setText("");
  labelPool.release(label);
}

/**
 * Apply sRGB foreground and optional sRGB background colors to a Label, automatically selecting a
 * high-contrast white or black background when no explicit background is supplied.
 */
export function setLabelContrastingColors(
  label: Label,
  foreground: LabelRgbaColor,
  background?: LabelRgbaColor,
  autoBackgroundAlpha = foreground.a ?? 1,
): void {
  const alpha = foreground.a ?? 1;
  label.setColor(
    SRGBToLinear(foreground.r),
    SRGBToLinear(foreground.g),
    SRGBToLinear(foreground.b),
    alpha,
  );

  if (background != undefined) {
    label.setBackgroundColor(
      SRGBToLinear(background.r),
      SRGBToLinear(background.g),
      SRGBToLinear(background.b),
      background.a ?? 1,
    );
    return;
  }

  const foregroundIsDark = getLuminance(foreground.r, foreground.g, foreground.b) < 0.5;
  if (foregroundIsDark) {
    label.setBackgroundColor(1, 1, 1, autoBackgroundAlpha);
  } else {
    label.setBackgroundColor(0, 0, 0, autoBackgroundAlpha);
  }
}

export type LabelHighlightOptions = {
  readonly highlighted: boolean;
  readonly colorScheme: "dark" | "light";
  readonly normalForeground: number;
  readonly normalBackground: THREE.Color;
  readonly baseRenderOrder?: number;
};

/**
 * Toggle search/selection highlight styling on a Label. Highlighted labels use high-contrast
 * theme-aware accent colors and disable depth testing so they stay readable in dense 3D scenes.
 */
export function applyLabelHighlightStyle(label: Label, options: LabelHighlightOptions): void {
  const baseRenderOrder = options.baseRenderOrder ?? 0;

  if (options.highlighted) {
    const palette =
      options.colorScheme === "dark" ? DARK_HIGHLIGHT_PALETTE : LIGHT_HIGHLIGHT_PALETTE;
    label.setColor(palette.fg[0], palette.fg[1], palette.fg[2], 1);
    label.setBackgroundColor(palette.bg[0], palette.bg[1], palette.bg[2], 1);
    label.renderOrder = HIGHLIGHT_LABEL_RENDER_ORDER;
    label.mesh.renderOrder = HIGHLIGHT_LABEL_RENDER_ORDER;
    // Three.js draws transparent geometry after the entire opaque queue.
    label.material.transparent = true;
    label.material.depthTest = false;
    label.material.depthWrite = false;
    label.pickingMaterial.depthTest = false;
    label.pickingMaterial.depthWrite = false;
    return;
  }

  label.setColor(options.normalForeground, options.normalForeground, options.normalForeground, 1);
  label.setBackgroundColor(
    options.normalBackground.r,
    options.normalBackground.g,
    options.normalBackground.b,
    1,
  );
  label.renderOrder = baseRenderOrder;
  label.mesh.renderOrder = baseRenderOrder;
  label.pickingMaterial.depthTest = true;
  label.pickingMaterial.depthWrite = true;
  label.material.depthTest = true;
  label.material.depthWrite = true;
}

/**
 * Normalize a user-supplied label search filter string for case-insensitive matching.
 */
export function normalizeLabelFilter(filter: string | undefined): string {
  return filter?.trim().toLowerCase() ?? "";
}

/**
 * Check whether a label's display text matches a normalized search filter.
 */
export function matchesLabelFilter(text: string, normalizedFilter: string): boolean {
  return normalizedFilter.length > 0 && text.toLowerCase().includes(normalizedFilter);
}
