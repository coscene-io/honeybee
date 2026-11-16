// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { localPropagationUrl } from "@foxglove/studio-base/util/coscene/annotation";

import { truncateToMicros } from "./frameTime";
import type { SegmentationMask } from "./types";

/** A click in normalized [0, 1] image coordinates; negative points carve the mask away. */
export type QuickPoint = { x: number; y: number; positive: boolean };

export type QuickSegmentRequest = {
  topic: string;
  logTimeNs: string;
  width: number;
  height: number;
  points: QuickPoint[];
};

export type QuickSegmentResult = { mask: SegmentationMask; score: number };

/**
 * Quick annotation: SAM2 click-to-mask on the local sidecar (tools/seg-local-propagation).
 * Not part of the AnnotationService contract. Undefined when no sidecar is configured.
 */
export function quickSegmentAvailable(): boolean {
  return localPropagationUrl() != undefined;
}

export async function quickSegment(
  request: QuickSegmentRequest,
  signal?: AbortSignal,
): Promise<QuickSegmentResult> {
  const base = localPropagationUrl();
  if (base == undefined) {
    throw new Error("快速标注需要本机 SAM2 服务（tools/seg-local-propagation）");
  }
  const response = await fetch(`${base}/segment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: request.topic,
      // The wire frame identity: log time truncated to microseconds.
      frameTimeMicros: truncateToMicros(request.logTimeNs).toString(),
      points: request.points.map((point) => ({
        x: point.x * request.width,
        y: point.y * request.height,
        positive: point.positive,
      })),
    }),
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json()) as {
    counts?: string;
    width?: number;
    height?: number;
    score?: number;
    error?: string;
  };
  if (!response.ok || body.counts == undefined) {
    throw new Error(body.error ?? `快速标注失败（HTTP ${response.status}）`);
  }
  if (body.width !== request.width || body.height !== request.height) {
    throw new Error(
      `本机服务返回 ${body.width}×${body.height}，但 ${request.topic} 解码尺寸是 ${request.width}×${request.height}`,
    );
  }
  return {
    mask: { counts: body.counts, width: request.width, height: request.height },
    score: body.score ?? 0,
  };
}
