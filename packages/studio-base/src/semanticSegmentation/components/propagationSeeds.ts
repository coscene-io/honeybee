// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationPolygon, SemanticSegmentationStore } from "../types";
import { hasPolygonArea } from "./editorGeometry";

/** Snapshot only current-frame selected geometry; parent/child overlap never duplicates a seed. */
export function buildPropagationSeeds(
  state: Pick<SemanticSegmentationStore, "document" | "currentFrameId" | "selection" | "focus">,
): { instanceId: string; polygons: SegmentationPolygon[] }[] {
  const document = state.document;
  if (!document || !state.currentFrameId) {
    return [];
  }
  const nodes = state.selection.length > 0 ? state.selection : state.focus ? [state.focus] : [];
  const annotations = Object.values(document.annotations).filter(
    (annotation) => annotation.frameId === state.currentFrameId,
  );
  const seeds = new Map<string, Map<string, SegmentationPolygon>>();
  for (const node of nodes) {
    for (const annotation of annotations) {
      const instance = document.instances.find((item) => item.id === annotation.instanceId);
      if (
        !instance ||
        (node.type === "class" && instance.classId !== node.id) ||
        (node.type === "instance" && instance.id !== node.id)
      ) {
        continue;
      }
      for (const polygon of annotation.polygons) {
        if (
          (node.type === "polygon" && polygon.id !== node.id) ||
          !hasPolygonArea(polygon.points) ||
          polygon.points.some((point) =>
            [point.x, point.y].some((value) => !Number.isFinite(value) || value < 0 || value > 1),
          )
        ) {
          continue;
        }
        let polygons = seeds.get(instance.id);
        if (!polygons) {
          polygons = new Map();
          seeds.set(instance.id, polygons);
        }
        polygons.set(polygon.id, {
          id: polygon.id,
          points: polygon.points.map((point) => ({ ...point })),
        });
      }
    }
  }
  return [...seeds].map(([instanceId, polygons]) => ({
    instanceId,
    polygons: [...polygons.values()],
  }));
}
