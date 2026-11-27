// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type * as THREE from "three";

import { toNanoSec } from "@foxglove/rostime";
import { SceneEntity, TextPrimitive } from "@foxglove/schemas";
import { Label, LabelPool } from "@foxglove/three-text";

import { RenderablePrimitive } from "./RenderablePrimitive";
import type { IRenderer } from "../../IRenderer";
import { makeRgba, stringToRgba } from "../../color";
import {
  acquirePooledLabel,
  releasePooledLabel,
  setLabelContrastingColors,
} from "../../labels/labelUtils";
import { LayerSettingsEntity } from "../../settings";

const tempRgba = makeRgba();

export class RenderableTexts extends RenderablePrimitive {
  #labelPool: LabelPool;
  #labels: Label[] = [];

  public constructor(renderer: IRenderer) {
    super("", renderer);

    this.#labelPool = renderer.labelPool;
  }
  #ensureCapacity(newLength: number): void {
    const oldLength = this.#labels.length;
    if (newLength > oldLength) {
      for (let i = oldLength; i < newLength; i++) {
        const newLabel = acquirePooledLabel(this.#labelPool);
        newLabel.userData.labelPrimitiveIndex = i;
        this.#labels.push(newLabel);
        this.add(newLabel);
      }
    }
  }

  #updateTexts(texts: TextPrimitive[]) {
    this.#ensureCapacity(texts.length);
    const overrideColor = this.userData.settings.color
      ? stringToRgba(tempRgba, this.userData.settings.color)
      : undefined;

    let i = 0;
    for (const text of texts) {
      const color = overrideColor ?? text.color;
      const label = this.#labels[i];

      if (!label) {
        throw new Error("invariant: labels array smaller than requested");
      }

      label.setText(text.text);
      setLabelContrastingColors(label, color);
      label.setLineHeight(text.font_size);
      // note that billboard needs to be true for scale_invariant to work
      label.setBillboard(text.billboard);
      // attenuation -> size accounts for distance from camera
      // scale_invariant negates this and should make it the same size always
      label.setSizeAttenuation(!text.scale_invariant);
      label.quaternion.set(
        text.pose.orientation.x,
        text.pose.orientation.y,
        text.pose.orientation.z,
        text.pose.orientation.w,
      );

      label.position.set(text.pose.position.x, text.pose.position.y, text.pose.position.z);
      i++;
    }
    // need to release the no longer used labels so that they don't linger on the scene
    if (i < this.#labels.length) {
      // cuts off remaining labels and loops through them to release back to labelPool
      for (const label of this.#labels.splice(i)) {
        releasePooledLabel(this.#labelPool, label);
      }
    }
  }

  public override getLabelWorldPosition(
    out: THREE.Vector3,
    primitiveIndex?: number,
  ): THREE.Vector3 | undefined {
    const label =
      primitiveIndex == undefined
        ? this.#labels.find((item) => item.mesh.count > 0)
        : this.#labels[primitiveIndex];
    return label && label.mesh.count > 0 ? label.getWorldPosition(out) : undefined;
  }

  public override dispose(): void {
    for (const label of this.#labels) {
      releasePooledLabel(this.#labelPool, label);
    }
    this.#labels.length = 0;
    super.dispose();
  }

  public override update(
    topic: string | undefined,
    entity: SceneEntity | undefined,
    settings: LayerSettingsEntity,
    receiveTime: bigint,
  ): void {
    super.update(topic, entity, settings, receiveTime);
    if (entity) {
      const lifetimeNs = toNanoSec(entity.lifetime);
      this.userData.expiresAt = lifetimeNs === 0n ? undefined : receiveTime + lifetimeNs;
      this.#updateTexts(entity.texts);
    }
  }

  public updateSettings(settings: LayerSettingsEntity): void {
    this.update(this.userData.topic, this.userData.entity, settings, this.userData.receiveTime);
  }
}
