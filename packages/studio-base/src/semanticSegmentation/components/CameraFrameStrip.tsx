// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box, Stack, Typography } from "@mui/material";
import { useEffect, useMemo } from "react";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { CAMERA_STRIP_RADIUS, cameraFrameStrip, type CameraStripCell } from "../cameraFrames";
import { segmentationSession } from "../runtime";
import { frameInstanceKey } from "../service";
import { sourceFrameLoaders } from "../sourceFrames";
import type { SegmentationDocument } from "../types";

const useStyles = makeStyles()((theme) => ({
  root: { paddingLeft: theme.spacing(5), paddingRight: theme.spacing(1), alignItems: "center" },
  camera: { flexShrink: 0, maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis" },
  cells: { alignItems: "center" },
  cell: {
    width: 3,
    padding: 0,
    border: "none",
    borderRadius: 0,
    flexShrink: 0,
    cursor: "pointer",
    "&:disabled": { cursor: "default" },
  },
}));

/** Read this far around the shown frame, so a strip far from the focused camera fills in too. */
const PRELOAD_NS = 1_000_000_000n;

const STATE_TEXT: Record<CameraStripCell["state"], string> = {
  annotated: "有标注",
  empty: "无标注",
  unloaded: "未加载",
  outside: "超出录制",
};

/**
 * One camera's ±20-frame mini timeline for one instance. Cells are that camera's own source
 * frames in log-time order. Clicking a cell moves the clock to that frame's exact log time.
 */
export function CameraFrameStrip({
  document,
  instanceId,
  frameId,
  camera,
  color,
  disabled,
}: {
  document: SegmentationDocument;
  instanceId: string;
  /** The frame this camera shows now. */
  frameId: string;
  camera: string;
  color: string;
  disabled: boolean;
}): React.JSX.Element | undefined {
  const { classes, theme } = useStyles();
  const seek = useStore(segmentationSession, (session) => session.seek);
  const current = document.frames.find((frame) => frame.id === frameId);
  const videoId = current?.videoId;
  const loader = videoId == undefined ? undefined : sourceFrameLoaders.get(videoId);
  useEffect(() => {
    if (!loader || !current) {
      return;
    }
    const center = BigInt(current.logTimeNs);
    void loader.ensureRange(center - PRELOAD_NS, center + PRELOAD_NS).catch(() => undefined);
  }, [loader, current]);
  const cells = useMemo(
    () =>
      cameraFrameStrip({
        frames: document.frames.filter((frame) => frame.videoId === videoId),
        currentFrameId: frameId,
        isAnnotated: (id) =>
          (document.annotationSummaries[frameInstanceKey(id, instanceId)]?.pointCount ?? 0) > 0,
        isLoaded: loader?.isLoaded,
      }),
    [document.frames, document.annotationSummaries, videoId, frameId, instanceId, loader],
  );
  // A camera where this instance never appears nearby would only add noise.
  if (!cells.some((cell) => cell.state === "annotated")) {
    return undefined;
  }
  return (
    <Stack
      direction="row"
      spacing={0.75}
      className={classes.root}
      data-testid={`camera-strip-${instanceId}-${camera}`}
    >
      <Typography variant="caption" color="text.secondary" className={classes.camera}>
        {camera}
      </Typography>
      <Stack
        direction="row"
        spacing="1px"
        className={classes.cells}
        role="group"
        aria-label={`${camera} 前后 ${CAMERA_STRIP_RADIUS} 帧`}
      >
        {cells.map((cell) => {
          const position =
            cell.offset === 0 ? "当前帧" : `${cell.offset > 0 ? "+" : ""}${cell.offset} 帧`;
          const known = cell.state === "annotated" || cell.state === "empty";
          return (
            <Box
              key={cell.offset}
              component="button"
              type="button"
              className={classes.cell}
              data-state={cell.state}
              data-log-time-ns={cell.logTimeNs}
              title={`${camera} ${position}：${STATE_TEXT[cell.state]}`}
              aria-label={`${camera} ${position}：${STATE_TEXT[cell.state]}`}
              disabled={disabled || !known || seek == undefined || cell.offset === 0}
              onClick={() => {
                if (cell.logTimeNs != undefined) {
                  seek?.(BigInt(cell.logTimeNs));
                }
              }}
              style={{
                height: cell.offset === 0 ? 10 : 7,
                backgroundColor:
                  cell.state === "annotated"
                    ? color
                    : cell.state === "unloaded"
                      ? "transparent"
                      : theme.palette.action.disabledBackground,
                boxShadow:
                  cell.state === "unloaded"
                    ? `inset 0 0 0 1px ${theme.palette.text.disabled}`
                    : cell.offset === 0
                      ? `0 0 0 1px ${color}`
                      : undefined,
                opacity: cell.state === "outside" ? 0.2 : 1,
              }}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
