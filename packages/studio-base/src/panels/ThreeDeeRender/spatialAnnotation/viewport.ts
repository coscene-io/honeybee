// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { PinholeCameraModel } from "@foxglove/den/image";

import { Point } from "./model";

export type ImageAnnotationViewport = {
  topic: string;
  displayedTimeNs: bigint;
  imageWidth: number;
  imageHeight: number;
  project: (point: Point) => Point;
  unproject: (point: Point) => Point | undefined;
};

/** Reuse the exact calibrated ImageMode projection, including zoom, pan, rotation and flips. */
export function createImageAnnotationViewport(
  model: PinholeCameraModel,
  activeCamera: THREE.PerspectiveCamera,
  size: { width: number; height: number },
  topic: string,
  displayedTimeNs: bigint,
): ImageAnnotationViewport {
  const camera = activeCamera.clone();
  camera.updateMatrixWorld();
  const { width, height } = size;
  return {
    topic,
    displayedTimeNs,
    imageWidth: model.width,
    imageHeight: model.height,
    project(point) {
      const projected = new THREE.Vector3();
      model.projectPixelTo3dPlane(projected, point);
      projected.project(camera);
      return { x: ((projected.x + 1) * width) / 2, y: ((1 - projected.y) * height) / 2 };
    },
    unproject(point) {
      if (width <= 0 || height <= 0) {
        return undefined;
      }
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2((point.x / width) * 2 - 1, 1 - (point.y / height) * 2),
        camera,
      );
      const planePoint = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -1),
        new THREE.Vector3(),
      );
      if (planePoint == undefined) {
        return undefined;
      }
      const raw = model.distortNormalized(new THREE.Vector2(), planePoint);
      const x = raw.x * model.K[0] + model.K[2];
      const y = raw.y * model.K[4] + model.K[5];
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > model.width ||
        y > model.height
      ) {
        return undefined;
      }
      return { x, y };
    },
  };
}
