// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

export type LabelVisibilityCandidate = {
  id: string;
  worldPosition: THREE.Vector3;
  priority: number;
  alwaysVisible: boolean;
  wasVisible: boolean;
  visible: boolean;
};

export type LabelVisibilityOptions = {
  camera: THREE.Camera;
  canvasWidth: number;
  canvasHeight: number;
  maxDistance?: number;
  minSpacingPx?: number;
};

type ActiveEntry = {
  candidate: LabelVisibilityCandidate;
  distance: number;
  screenX: number;
  screenY: number;
};

type GridCell = {
  points: number[];
  count: number;
};

// Slight hysteresis prevents labels right at the distance or overlap boundary from flickering
// during small camera rotations or zoom increments.
const DISTANCE_HYSTERESIS_FACTOR = 1.03;
const PRIORITY_DISTANCE_HYSTERESIS_FACTOR = 0.97;
const GRID_OFFSET = 100000;
const GRID_STRIDE = 200001;

const tempCameraPos = new THREE.Vector3();
const tempProjected = new THREE.Vector3();

/**
 * Evaluates distance culling and screen-space density culling for 3D labels while reusing
 * internal scratch buffers across frames to avoid per-frame allocations in dense scenes.
 */
export class LabelDensityCuller {
  #entryPool: ActiveEntry[] = [];
  #activeEntries: ActiveEntry[] = [];
  #grid = new Map<number, GridCell>();
  #cellPool: GridCell[] = [];

  public evaluate(
    candidates: readonly LabelVisibilityCandidate[],
    options: LabelVisibilityOptions,
  ): void {
    if (candidates.length === 0) {
      return;
    }

    const { camera, canvasWidth, canvasHeight, maxDistance, minSpacingPx } = options;
    const hasMaxDistance =
      maxDistance != undefined && Number.isFinite(maxDistance) && maxDistance > 0;
    const hasMinSpacing =
      minSpacingPx != undefined &&
      Number.isFinite(minSpacingPx) &&
      minSpacingPx > 0 &&
      canvasWidth > 0 &&
      canvasHeight > 0;

    if (!hasMaxDistance && !hasMinSpacing) {
      for (const candidate of candidates) {
        candidate.visible = true;
      }
      return;
    }

    camera.getWorldPosition(tempCameraPos);
    const orthographic = camera instanceof THREE.OrthographicCamera;
    const maxDistSq = hasMaxDistance ? maxDistance * maxDistance : Infinity;
    const maxDistKeepSq = hasMaxDistance
      ? maxDistance * DISTANCE_HYSTERESIS_FACTOR * (maxDistance * DISTANCE_HYSTERESIS_FACTOR)
      : Infinity;

    let activeCount = 0;

    for (const candidate of candidates) {
      const distSq = candidate.worldPosition.distanceToSquared(tempCameraPos);

      if (hasMaxDistance && !candidate.alwaysVisible) {
        const thresholdSq = candidate.wasVisible ? maxDistKeepSq : maxDistSq;
        // An orthographic camera's depth is chosen for clipping, independent of zoom.
        let cutoffDistanceSq = distSq;
        if (orthographic) {
          tempProjected.copy(candidate.worldPosition).applyMatrix4(camera.matrixWorldInverse);
          cutoffDistanceSq = tempProjected.x ** 2 + tempProjected.y ** 2;
        }
        if (cutoffDistanceSq > thresholdSq) {
          candidate.visible = false;
          continue;
        }
      }

      if (!hasMinSpacing) {
        candidate.visible = true;
        continue;
      }

      tempProjected.copy(candidate.worldPosition).project(camera);
      const inDepthRange =
        Number.isFinite(tempProjected.x) &&
        Number.isFinite(tempProjected.y) &&
        Number.isFinite(tempProjected.z) &&
        tempProjected.z >= -1 &&
        tempProjected.z <= 1;

      if (!inDepthRange) {
        candidate.visible = candidate.alwaysVisible;
        continue;
      }

      const screenX = (tempProjected.x * 0.5 + 0.5) * canvasWidth;
      const screenY = (0.5 - tempProjected.y * 0.5) * canvasHeight;

      // Skip off-screen labels from density tracking (and cull non-pinned off-screen labels to
      // avoid unnecessary draw calls outside the viewport).
      const margin = minSpacingPx;
      if (
        screenX < -margin ||
        screenX > canvasWidth + margin ||
        screenY < -margin ||
        screenY > canvasHeight + margin
      ) {
        candidate.visible = candidate.alwaysVisible;
        continue;
      }

      let entry = this.#entryPool[activeCount];
      if (!entry) {
        entry = {
          candidate,
          distance: 0,
          screenX: 0,
          screenY: 0,
        };
        this.#entryPool.push(entry);
      } else {
        entry.candidate = candidate;
      }
      entry.distance = Math.sqrt(distSq);
      entry.screenX = screenX;
      entry.screenY = screenY;
      this.#activeEntries[activeCount] = entry;
      activeCount++;
    }

    if (!hasMinSpacing) {
      return;
    }

    this.#activeEntries.length = activeCount;
    if (activeCount === 0) {
      return;
    }

    this.#activeEntries.sort(compareActiveEntries);

    const cellSize = minSpacingPx;
    const minSpacingSq = minSpacingPx * minSpacingPx;
    this.#grid.clear();

    for (let i = 0; i < activeCount; i++) {
      const entry = this.#activeEntries[i]!;
      const gx = Math.floor(entry.screenX / cellSize);
      const gy = Math.floor(entry.screenY / cellSize);

      if (entry.candidate.alwaysVisible) {
        entry.candidate.visible = true;
        this.#insertIntoGrid(gx, gy, entry.screenX, entry.screenY);
        continue;
      }

      if (this.#hasNeighborWithin(gx, gy, entry.screenX, entry.screenY, minSpacingSq)) {
        entry.candidate.visible = false;
        continue;
      }

      entry.candidate.visible = true;
      this.#insertIntoGrid(gx, gy, entry.screenX, entry.screenY);
    }
  }

  #insertIntoGrid(gx: number, gy: number, screenX: number, screenY: number): void {
    const key = cellKey(gx, gy);
    let cell = this.#grid.get(key);
    if (!cell) {
      const index = this.#grid.size;
      cell = this.#cellPool[index] ?? { points: [], count: 0 };
      cell.count = 0;
      this.#cellPool[index] = cell;
      this.#grid.set(key, cell);
    }
    cell.points[cell.count] = screenX;
    cell.points[cell.count + 1] = screenY;
    cell.count += 2;
  }

  #hasNeighborWithin(
    gx: number,
    gy: number,
    screenX: number,
    screenY: number,
    minSpacingSq: number,
  ): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.#grid.get(cellKey(gx + dx, gy + dy));
        if (!cell) {
          continue;
        }
        const points = cell.points;
        const count = cell.count;
        for (let i = 0; i < count; i += 2) {
          const px = points[i]!;
          const py = points[i + 1]!;
          const distX = px - screenX;
          const distY = py - screenY;
          if (distX * distX + distY * distY < minSpacingSq) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

function cellKey(gx: number, gy: number): number {
  return (gx + GRID_OFFSET) * GRID_STRIDE + (gy + GRID_OFFSET);
}

function compareActiveEntries(a: ActiveEntry, b: ActiveEntry): number {
  if (a.candidate.priority !== b.candidate.priority) {
    return b.candidate.priority - a.candidate.priority;
  }

  const aEffectiveDist = a.candidate.wasVisible
    ? a.distance * PRIORITY_DISTANCE_HYSTERESIS_FACTOR
    : a.distance;
  const bEffectiveDist = b.candidate.wasVisible
    ? b.distance * PRIORITY_DISTANCE_HYSTERESIS_FACTOR
    : b.distance;

  if (aEffectiveDist !== bEffectiveDist) {
    return aEffectiveDist - bEffectiveDist;
  }

  if (a.candidate.id < b.candidate.id) {
    return -1;
  }
  if (a.candidate.id > b.candidate.id) {
    return 1;
  }
  return 0;
}
