// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { nativeImageView } from "./nativeImageTransform";

function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0], 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  const mesh = new THREE.Mesh(geometry);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  mesh.updateMatrixWorld();
  return { mesh, camera };
}

it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5])(
  "uses rendered projection for rotation %s, pan, zoom and mirroring",
  (rotation) => {
    const { mesh, camera } = fixture();
    camera.rotation.z = rotation;
    camera.zoom = 1.7;
    camera.position.x = 0.3;
    camera.position.y = -0.4;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    mesh.scale.x = -1;
    mesh.updateMatrixWorld();
    const view = nativeImageView(mesh, camera, 800, 600, 1920, 1080)!;
    const [a, b, c, d, e, f] = view.matrix;
    const expected = new THREE.Vector3(-0.5, 0.4, 0).applyMatrix4(mesh.matrixWorld).project(camera);
    expect(a * (1920 * 0.25) + c * (1080 * 0.3) + e).toBeCloseTo((expected.x + 1) * 400);
    expect(b * (1920 * 0.25) + d * (1080 * 0.3) + f).toBeCloseTo((1 - expected.y) * 300);
  },
);

it("rejects a non-affine image mesh instead of attaching polygons to inaccurate pixels", () => {
  const { mesh, camera } = fixture();
  mesh.geometry.getAttribute("position").setX(3, 0.5);
  expect(nativeImageView(mesh, camera, 800, 600, 1920, 1080)).toBeUndefined();
});
