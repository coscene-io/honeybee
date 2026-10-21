// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Vector2 } from "three";

import { PinholeCameraModel } from "@foxglove/den/image";

import { createImageAnnotationViewport } from "./viewport";
import { ImageModeCamera } from "../renderables/ImageMode/ImageModeCamera";

const model = new PinholeCameraModel({
  width: 1280,
  height: 720,
  distortion_model: "",
  D: [],
  binning_x: 0,
  binning_y: 0,
  K: [500, 0, 640, 0, 500, 360, 0, 0, 1],
  P: [500, 0, 640, 0, 0, 500, 360, 0, 0, 0, 1, 0],
  R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  roi: { x_offset: 0, y_offset: 0, width: 0, height: 0, do_rectify: false },
});

it.each([0, 90, 180, 270] as const)(
  "round-trips original-image floats at rotation %s, with pan, zoom, flips and aspect fit",
  (rotation) => {
    for (const flip of [false, true]) {
      const camera = new ImageModeCamera();
      camera.updateCamera(model);
      camera.setCanvasSize(900, 700);
      camera.setRotation(rotation);
      camera.setFlipHorizontal(flip);
      camera.setFlipVertical(!flip);
      camera.updateZoomFromWheel(1.75, new Vector2(400, 300));
      camera.setPanOffset(new Vector2(40, -25));
      const viewport = createImageAnnotationViewport(
        model,
        camera,
        { width: 900, height: 700 },
        "/camera",
        100n,
      );
      for (const point of [
        { x: 300.125, y: 280.875 },
        { x: 900.5, y: 500.25 },
      ]) {
        const roundTrip = viewport.unproject(viewport.project(point));
        expect(roundTrip?.x).toBeCloseTo(point.x, 6);
        expect(roundTrip?.y).toBeCloseTo(point.y, 6);
      }
    }
  },
);
