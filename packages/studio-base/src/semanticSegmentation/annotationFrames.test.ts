// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  previewWindowNeedsLoad,
  previewWindowStartSec,
  snapAnnotationTime,
} from "./annotationFrames";
import { segmentationCommitOffset } from "./frameStep";
import { createMockSemanticSegmentationService } from "./mockService";
import { segmentationSession, type SegmentationRuntime } from "./runtime";
import { createSemanticSegmentationStore } from "./store";

const fps30 = Array.from({ length: 13 }, (_, index) => index / 30);

describe("annotation samples", () => {
  it("pauses on the latest real frame at or before the clock and seeks to the nearest", () => {
    expect(snapAnnotationTime(0.16, fps30, "pause")).toBeCloseTo(4 / 30);
    expect(snapAnnotationTime(0.16, fps30, "nearest")).toBeCloseTo(5 / 30);
    expect(snapAnnotationTime(0.1, fps30, "pause")).toBeUndefined();
    expect(snapAnnotationTime(0.04, [], "nearest")).toBeUndefined();
  });

  it("follows uneven frame gaps instead of a fixed grid", () => {
    const uneven = [0, 0.04, 0.31, 0.33];
    expect(snapAnnotationTime(0.3, uneven, "pause")).toBeCloseTo(0.04);
    expect(snapAnnotationTime(0.3, uneven, "nearest")).toBeCloseTo(0.31);
  });

  it("loads a window only from frames inside that window", () => {
    expect(previewWindowStartSec(15.2)).toBe(10);
    expect(previewWindowStartSec(Number.NaN)).toBeUndefined();
    const frames = [{ timestampSec: 9.8 }, { timestampSec: 10.2 }];
    expect(previewWindowNeedsLoad(frames, (frame) => frame.timestampSec < 10, 10, 40)).toBe(true);
    expect(previewWindowNeedsLoad([{ timestampSec: 9.8 }], () => true, 10, 40)).toBe(false);
  });
});

it("leaves the playhead alone while a polygon is being drawn", async () => {
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({ controls: { delayMs: 0 } }),
  );
  await store.getState().initialize();
  segmentationSession.setState({
    open: true,
    runtime: { store } as SegmentationRuntime,
    strokeFrameId: undefined,
  });
  expect(segmentationCommitOffset(0.15, "pause")).toBeCloseTo(0);
  expect(segmentationCommitOffset(0.15, "nearest")).toBeCloseTo(0.2);
  store.getState().setDrawingPolygonId("stroke");
  expect(segmentationCommitOffset(0.15, "nearest")).toBeUndefined();
  store.setState({ drawingPolygonId: undefined });
  const document = store.getState().document;
  const current = document?.frames.find((frame) => frame.id === store.getState().currentFrameId);
  if (document && current) {
    store.setState({
      document: {
        ...document,
        frames: [
          ...document.frames,
          { ...current, id: "other-camera", videoId: "video-side", timestampSec: 0.15, index: 99 },
        ],
      },
    });
    expect(segmentationCommitOffset(0.15, "pause")).toBeCloseTo(0);
  }
  segmentationSession.setState({ open: false, previewRuntime: { store } as SegmentationRuntime });
  expect(segmentationCommitOffset(0.15, "nearest")).toBeUndefined();
  segmentationSession.setState({
    open: false,
    runtime: undefined,
    previewRuntime: undefined,
    strokeFrameId: undefined,
  });
  store.getState().dispose();
});
