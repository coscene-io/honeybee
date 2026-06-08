// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useRef } from "react";
import { useResizeDetector } from "react-resize-detector";
import { makeStyles } from "tss-react/mui";

import { Time } from "@foxglove/rostime";

import { TimelineThumbnail, useTimelineThumbnails } from "./useTimelineThumbnails";

/** Target on-screen width of a single thumbnail cell, in pixels. */
const TARGET_CELL_WIDTH_PX = 96;

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: theme.palette.background.default,
    // Let scrubbing/clicks pass through to the slider underneath.
    pointerEvents: "none",
  },
  tile: {
    position: "absolute",
    top: 0,
    bottom: 0,
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRight: `1px solid ${theme.palette.background.paper}`,
  },
  image: {
    height: "100%",
    width: "100%",
    objectFit: "cover",
    display: "block",
  },
  placeholder: {
    position: "absolute",
    inset: 0,
    opacity: 0.4,
    background: `repeating-linear-gradient(90deg, ${theme.palette.action.hover} 0 8px, transparent 8px 16px)`,
  },
}));

function ThumbnailTile({
  thumbnail,
  widthPercent,
}: {
  thumbnail: TimelineThumbnail;
  widthPercent: number;
}): React.JSX.Element {
  const { classes } = useStyles();
  const canvasRef = useRef<HTMLCanvasElement>(ReactNull);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == undefined) {
      return;
    }
    const { bitmap } = thumbnail;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0);
  }, [thumbnail]);

  return (
    <div
      className={classes.tile}
      style={{ left: `${thumbnail.fraction * 100}%`, width: `${widthPercent}%` }}
    >
      <canvas ref={canvasRef} className={classes.image} />
    </div>
  );
}

/**
 * A strip of decoded video frames rendered along the timeline. Phase 2: renders a fixed set of
 * thumbnails sampled across the whole recording for the configured topic.
 */
export function VideoThumbnailOverlay({
  enabled,
  topic,
  startTime,
  endTime,
}: {
  enabled: boolean;
  topic: undefined | string;
  startTime: Time | undefined;
  endTime: Time | undefined;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { width, ref: resizeRef } = useResizeDetector({
    refreshMode: "debounce",
    refreshRate: 250,
    handleHeight: false,
  });

  const count = useMemo(() => {
    if (width == undefined || width <= 0) {
      return 0;
    }
    return Math.max(1, Math.round(width / TARGET_CELL_WIDTH_PX));
  }, [width]);

  const { thumbnails } = useTimelineThumbnails({ enabled, topic, startTime, endTime, count });

  const widthPercent = count > 0 ? 100 / count : 100;

  return (
    <div ref={resizeRef} className={classes.root}>
      {thumbnails.length === 0 && <div className={classes.placeholder} />}
      {thumbnails.map((thumbnail) => (
        <ThumbnailTile key={thumbnail.fraction} thumbnail={thumbnail} widthPercent={widthPercent} />
      ))}
    </div>
  );
}
