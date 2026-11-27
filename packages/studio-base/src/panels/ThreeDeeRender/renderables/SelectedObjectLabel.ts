// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { RosValue } from "@foxglove/studio-base/players/types";
import { Label } from "@foxglove/three-text";

import { FrameAxisRenderable } from "./FrameAxes";
import { DEFAULT_SHOW_SELECTED_OBJECT_LABEL } from "./SceneSettings";
import { IRenderer, LAYER_SELECTED } from "../IRenderer";
import type { PickedRenderable } from "../Picker";
import { Renderable } from "../Renderable";
import { RemoveAllRenderablesOptions, SceneExtension } from "../SceneExtension";
import { getMarkerId, RenderableMarker } from "./markers/RenderableMarker";
import {
  acquirePooledLabel,
  applyLabelHighlightStyle,
  DEFAULT_LABEL_ANCHOR_X,
  releasePooledLabel,
  updateBillboardBounds,
} from "../labels/labelUtils";

const SELECTED_OBJECT_LABEL_LINE_HEIGHT_PX = 13;
const MAX_LABEL_LINE_LENGTH = 48;
const DUMMY_BACKGROUND = new THREE.Color(0, 0, 0);

function truncateLine(text: string): string {
  if (text.length <= MAX_LABEL_LINE_LENGTH) {
    return text;
  }
  // Qualified names end with the entity ID, marker ID or topic basename.
  let start = text.length - (MAX_LABEL_LINE_LENGTH - 1);
  const firstCodeUnit = text.charCodeAt(start);
  if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) {
    start++;
  }
  return `\u2026${text.slice(start)}`;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isVisibleInScene(object: THREE.Object3D, scene: THREE.Object3D["parent"]): boolean {
  for (let node: THREE.Object3D["parent"] = object; node != undefined; node = node.parent) {
    if (!node.visible) {
      return false;
    }
    if (node === scene) {
      return true;
    }
  }
  return false;
}

function safeGetInstanceLabelDetails(
  renderable: Renderable,
  instanceIndex: number,
): Record<string, RosValue> | undefined {
  try {
    return renderable.instanceLabelDetails(instanceIndex);
  } catch {
    return undefined;
  }
}

/**
 * Format a concise, readable 3D callout text for a selected PointCloud point, URDF/mesh, Marker,
 * SceneEntity, or other pickable Renderable.
 */
export function formatSelectedObjectLabel(
  selection: PickedRenderable,
  resolvedInstanceDetails?: Record<string, RosValue>,
): string {
  const { renderable, instanceIndex } = selection;
  if (renderable instanceof RenderableMarker) {
    const { topic, marker } = renderable.userData;
    return truncateLine(getMarkerId(topic, marker.ns, marker.id));
  }
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
    const details =
      resolvedInstanceDetails ?? safeGetInstanceLabelDetails(renderable, instanceIndex);
    if (details == undefined) {
      return "";
    }
    const { x, y, z } = details;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
      const intensity = getFiniteNumber(details.intensity);
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
  resolvedInstanceDetails?: Record<string, RosValue>,
): boolean {
  const { renderable, instanceIndex } = selection;
  if (instanceIndex != undefined) {
    const details =
      resolvedInstanceDetails ?? safeGetInstanceLabelDetails(renderable, instanceIndex);
    if (details == undefined) {
      return false;
    }
    const { x, y, z } = details;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
      renderable.updateWorldMatrix(true, false);
      out.set(x, y, z).applyMatrix4(renderable.matrixWorld);
      return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
    }
  }

  const anchor = selection.pickedChild ?? renderable;
  const position =
    anchor instanceof Renderable
      ? anchor.getLabelWorldPosition(out, selection.primitiveIndex)
      : anchor.getWorldPosition(out);
  return (
    position != undefined &&
    Number.isFinite(out.x) &&
    Number.isFinite(out.y) &&
    Number.isFinite(out.z)
  );
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
  #lastText: string | undefined;
  #colorScheme: "dark" | "light";

  public constructor(renderer: IRenderer, name: string = SelectedObjectLabel.extensionId) {
    super(name, renderer);
    this.#colorScheme = renderer.colorScheme;
    renderer.on("selectedRenderable", this.#handleSelectedRenderable);
    renderer.on("configApplied", this.#syncSelection);
    renderer.on("beforeRender", this.#syncSelection);
  }

  public override dispose(): void {
    this.renderer.off("selectedRenderable", this.#handleSelectedRenderable);
    this.renderer.off("configApplied", this.#syncSelection);
    this.renderer.off("beforeRender", this.#syncSelection);
    if (this.#label) {
      releasePooledLabel(this.renderer.labelPool, this.#label);
      this.#label = undefined;
    }
    this.#handleSelectedRenderable(undefined);
    this.#lastText = undefined;
    super.dispose();
  }

  public override removeAllRenderables({ reason }: RemoveAllRenderablesOptions = {}): void {
    // A seek preserves custom layers such as URDFs and grids. Removed objects invalidate themselves.
    if (reason !== "seek") {
      this.#handleSelectedRenderable(undefined);
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

  #syncSelection = (): void => {
    const selection = this.#selected;
    if (
      !selection ||
      !this.#isEnabled() ||
      selection.renderable instanceof FrameAxisRenderable ||
      !isVisibleInScene(selection.pickedChild ?? selection.renderable, this.parent)
    ) {
      if (this.#label) {
        this.#label.visible = false;
      }
      return;
    }

    let instanceDetails: Record<string, RosValue> | undefined;
    if (selection.instanceIndex != undefined) {
      instanceDetails = safeGetInstanceLabelDetails(selection.renderable, selection.instanceIndex);
      if (instanceDetails == undefined) {
        if (this.#label) {
          this.#label.visible = false;
        }
        return;
      }
    }

    const text = formatSelectedObjectLabel(selection, instanceDetails);
    if (text.length === 0) {
      if (this.#label) {
        this.#label.visible = false;
      }
      return;
    }

    const label = this.#ensureLabel();
    if (text !== this.#lastText) {
      label.setText(text);
      this.#lastText = text;
    }
    const validPosition = computeSelectedObjectWorldPosition(
      selection,
      label.position,
      instanceDetails,
    );
    label.visible = validPosition;
    if (validPosition) {
      const camera = this.renderer.cameraHandler.getActiveCamera();
      camera.updateWorldMatrix(true, false);
      updateBillboardBounds(label, label.position, camera, this.renderer.input.canvasSize);
    }
  };

  #handleRemoved = (): void => {
    this.#handleSelectedRenderable(undefined);
  };

  #handleSelectedRenderable = (selection: PickedRenderable | undefined): void => {
    this.#selected?.renderable.removeEventListener("removed", this.#handleRemoved);
    this.#selected = selection;
    selection?.renderable.addEventListener("removed", this.#handleRemoved);
    this.#syncSelection();
  };
}
