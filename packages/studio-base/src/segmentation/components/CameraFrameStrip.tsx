// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box, Stack, Typography } from "@mui/material";
import { memo, useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CAMERA_STRIP_RADIUS, type CameraStripCell } from "../cameraFrames";
import { useSegmentationSession } from "../segmentationHostContext";
import { cameraStripCells, frameIndexOf } from "../segmentationTreeIndex";
import type { SourceFrameLoaders } from "../sourceFrames";
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

const STATE_KEYS = {
  annotated: "stripAnnotated",
  empty: "stripEmpty",
  unloaded: "stripUnloaded",
  outside: "stripOutside",
} as const satisfies Record<CameraStripCell["state"], string>;

type CameraFrameStripProps = {
  document: SegmentationDocument;
  instanceId: string;
  /** The frame this camera shows now. */
  frameId: string;
  camera: string;
  color: string;
  disabled: boolean;
  /** The host's frame loaders: they decide which cells are loaded. */
  sourceFrames: SourceFrameLoaders;
};

/** Whether this instance appears anywhere in the camera's strip around `frameId`. */
export function cameraStripVisible(
  document: SegmentationDocument,
  instanceId: string,
  frameId: string,
  sourceFrames: SourceFrameLoaders,
): boolean {
  return cameraStripCells(document, instanceId, frameId, sourceFrames).some(
    (cell) => cell.state === "annotated",
  );
}

/**
 * Starts reading the camera's source frames around `frameId`, so a strip far from the focused
 * camera fills in. The tree calls this for every strip, including ones scrolled out of view.
 */
export function preloadCameraStrip(
  document: SegmentationDocument,
  frameId: string,
  sourceFrames: SourceFrameLoaders,
): void {
  const current = frameIndexOf(document).frameById.get(frameId);
  const loader = current ? sourceFrames.get(current.videoId) : undefined;
  if (!current || !loader) {
    return;
  }
  const center = BigInt(current.logTimeNs);
  void loader.ensureRange(center - PRELOAD_NS, center + PRELOAD_NS).catch(() => undefined);
}

/**
 * Cells come from a cache keyed by the document's summaries and frame list, so a parent render
 * that does not change this strip's cells does not re-render its 41 buttons.
 */
function sameStrip(previous: CameraFrameStripProps, next: CameraFrameStripProps): boolean {
  return (
    previous.instanceId === next.instanceId &&
    previous.frameId === next.frameId &&
    previous.camera === next.camera &&
    previous.color === next.color &&
    previous.disabled === next.disabled &&
    cameraStripCells(
      previous.document,
      previous.instanceId,
      previous.frameId,
      previous.sourceFrames,
    ) === cameraStripCells(next.document, next.instanceId, next.frameId, next.sourceFrames)
  );
}

/**
 * One camera's ±20-frame mini timeline for one instance. Cells are that camera's own source
 * frames in log-time order. Clicking a cell moves the clock to that frame's exact log time.
 */
export const CameraFrameStrip = memo(function CameraFrameStrip({
  document,
  instanceId,
  frameId,
  camera,
  color,
  disabled,
  sourceFrames,
}: CameraFrameStripProps): React.JSX.Element | ReactNull {
  const { classes, theme } = useStyles();
  const { t } = useTranslation("segmentation");
  const seek = useSegmentationSession((session) => session.seek);
  // A read window or a newly bound loader changes which cells are known.
  const loaderVersion = useSyncExternalStore(sourceFrames.subscribe, sourceFrames.version);
  const current = frameIndexOf(document).frameById.get(frameId);
  const videoId = current?.videoId;
  const centerNs = current?.logTimeNs;
  useEffect(() => {
    const loader = videoId == undefined ? undefined : sourceFrames.get(videoId);
    if (!loader || centerNs == undefined) {
      return;
    }
    const center = BigInt(centerNs);
    void loader.ensureRange(center - PRELOAD_NS, center + PRELOAD_NS).catch(() => undefined);
  }, [videoId, centerNs, sourceFrames, loaderVersion]);
  const cells = cameraStripCells(document, instanceId, frameId, sourceFrames);
  // A camera where this instance never appears nearby would only add noise.
  if (!cells.some((cell) => cell.state === "annotated")) {
    return ReactNull;
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
        aria-label={t("stripLabel", { camera, radius: CAMERA_STRIP_RADIUS })}
      >
        {cells.map((cell) => {
          const position =
            cell.offset === 0
              ? t("stripCurrentFrame")
              : t("stripOffset", { offset: `${cell.offset > 0 ? "+" : ""}${cell.offset}` });
          const label = t("stripCell", { camera, position, state: t(STATE_KEYS[cell.state]) });
          const known = cell.state === "annotated" || cell.state === "empty";
          return (
            <Box
              key={cell.offset}
              component="button"
              type="button"
              className={classes.cell}
              data-state={cell.state}
              data-log-time-ns={cell.logTimeNs}
              title={label}
              aria-label={label}
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
}, sameStrip);
