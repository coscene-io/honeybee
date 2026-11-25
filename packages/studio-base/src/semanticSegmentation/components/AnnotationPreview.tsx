// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { toNanoSec } from "@foxglove/rostime";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";

import { polygonPath } from "../editorGeometry";
import type { SegmentationImageMetadata, SegmentationPanelBridge } from "../imageSource";
import { polygonsOf } from "../maskGeometry";
import type { SegmentationRuntime } from "../runtime";
import { useSegmentationHost, useSegmentationSession } from "../segmentationHostContext";

const useStyles = makeStyles()((theme) => ({
  preview: { position: "absolute", zIndex: 4, pointerEvents: "none" },
  status: {
    position: "absolute",
    left: theme.spacing(1.25),
    bottom: theme.spacing(1.25),
    zIndex: 4,
    padding: theme.spacing(0.5, 1),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    color: theme.palette.text.primary,
    pointerEvents: "none",
  },
}));

function PreviewPolygons({
  runtime,
  topic,
  containerRef,
  bridge,
}: {
  runtime: SegmentationRuntime;
  topic: string;
  containerRef: RefObject<ReactNull | HTMLDivElement>;
  bridge: SegmentationPanelBridge;
}): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const host = useSegmentationHost();
  const document = useStore(runtime.store, (state) => state.document);
  const currentTime = useMessagePipeline((state) => state.playerState.activeData?.currentTime);
  const getPipeline = useMessagePipelineGetter();
  const [captured, setCaptured] = useState<SegmentationImageMetadata>();
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>();

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setCaptured(undefined);
      return;
    }
    const sync = () => {
      const sources = bridge.sources();
      const image = sources?.imageMetadata();
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
      if (!sources) {
        return;
      }
      const parent = container.getBoundingClientRect();
      const rect = sources.bounds();
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
    return bridge.subscribeFrames(sync);
  }, [bridge, containerRef, currentTime, getPipeline, topic]);

  const video = document?.videos.find((item) => item.topic === topic);
  const shown =
    captured &&
    document?.frames.find(
      (frame) =>
        frame.videoId === video?.id &&
        frame.logTimeNs === toNanoSec(captured.receiveTime).toString(),
    );
  useLayoutEffect(() => {
    host.session.setState((session) => ({
      previewFrames: { ...session.previewFrames, [topic]: shown?.id },
    }));
    return () => {
      host.session.setState((session) => {
        const previewFrames = { ...session.previewFrames };
        delete previewFrames[topic];
        return { previewFrames };
      });
    };
  }, [host, topic, shown?.id]);
  const polygons = Object.values(document?.annotations ?? {})
    .filter((annotation) => annotation.frameId === shown?.id)
    .flatMap((annotation) => polygonsOf(annotation));
  const view = captured?.nativeView;
  if (!box || !view || polygons.length === 0) {
    return undefined;
  }
  return (
    <svg
      className={classes.preview}
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="none"
      data-log-time-ns={shown?.logTimeNs}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <g transform={`matrix(${view.matrix.join(" ")})`}>
        {polygons.map((polygon) => (
          <path
            key={polygon.id}
            d={polygonPath(polygon.points, view.imageWidth, view.imageHeight)}
            fill="rgba(85, 184, 222, 0.28)"
            stroke="#55b8de"
            strokeWidth={2}
          />
        ))}
      </g>
    </svg>
  );
}

/** Read-only polygons for the current annotation sample. It does not cover the image or its notices. */
export function AnnotationPreview({
  containerRef,
  topic,
  bridge,
}: {
  containerRef: RefObject<ReactNull | HTMLDivElement>;
  topic?: string;
  /** This panel's renderer, from which the displayed image is read. */
  bridge: SegmentationPanelBridge;
}): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const open = useSegmentationSession((session) => session.open);
  const runtime = useSegmentationSession((session) => session.previewRuntime);
  const loading = useSegmentationSession((session) => session.previewLoading);
  if (open || topic == undefined) {
    return undefined;
  }
  return (
    <>
      {loading && (
        <div className={classes.status} role="status">
          {t("loadingExistingAnnotations")}
        </div>
      )}
      {runtime && (
        <PreviewPolygons
          runtime={runtime}
          topic={topic}
          containerRef={containerRef}
          bridge={bridge}
        />
      )}
    </>
  );
}
