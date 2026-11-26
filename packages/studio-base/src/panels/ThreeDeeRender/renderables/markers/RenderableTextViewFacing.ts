// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@foxglove/three-text";

import { RenderableMarker } from "./RenderableMarker";
import type { Renderer } from "../../Renderer";
import {
  acquirePooledLabel,
  releasePooledLabel,
  setLabelContrastingColors,
} from "../../labels/labelUtils";
import { Marker } from "../../ros";

export class RenderableTextViewFacing extends RenderableMarker {
  #label: Label;

  public constructor(
    topic: string,
    marker: Marker,
    receiveTime: bigint | undefined,
    renderer: Renderer,
  ) {
    super(topic, marker, receiveTime, renderer);

    this.#label = acquirePooledLabel(renderer.labelPool);
    this.#label.setBillboard(true);

    this.add(this.#label);
    this.update(marker, receiveTime);
  }

  public override dispose(): void {
    releasePooledLabel(this.renderer.labelPool, this.#label);
    super.dispose();
  }

  public override update(newMarker: Marker, receiveTime: bigint | undefined): void {
    super.update(newMarker, receiveTime);
    const marker = this.userData.marker;

    this.#label.setText(marker.text);
    setLabelContrastingColors(this.#label, marker.color);
    this.#label.setLineHeight(marker.scale.z);
    this.#label.userData.pose = marker.pose;
  }
}
