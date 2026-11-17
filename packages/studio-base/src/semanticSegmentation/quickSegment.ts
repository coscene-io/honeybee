// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { truncateToMicros } from "./frameTime";
import type { SegmentationMask } from "./types";

/** A click in normalized [0, 1] image coordinates; negative points carve the mask away. */
export type QuickPoint = { x: number; y: number; positive: boolean };

export type QuickSegmentRequest = {
  topic: string;
  logTimeNs: string;
  width: number;
  height: number;
  /** The displayed frame (data URL or object URL) at its decoded size. */
  imageUrl: string;
  points: QuickPoint[];
};

export type QuickSegmentResult = { mask: SegmentationMask; score: number };

/**
 * Temporary quick-annotation endpoint: a SAM2 process (tools/seg-local-propagation) behind a
 * Cloudflare Tunnel, until the AnnotationService gains SegmentFrame (cosceneapis #870). Hard-coded
 * on purpose: this is a stopgap, not deployment configuration, and every build uses it.
 */
export const QUICK_SEGMENT_URL = "https://sam.reily.app";

let enabledInTests = false;

/** Unit tests draw manual polygons unless a test opts in; they never reach the tunnel. */
export function setQuickSegmentInTests(state: "on" | "off"): void {
  enabledInTests = state === "on";
}

export function quickSegmentAvailable(): boolean {
  return process.env.NODE_ENV !== "test" || enabledInTests;
}

/** Re-encode the displayed frame as JPEG at full size: a few hundred KB instead of a large PNG. */
async function frameJpeg(imageUrl: string, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(
        `当前帧图像是 ${bitmap.width}×${bitmap.height}，源图尺寸是 ${width}×${height}`,
      );
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法读取当前帧图像");
    }
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  } finally {
    bitmap.close();
  }
}

/** Last uploaded frame: the server caches its embedding, so later clicks skip the upload. */
let uploaded: { key: string; url: string } | undefined;

export async function quickSegment(
  request: QuickSegmentRequest,
  signal?: AbortSignal,
): Promise<QuickSegmentResult> {
  const base = QUICK_SEGMENT_URL;
  const frameTimeMicros = truncateToMicros(request.logTimeNs).toString();
  const key = `${request.topic}@${frameTimeMicros}`;
  const body = {
    topic: request.topic,
    // The wire frame identity: log time truncated to microseconds.
    frameTimeMicros,
    points: request.points.map((point) => ({
      x: point.x * request.width,
      y: point.y * request.height,
      positive: point.positive,
    })),
  };
  const send = async (frame: "upload" | "cached") => {
    const form = new FormData();
    form.set("request", JSON.stringify(body) ?? "{}");
    if (frame === "upload") {
      const jpeg: Blob = await frameJpeg(request.imageUrl, request.width, request.height);
      form.set("image", jpeg, "frame.jpg");
    }
    return await fetch(`${base}/segment`, {
      method: "POST",
      body: form,
      ...(signal ? { signal } : {}),
    });
  };
  let response = await send(uploaded?.key === key && uploaded.url === base ? "cached" : "upload");
  if (response.status === 400 && uploaded?.key === key) {
    // The server lost the cached frame (restart, or another user's frame): upload it now.
    response = await send("upload");
  }
  const result = (await response.json()) as {
    counts?: string;
    width?: number;
    height?: number;
    score?: number;
    error?: string;
  };
  if (!response.ok || result.counts == undefined) {
    throw new Error(result.error ?? `快速标注失败（HTTP ${response.status}）`);
  }
  uploaded = { key, url: base };
  if (result.width !== request.width || result.height !== request.height) {
    throw new Error(
      `点选服务返回 ${result.width}×${result.height}，但 ${request.topic} 解码尺寸是 ${request.width}×${request.height}`,
    );
  }
  return {
    mask: { counts: result.counts, width: request.width, height: request.height },
    score: result.score ?? 0,
  };
}
