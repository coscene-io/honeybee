// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

export type NativeImageView = {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  /** Maps image pixels to native canvas CSS pixels, using the rendered mesh and camera. */
  matrix: [number, number, number, number, number, number];
};

type CachedView = {
  geometry: THREE.BufferGeometry;
  versions: [number, number];
  inputs: number[];
  view: NativeImageView | undefined;
};
const cachedViews = new WeakMap<THREE.Mesh, CachedView>();

/**
 * `nativeImageView`, recomputed only when the mesh, its geometry, the camera or a size changed.
 * Image panels ask on every rendered frame; an unchanged view keeps its object identity, so
 * consumers can compare views by reference.
 */
export function cachedNativeImageView(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
): NativeImageView | undefined {
  const geometry = mesh.geometry;
  const version = (name: string) => {
    if (!geometry.hasAttribute(name)) {
      return -1;
    }
    const attribute = geometry.getAttribute(name);
    return attribute instanceof THREE.InterleavedBufferAttribute
      ? attribute.data.version
      : attribute.version;
  };
  const versions: [number, number] = [version("position"), version("uv")];
  const inputs = [
    ...mesh.matrixWorld.elements,
    ...camera.projectionMatrix.elements,
    ...camera.matrixWorldInverse.elements,
    width,
    height,
    imageWidth,
    imageHeight,
  ];
  const cached = cachedViews.get(mesh);
  if (
    cached?.geometry === geometry &&
    cached.versions[0] === versions[0] &&
    cached.versions[1] === versions[1] &&
    cached.inputs.every((value, index) => value === inputs[index])
  ) {
    return cached.view;
  }
  const view = nativeImageView(mesh, camera, width, height, imageWidth, imageHeight);
  cachedViews.set(mesh, { geometry, versions, inputs, view });
  return view;
}

/** Read the actual rendered plane; never duplicate ImageMode's fit/rotation/pan/zoom rules. */
export function nativeImageView(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
): NativeImageView | undefined {
  const positions = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  if (
    !mesh.geometry.hasAttribute("position") ||
    !mesh.geometry.hasAttribute("uv") ||
    width <= 0 ||
    height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return undefined;
  }
  const corners = new Map<string, THREE.Vector2>();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if ((u === 0 || u === 1) && (v === 0 || v === 1)) {
      const p = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(mesh.matrixWorld)
        .project(camera);
      corners.set(
        `${u}:${v}`,
        new THREE.Vector2(((p.x + 1) * width) / 2, ((1 - p.y) * height) / 2),
      );
    }
  }
  const origin = corners.get("0:0");
  const right = corners.get("1:0");
  const bottom = corners.get("0:1");
  if (!origin || !right || !bottom) {
    return undefined;
  }
  const matrix: NativeImageView["matrix"] = [
    (right.x - origin.x) / imageWidth,
    (right.y - origin.y) / imageWidth,
    (bottom.x - origin.x) / imageHeight,
    (bottom.y - origin.y) / imageHeight,
    origin.x,
    origin.y,
  ];
  if (
    !matrix.every(Number.isFinite) ||
    Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12
  ) {
    return undefined;
  }
  // Calibrated meshes can be warped. Do not offer inaccurate editing with an affine overlay.
  for (let i = 0; i < uv.count; i++) {
    const x = uv.getX(i) * imageWidth;
    const y = uv.getY(i) * imageHeight;
    const p = new THREE.Vector3()
      .fromBufferAttribute(positions, i)
      .applyMatrix4(mesh.matrixWorld)
      .project(camera);
    if (
      Math.hypot(
        ((p.x + 1) * width) / 2 - (matrix[0] * x + matrix[2] * y + matrix[4]),
        ((1 - p.y) * height) / 2 - (matrix[1] * x + matrix[3] * y + matrix[5]),
      ) > 0.5
    ) {
      return undefined;
    }
  }
  return { width, height, imageWidth, imageHeight, matrix };
}
