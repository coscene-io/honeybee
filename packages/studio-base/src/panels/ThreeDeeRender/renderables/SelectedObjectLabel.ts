// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { Label } from "@foxglove/three-text";

import { FrameAxisRenderable } from "./FrameAxes";
import { DEFAULT_SHOW_SELECTED_OBJECT_LABEL } from "./SceneSettings";
import { IRenderer, LAYER_SELECTED } from "../IRenderer";
import type { PickedRenderable } from "../Picker";
import { SceneExtension } from "../SceneExtension";
import {
  acquirePooledLabel,
  applyLabelHighlightStyle,
  DEFAULT_LABEL_ANCHOR_X,
  releasePooledLabel,
} from "../labels/labelUtils";

const SELECTED_OBJECT_LABEL_LINE_HEIGHT_PX = 13;
const MAX_LABEL_LINE_LENGTH = 48;
const DUMMY_BACKGROUND = new THREE.Color(0, 0, 0);

function truncateLine(text: string): string {
  if (text.length <= MAX_LABEL_LINE_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_LABEL_LINE_LENGTH - 1)}\u2026`;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Format a concise, readable 3D callout text for a selected PointCloud point, URDF/mesh, Marker,
 * SceneEntity, or other pickable Renderable.
 */
export function formatSelectedObjectLabel(selection: PickedRenderable): string {
  const { renderable, instanceIndex } = selection;
  const idFromMessage = renderable.idFromMessage();
  const baseName =
    idFromMessage != undefined && renderable.topic != undefined && renderable.topic.length > 0
      ? `${renderable.topic}: ${String(idFromMessage)}`
      : renderable.name.length > 0
        ? renderable.name
        : renderable.topic != undefined && renderable.topic.length > 0
          ? renderable.topic
          : renderable.userData.frameId;

  if (instanceIndex != undefined) {
    const details = renderable.instanceDetails(instanceIndex);
    const x = getFiniteNumber(details?.x);
    const y = getFiniteNumber(details?.y);
    const z = getFiniteNumber(details?.z);
    if (x != undefined && y != undefined && z != undefined) {
      const intensity = getFiniteNumber(details?.intensity);
      const header = truncateLine(
        renderable.topic != undefined && renderable.topic.length > 0 ? renderable.topic : baseName,
      );
      const coords = `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
      const suffix = intensity != undefined ? ` I:${intensity.toFixed(1)}` : "";
      return `${header}\n${coords}${suffix}`;
    }

    return truncateLine(`${baseName} #${instanceIndex}`);
  }

  return truncateLine(baseName);
}

/**
 * Compute the 3D world-space anchor position for a selected object or instanced point (such as a
 * selected point in a PointCloud).
 */
export function computeSelectedObjectWorldPosition(
  selection: PickedRenderable,
  out: THREE.Vector3,
): boolean {
  const { renderable, instanceIndex } = selection;
  if (instanceIndex != undefined) {
    const details = renderable.instanceDetails(instanceIndex);
    const x = getFiniteNumber(details?.x);
    const y = getFiniteNumber(details?.y);
    const z = getFiniteNumber(details?.z);
    if (x != undefined && y != undefined && z != undefined) {
      renderable.updateWorldMatrix(true, false);
      out.set(x, y, z).applyMatrix4(renderable.matrixWorld);
      return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
    }
  }

  renderable.getWorldPosition(out);
  return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
}

/**
 * Renders a single pooled, screen-space `@foxglove/three-text` SDF callout label for the currently
 * selected 3D object (PointCloud point, URDF link/mesh, SceneEntity, Marker, Pose, etc.).
 *
 * FrameAxisRenderable selections are intentionally skipped because FrameAxes highlights its own
 * coordinate frame label directly.
 */
export class SelectedObjectLabel extends SceneExtension {
  public static extensionId = "foxglove.SelectedObjectLabel";

  #label: Label | undefined;
  #selected: PickedRenderable | undefined;
  #colorScheme: "dark" | "light";

  public constructor(renderer: IRenderer, name: string = SelectedObjectLabel.extensionId) {
    super(name, renderer);
    this.#colorScheme = renderer.colorScheme;
    renderer.on("selectedRenderable", this.#handleSelectedRenderable);
    renderer.on("configApplied", this.#handleConfigApplied);
  }

  public override dispose(): void {
    this.renderer.off("selectedRenderable", this.#handleSelectedRenderable);
    this.renderer.off("configApplied", this.#handleConfigApplied);
    if (this.#label) {
      releasePooledLabel(this.renderer.labelPool, this.#label);
      this.#label = undefined;
    }
    this.#selected = undefined;
    super.dispose();
  }

  public override removeAllRenderables(): void {
    this.#selected = undefined;
    if (this.#label) {
      this.#label.visible = false;
    }
  }

  public override setColorScheme(
    colorScheme: "dark" | "light",
    _backgroundColor: THREE.Color | undefined,
  ): void {
    this.#colorScheme = colorScheme;
    if (this.#label) {
      this.#applyStyle(this.#label);
    }
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    super.startFrame(currentTime, renderFrameId, fixedFrameId);

    const label = this.#label;
    const selection = this.#selected;
    if (!label || !selection) {
      return;
    }

    if (!this.#isEnabled() || !selection.renderable.visible) {
      label.visible = false;
      return;
    }

    const validPosition = computeSelectedObjectWorldPosition(selection, label.position);
    label.visible = validPosition;
  }

  /** Exposed for testing/inspection of the active pooled label instance. */
  public getLabel(): Label | undefined {
    return this.#label;
  }

  #isEnabled(): boolean {
    return this.renderer.config.scene.showSelectedObjectLabel ?? DEFAULT_SHOW_SELECTED_OBJECT_LABEL;
  }

  #ensureLabel(): Label {
    if (this.#label) {
      return this.#label;
    }

    const label = acquirePooledLabel(this.renderer.labelPool);
    label.visible = false;
    label.setBillboard(true);
    label.setSizeAttenuation(false);
    label.setAnchorPoint(DEFAULT_LABEL_ANCHOR_X, 0);
    label.setLineHeight(SELECTED_OBJECT_LABEL_LINE_HEIGHT_PX);
    label.layers.set(LAYER_SELECTED);
    label.mesh.layers.set(LAYER_SELECTED);
    label.userData.picking = false;
    label.mesh.userData.picking = false;
    this.#applyStyle(label);

    this.add(label);
    this.#label = label;
    return label;
  }

  #applyStyle(label: Label): void {
    applyLabelHighlightStyle(label, {
      highlighted: true,
      colorScheme: this.#colorScheme,
      normalForeground: 1,
      normalBackground: DUMMY_BACKGROUND,
    });
  }

  #syncSelection(): void {
    const selection = this.#selected;
    if (!selection || !this.#isEnabled() || selection.renderable instanceof FrameAxisRenderable) {
      if (this.#label) {
        this.#label.visible = false;
      }
      return;
    }

    const text = formatSelectedObjectLabel(selection);
    if (text.length === 0) {
      if (this.#label) {
        this.#label.visible = false;
      }
      return;
    }

    const label = this.#ensureLabel();
    label.setText(text);
    const validPosition = computeSelectedObjectWorldPosition(selection, label.position);
    label.visible = validPosition && selection.renderable.visible;
  }

  #handleSelectedRenderable = (selection: PickedRenderable | undefined): void => {
    this.#selected = selection;
    this.#syncSelection();
  };

  #handleConfigApplied = (): void => {
    this.#syncSelection();
  };
}
