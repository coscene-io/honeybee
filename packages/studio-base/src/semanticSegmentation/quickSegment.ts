// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

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
 * Temporary quick-annotation endpoint: the SAM2 server in tools/seg-quick-annotation behind a
 * Cloudflare Tunnel, until the AnnotationService gains SegmentFrame (cosceneapis #870). Hard-coded
 * on purpose: this is a stopgap, not deployment configuration. Frames are sent only when the user
 * runs quick annotation.
 */
export const QUICK_SEGMENT_URL = "https://sam.reily.app";

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

/**
 * Last uploaded frame. The server caches its embedding under a random token chosen at upload, so
 * later clicks on the same frame skip the upload and never match another user's or recording's
 * frame.
 */
let uploaded: { key: string; token: string } | undefined;

export async function quickSegment(
  request: QuickSegmentRequest,
  signal?: AbortSignal,
): Promise<QuickSegmentResult> {
  const frameTimeMicros = truncateToMicros(request.logTimeNs).toString();
  // The displayed image identifies the frame within this page, also across recordings.
  const key = `${request.topic}@${frameTimeMicros}@${request.imageUrl}`;
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
  const send = async (cached: { token: string } | undefined) => {
    const frameToken = cached?.token ?? uuidv4();
    const form = new FormData();
    form.set("request", JSON.stringify({ ...body, frameToken }) ?? "{}");
    if (!cached) {
      const jpeg: Blob = await frameJpeg(request.imageUrl, request.width, request.height);
      form.set("image", jpeg, "frame.jpg");
    }
    const response = await fetch(`${QUICK_SEGMENT_URL}/segment`, {
      method: "POST",
      body: form,
      ...(signal ? { signal } : {}),
    });
    return { response, frameToken };
  };
  const cached = uploaded?.key === key ? uploaded : undefined;
  let { response, frameToken } = await send(cached);
  if (response.status === 400 && cached) {
    // The server no longer holds this frame (restart, or another frame since): upload it now.
    ({ response, frameToken } = await send(undefined));
  }
  // A tunnel or proxy failure answers with an HTML page, not the server's JSON.
  let result: { counts?: string; width?: number; height?: number; score?: number; error?: string };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    result = {};
  }
  if (!response.ok || result.counts == undefined) {
    throw new Error(result.error ?? `快速标注失败（HTTP ${response.status}）`);
  }
  uploaded = { key, token: frameToken };
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
