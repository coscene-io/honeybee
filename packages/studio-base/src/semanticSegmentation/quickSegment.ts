// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Client } from "@connectrpc/connect";

import type { AnnotationService } from "@foxglove/studio-base/services/api/spatial-annotation/generated/coscene/dataplatform/v1alpha3/services/annotation_pb";

import { microsToTimestamp, truncateToMicros } from "./frameTime";
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

/** `undefined` mask: the points select no foreground; the caller keeps its previous result. */
export type QuickSegmentResult = { mask: SegmentationMask | undefined; score: number };

/** Re-encode the displayed frame as JPEG at full size: a few hundred KB instead of a large PNG. */
async function frameJpeg(imageUrl: string, width: number, height: number): Promise<Uint8Array> {
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
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/**
 * Quick annotation through `AnnotationService.SegmentFrame`: the displayed
 * frame and every click so far for one object. The server keeps no session, so every call uploads
 * the frame; SAM recomputes the embedding on a GPU in tens of milliseconds.
 */
export async function quickSegment(
  client: Pick<Client<typeof AnnotationService>, "segmentFrame">,
  recordName: string,
  request: QuickSegmentRequest,
  signal?: AbortSignal,
): Promise<QuickSegmentResult> {
  const image = await frameJpeg(request.imageUrl, request.width, request.height);
  const response = await client.segmentFrame(
    {
      record: recordName,
      topic: request.topic,
      // The wire frame identity: log time truncated to microseconds.
      frameTime: microsToTimestamp(truncateToMicros(request.logTimeNs)),
      image,
      points: request.points.map((point) => ({
        x: point.x * request.width,
        y: point.y * request.height,
        negative: !point.positive,
      })),
    },
    signal ? { signal } : {},
  );
  if (response.width !== request.width || response.height !== request.height) {
    throw new Error(
      `点选服务返回 ${response.width}×${response.height}，但 ${request.topic} 解码尺寸是 ${request.width}×${request.height}`,
    );
  }
  return {
    mask:
      response.mask == undefined
        ? undefined
        : { counts: response.mask.counts, width: request.width, height: request.height },
    score: response.score,
  };
}
