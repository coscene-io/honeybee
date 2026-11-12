// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { PropagationSeed, SegmentationDocument } from "../types";
import { hasPolygonArea } from "./editorGeometry";

/** What one canvas can propagate: every seeded instance on its current frame of one video. */
export type CanvasPropagationScope = {
  videoId: string;
  frameId: string;
  seeds: PropagationSeed[];
};

/**
 * The service propagates all instances of one canvas in a single request and never across
 * canvases, so the scope is read from the canvas's frame and ignores tree selection.
 */
export function buildCanvasPropagationScope(
  document: Pick<SegmentationDocument, "frames" | "instances" | "annotations"> | undefined,
  frameId: string | undefined,
): CanvasPropagationScope | undefined {
  const frame = frameId ? document?.frames.find((item) => item.id === frameId) : undefined;
  if (!document || !frame) {
    return undefined;
  }
  const seeds: PropagationSeed[] = [];
  for (const instance of document.instances) {
    const annotation = Object.values(document.annotations).find(
      (item) => item.frameId === frame.id && item.instanceId === instance.id,
    );
    const polygons = (annotation?.polygons ?? [])
      .filter(
        (polygon) =>
          hasPolygonArea(polygon.points) &&
          polygon.points.every((point) =>
            [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
          ),
      )
      .map((polygon) => ({
        id: polygon.id,
        points: polygon.points.map((point) => ({ ...point })),
      }));
    if (polygons.length > 0) {
      seeds.push({ instanceId: instance.id, polygons });
    }
  }
  return { videoId: frame.videoId, frameId: frame.id, seeds };
}
