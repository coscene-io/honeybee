// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { useStore } from "zustand";

import { toNanoSec } from "@foxglove/rostime";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";

import {
  segmentationImageMetadataSources,
  segmentationImageSources,
  type SegmentationImageMetadata,
} from "../imageSource";
import { segmentationSession, type SegmentationRuntime } from "../runtime";
import { polygonPath } from "./editorGeometry";

function PreviewPolygons({
  runtime,
  topic,
  containerRef,
}: {
  runtime: SegmentationRuntime;
  topic: string;
  containerRef: RefObject<ReactNull | HTMLDivElement>;
}): React.JSX.Element | undefined {
  const document = useStore(runtime.store, (state) => state.document);
  const currentTime = useMessagePipeline((state) => state.playerState.activeData?.currentTime);
  const getPipeline = useMessagePipelineGetter();
  const [captured, setCaptured] = useState<SegmentationImageMetadata>();
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = container?.querySelector("canvas");
    if (!container || !(canvas instanceof HTMLCanvasElement)) {
      setCaptured(undefined);
      return;
    }
    const sync = () => {
      const image = (
        segmentationImageMetadataSources.get(canvas) ?? segmentationImageSources.get(canvas)
      )?.();
      const data = getPipeline().playerState.activeData;
      const next =
        image?.topic === topic &&
        data &&
        toNanoSec(image.receiveTime) <= toNanoSec(data.currentTime)
          ? image
          : undefined;
      // This runs on every rendered frame. Keep the state when nothing moved, so an unchanged
      // frame does not re-render the polygons.
      setCaptured((previous) =>
        next != undefined &&
        previous?.decodedIdentity === next.decodedIdentity &&
        previous.nativeView === next.nativeView &&
        toNanoSec(previous.receiveTime) === toNanoSec(next.receiveTime)
          ? previous
          : next,
      );
      const parent = container.getBoundingClientRect();
      const rect = canvas.getBoundingClientRect();
      const left = rect.left - parent.left;
      const top = rect.top - parent.top;
      setBox((previous) =>
        previous?.left === left &&
        previous.top === top &&
        previous.width === rect.width &&
        previous.height === rect.height
          ? previous
          : { left, top, width: rect.width, height: rect.height },
      );
    };
    sync();
    canvas.addEventListener("segmentation-frame", sync);
    return () => {
      canvas.removeEventListener("segmentation-frame", sync);
    };
  }, [containerRef, currentTime, getPipeline, topic]);

  const video = document?.videos.find((item) => item.topic === topic);
  const shown =
    captured &&
    document?.frames.find(
      (frame) =>
        frame.videoId === video?.id &&
        frame.logTimeNs === toNanoSec(captured.receiveTime).toString(),
    );
  useLayoutEffect(() => {
    segmentationSession.setState((session) => ({
      previewFrames: { ...session.previewFrames, [topic]: shown?.id },
    }));
    return () => {
      segmentationSession.setState((session) => {
        const previewFrames = { ...session.previewFrames };
        delete previewFrames[topic];
        return { previewFrames };
      });
    };
  }, [topic, shown?.id]);
  const polygons = Object.values(document?.annotations ?? {}).filter(
    (annotation) => annotation.frameId === shown?.id,
  );
  const view = captured?.nativeView;
  if (!box || !view || polygons.length === 0) {
    return undefined;
  }
  return (
    <svg
      className="seg-preview"
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="none"
      data-log-time-ns={shown?.logTimeNs}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <g transform={`matrix(${view.matrix.join(" ")})`}>
        {polygons.flatMap((annotation) =>
          annotation.polygons.map((polygon) => (
            <path
              key={polygon.id}
              d={polygonPath(polygon.points, view.imageWidth, view.imageHeight)}
              fill="rgba(85, 184, 222, 0.28)"
              stroke="#55b8de"
              strokeWidth={2}
            />
          )),
        )}
      </g>
    </svg>
  );
}

/** Read-only polygons for the current annotation sample. It does not cover the image or its notices. */
export function AnnotationPreview({
  containerRef,
  topic,
}: {
  containerRef: RefObject<ReactNull | HTMLDivElement>;
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
