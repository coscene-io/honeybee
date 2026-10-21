// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Phase-one prototype contract. Times are relative to the source start, never wall-clock floats. */
export const ANNOTATION_TICK_NS = 100_000_000n;
export type Point = { x: number; y: number };
export type AnnotationClass = { id: string; name: string; color: string };
export type AnnotationInstance = { id: string; classId: string; name: string };
export type Polygon = { id: string; instanceId: string; points: Point[] };
export type AnnotationDocument = {
  classes: AnnotationClass[];
  instances: AnnotationInstance[];
  frames: Record<string, Polygon[]>;
};
export type AnnotationSnapshot = {
  revision: number;
  document: AnnotationDocument;
  message: string;
};
export type Revision = { revision: number; message: string };
export type WriteRequest = {
  scope: string;
  expectedRevision: number;
  requestId: string;
};

/** All persistence crosses this async boundary, including the in-process implementation. */
export interface AnnotationService {
  read(scope: string): Promise<AnnotationSnapshot>;
  history(scope: string): Promise<Revision[]>;
  commit(
    request: WriteRequest & { document: AnnotationDocument; message: string },
  ): Promise<AnnotationSnapshot>;
  rollback(request: WriteRequest & { targetRevision: number }): Promise<AnnotationSnapshot>;
}

export function emptyDocument(): AnnotationDocument {
  return { classes: [], instances: [], frames: {} };
}

export function cloneDocument(document: AnnotationDocument): AnnotationDocument {
  return structuredClone(document);
}

export function nearestAnnotationFrame(timeNs: bigint, startNs: bigint): number {
  const relative = timeNs - startNs;
  return relative <= 0n ? 0 : Number((relative + ANNOTATION_TICK_NS / 2n) / ANNOTATION_TICK_NS);
}

/** A source may end between annotation ticks; never seek beyond its last available tick. */
export function clampAnnotationFrame(frame: number, startNs: bigint, endNs?: bigint): number {
  const last =
    endNs == undefined
      ? frame
      : Number((endNs > startNs ? endNs - startNs : 0n) / ANNOTATION_TICK_NS);
  return Math.max(0, Math.min(frame, last));
}

export function annotationTime(frame: number, startNs: bigint): bigint {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new Error("Annotation frame must be a non-negative integer");
  }
  return startNs + BigInt(frame) * ANNOTATION_TICK_NS;
}

/** Latest frame at/before a tick; stale images cannot accidentally receive another tick's edits. */
export function isAnnotationFrameReady(targetNs: bigint, displayedNs: bigint | undefined): boolean {
  return (
    displayedNs != undefined &&
    displayedNs <= targetNs &&
    targetNs - displayedNs < ANNOTATION_TICK_NS
  );
}

export function validateDocument(document: AnnotationDocument): void {
  const classIds = new Set(document.classes.map((item) => item.id));
  const instanceIds = new Set(document.instances.map((item) => item.id));
  if (classIds.size !== document.classes.length || instanceIds.size !== document.instances.length) {
    throw new Error("Duplicate class or instance ID");
  }
  for (const item of document.classes) {
    if (!item.id || !item.name.trim()) {
      throw new Error("Classes need an ID and a name");
    }
  }
  for (const item of document.instances) {
    if (!item.id || !item.name.trim() || !classIds.has(item.classId)) {
      throw new Error("Instance must belong to an existing class");
    }
  }
  for (const [frame, polygons] of Object.entries(document.frames)) {
    if (!/^\d+$/.test(frame) || !Number.isSafeInteger(Number(frame))) {
      throw new Error("Invalid annotation frame");
    }
    const ids = new Set<string>();
    for (const polygon of polygons) {
      if (
        !polygon.id ||
        ids.has(polygon.id) ||
        !instanceIds.has(polygon.instanceId) ||
        polygon.points.length < 3
      ) {
        throw new Error("Polygon needs a unique ID, an instance and at least three vertices");
      }
      ids.add(polygon.id);
      if (
        polygon.points.some(
          (point) =>
            !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0,
        )
      ) {
        throw new Error("Polygon coordinates must be finite original-image pixels");
      }
    }
  }
}
