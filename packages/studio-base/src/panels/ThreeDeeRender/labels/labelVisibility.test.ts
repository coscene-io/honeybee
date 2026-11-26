// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { LabelDensityCuller, LabelVisibilityCandidate } from "./labelVisibility";

function makeCamera(position: [number, number, number] = [0, 0, 10]): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function makeCandidate(
  id: string,
  pos: [number, number, number],
  overrides: Partial<LabelVisibilityCandidate> = {},
): LabelVisibilityCandidate {
  return {
    id,
    worldPosition: new THREE.Vector3(pos[0], pos[1], pos[2]),
    priority: 0,
    alwaysVisible: false,
    wasVisible: true,
    visible: true,
    ...overrides,
  };
}

describe("LabelDensityCuller", () => {
  it("keeps all labels visible when both maxDistance and minSpacingPx are disabled", () => {
    const culler = new LabelDensityCuller();
    const camera = makeCamera();
    const candidates = [makeCandidate("a", [0, 0, 0]), makeCandidate("b", [0, 0, 0])];

    culler.evaluate(candidates, {
      camera,
      canvasWidth: 800,
      canvasHeight: 600,
      maxDistance: 0,
      minSpacingPx: 0,
    });

    expect(candidates.map((c) => c.visible)).toEqual([true, true]);
  });

  it("hides labels beyond maxDistance while applying hysteresis and exempting alwaysVisible", () => {
    const culler = new LabelDensityCuller();
    const camera = makeCamera([0, 0, 10]);

    const near = makeCandidate("near", [0, 0, 5]); // dist 5
    const boundaryVisible = makeCandidate("boundary", [0, 0, -0.2], { wasVisible: true }); // dist 10.2 (within 1.03x of 10)
    const boundaryHidden = makeCandidate("boundary_hidden", [0, 0, -0.2], { wasVisible: false }); // dist 10.2 (> 10)
    const far = makeCandidate("far", [0, 0, -50]); // dist 60
    const pinnedFar = makeCandidate("pinned", [0, 0, -50], { alwaysVisible: true, priority: 3 });

    culler.evaluate([near, boundaryVisible, boundaryHidden, far, pinnedFar], {
      camera,
      canvasWidth: 800,
      canvasHeight: 600,
      maxDistance: 10,
    });

    expect(near.visible).toBe(true);
    expect(boundaryVisible.visible).toBe(true);
    expect(boundaryHidden.visible).toBe(false);
    expect(far.visible).toBe(false);
    expect(pinnedFar.visible).toBe(true);
  });

  it("thins overlapping screen-space labels by priority and camera distance", () => {
    const culler = new LabelDensityCuller();
    const camera = makeCamera([0, 0, 10]);

    const farNormal = makeCandidate("far_normal", [0, 0, -2]);
    const nearNormal = makeCandidate("near_normal", [0, 0, 2]);
    const selectedFar = makeCandidate("selected_far", [0, 0, -4], {
      priority: 3,
      alwaysVisible: true,
    });
    const separate = makeCandidate("separate", [3, 0, 0]);

    culler.evaluate([farNormal, nearNormal, selectedFar, separate], {
      camera,
      canvasWidth: 800,
      canvasHeight: 600,
      minSpacingPx: 40,
    });

    // selectedFar takes priority at the center and blocks overlapping normal labels
    expect(selectedFar.visible).toBe(true);
    expect(nearNormal.visible).toBe(false);
    expect(farNormal.visible).toBe(false);
    // separate label is well outside 40px radius
    expect(separate.visible).toBe(true);
  });

  it("reveals dense labels when zooming closer or resizing to a larger viewport", () => {
    const culler = new LabelDensityCuller();
    const farCamera = makeCamera([0, 0, 30]);
    const a = makeCandidate("a", [-0.3, 0, 0]);
    const b = makeCandidate("b", [0.3, 0, 0]);

    culler.evaluate([a, b], {
      camera: farCamera,
      canvasWidth: 800,
      canvasHeight: 600,
      minSpacingPx: 50,
    });
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);

    // Zoom in so screen-space separation exceeds 50px
    const nearCamera = makeCamera([0, 0, 3]);
    culler.evaluate([a, b], {
      camera: nearCamera,
      canvasWidth: 800,
      canvasHeight: 600,
      minSpacingPx: 50,
    });
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
  });

  it("handles dense 500-label scenes cleanly without unbounded overlap", () => {
    const culler = new LabelDensityCuller();
    const camera = makeCamera([0, 0, 15]);
    const candidates: LabelVisibilityCandidate[] = [];

    for (let i = 0; i < 500; i++) {
      const col = i % 25;
      const row = Math.floor(i / 25);
      candidates.push(makeCandidate(`frame_${i}`, [(col - 12) * 0.2, (row - 10) * 0.2, 0]));
    }

    culler.evaluate(candidates, {
      camera,
      canvasWidth: 800,
      canvasHeight: 600,
      minSpacingPx: 48,
    });

    const visibleCount = candidates.filter((c) => c.visible).length;
    expect(visibleCount).toBeGreaterThan(0);
    expect(visibleCount).toBeLessThan(candidates.length / 2);
  });
});
