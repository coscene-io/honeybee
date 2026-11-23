// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { segmentationErrorText } from "../../errors";
import { bitmapOfRuns } from "../../maskCodec";
import { runsOfMask } from "../../maskGeometry";
import type { QuickPoint } from "../../quickSegment";
import type { SegmentationMask } from "../../types";
import { clampUnit } from "../editorGeometry";
import { markStrokeFrame, pointOf } from "./canvasActions";
import type { QuickResult } from "./canvasTypes";
import type { CanvasContext } from "./canvasUi";

/** The mask drawn as a translucent PNG data URL, with its bounding bitmap. */
export function quickPreview(mask: SegmentationMask, score: number): QuickResult {
  const bitmap = bitmapOfRuns(runsOfMask(mask));
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = Math.max(bitmap.w, 1);
  canvas.height = Math.max(bitmap.h, 1);
  const context = canvas.getContext("2d");
  if (context && bitmap.w > 0) {
    const pixels = context.createImageData(bitmap.w, bitmap.h);
    for (let i = 0; i < bitmap.bits.length; i++) {
      if (bitmap.bits[i] === 1) {
        pixels.data.set([76, 141, 255, 130], i * 4);
      }
    }
    context.putImageData(pixels, 0, 0);
  }
  return { mask, score, url: canvas.toDataURL(), ...bitmap };
}

/** Asks the segmentation service for a mask from the clicked points; the newest request wins. */
export function requestQuickMask(c: CanvasContext, points: QuickPoint[]): void {
  const { ui, d } = c;
  ui.setQuickPoints(points);
  ui.quickRequest.current?.abort();
  if (points.length === 0 || !points.some((item) => item.positive)) {
    ui.setQuickResult(undefined);
    ui.setQuickBusy(false);
    return;
  }
  const video = d.document?.videos.find((item) => item.id === d.frame?.videoId);
  const width = video?.width ?? ui.size.width;
  const height = video?.height ?? ui.size.height;
  const { frame, source } = d;
  if (!frame || video?.topic == undefined || !(width > 0) || !(height > 0) || !source) {
    ui.setError(c.t("frameNotReady"));
    return;
  }
  const controller = new AbortController();
  ui.quickRequest.current = controller;
  ui.setQuickBusy(true);
  void c.store
    .getState()
    .segmentFrame(
      { topic: video.topic, logTimeNs: frame.logTimeNs, width, height, imageUrl: source, points },
      controller.signal,
    )
    .then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.mask == undefined) {
        // The contract: no foreground selected, keep the previous result.
        ui.setNotice(c.t("quickSelectsNothing"));
        ui.setError(undefined);
        return;
      }
      ui.setQuickResult(quickPreview(result.mask, result.score));
      ui.setError(undefined);
    })
    .catch((err: unknown) => {
      if (!controller.signal.aborted) {
        ui.setError(segmentationErrorText(err));
      }
    })
    .finally(() => {
      if (ui.quickRequest.current === controller) {
        ui.setQuickBusy(false);
      }
    });
}

/** A positive or negative click of the quick tool. */
export function addQuickPoint(
  c: CanvasContext,
  event: { clientX: number; clientY: number },
  kind: "positive" | "negative",
): void {
  const next = pointOf(c, event);
  if (!next) {
    return;
  }
  markStrokeFrame(c);
  requestQuickMask(c, [
    ...c.ui.quickPoints,
    { x: clampUnit(next.x), y: clampUnit(next.y), positive: kind === "positive" },
  ]);
}
