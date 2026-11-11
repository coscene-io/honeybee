// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { useStore } from "zustand";

import { toNanoSec } from "@foxglove/rostime";
import { useMessagePipeline } from "@foxglove/studio-base/components/MessagePipeline";

import { snapAnnotationTime } from "../annotationFrames";
import { segmentationSession, type SegmentationRuntime } from "../runtime";
import { polygonPath } from "./editorGeometry";

function PreviewPolygons({
  runtime,
  topic,
  containerRef,
}: {
  runtime: SegmentationRuntime;
  topic: string;
  containerRef: RefObject<HTMLDivElement>;
}): React.JSX.Element | undefined {
  const document = useStore(runtime.store, (state) => state.document);
  const currentTime = useMessagePipeline((state) => state.playerState.activeData?.currentTime);
  const startTime = useMessagePipeline((state) => state.playerState.activeData?.startTime);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = container?.querySelector("canvas");
    if (!container || !(canvas instanceof HTMLCanvasElement) || canvas.width === 0) {
      setBox(undefined);
      return;
    }
    const parent = container.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    setBox({
      left: rect.left - parent.left,
      top: rect.top - parent.top,
      width: rect.width,
      height: rect.height,
    });
  }, [containerRef, currentTime, document]);

  const video = document?.videos.find((item) => item.topic === topic);
  const frames = document?.frames.filter((frame) => frame.videoId === video?.id) ?? [];
  const offsetSec =
    currentTime && startTime ? Number(toNanoSec(currentTime) - toNanoSec(startTime)) / 1e9 : 0;
  const samples = frames.map((frame) => frame.timestampSec);
  const landed =
    snapAnnotationTime(offsetSec, samples, "pause") ??
    samples.find((sample) => Math.abs(sample - offsetSec) <= 0.0005);
  const shown = frames.find((frame) => Math.abs(frame.timestampSec - (landed ?? -1)) <= 0.0005);
  const polygons = Object.values(document?.annotations ?? {}).filter(
    (annotation) => annotation.frameId === shown?.id,
  );
  const canvas = containerRef.current?.querySelector("canvas");
  const pixelWidth = canvas instanceof HTMLCanvasElement ? canvas.width : 0;
  const pixelHeight = canvas instanceof HTMLCanvasElement ? canvas.height : 0;
  if (!box || pixelWidth <= 0 || polygons.length === 0) {
    return undefined;
  }
  return (
    <svg
      className="seg-preview"
      viewBox={`0 0 ${pixelWidth} ${pixelHeight}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      {polygons.flatMap((annotation) =>
        annotation.polygons.map((polygon) => (
          <path
            key={polygon.id}
            d={polygonPath(polygon.points, pixelWidth, pixelHeight)}
            fill="rgba(85, 184, 222, 0.28)"
            stroke="#55b8de"
            strokeWidth={2}
          />
        )),
      )}
    </svg>
  );
}

/** Read-only polygons for the current annotation sample. It does not cover the image or its notices. */
export function AnnotationPreview({
  containerRef,
  topic,
}: {
  containerRef: RefObject<HTMLDivElement>;
  topic?: string;
}): React.JSX.Element | undefined {
  const open = useStore(segmentationSession, (session) => session.open);
  const runtime = useStore(segmentationSession, (session) => session.previewRuntime);
  const loading = useStore(segmentationSession, (session) => session.previewLoading);
  if (open || topic == undefined) {
    return undefined;
  }
  return (
    <>
      {loading && (
        <div className="seg-preview-status" role="status">
          正在载入已有标注
        </div>
      )}
      {runtime && <PreviewPolygons runtime={runtime} topic={topic} containerRef={containerRef} />}
    </>
  );
}
