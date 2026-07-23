// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useResizeDetector } from "react-resize-detector";
import { makeStyles } from "tss-react/mui";

import { add, fromSec } from "@foxglove/rostime";
import { RpcScales } from "@foxglove/studio-base/components/Chart/types";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useHoverValue } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";

import HoverBar from "./HoverBar";
import { TimelinePositionIndicator } from "./TimelinePositionIndicator";
import { type TimelineViewport } from "./timelineViewport";

const HOVER_TIME_LABEL_EDGE_PADDING_PX: number = 0;

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

const useStyles = makeStyles()((theme) => ({
  hoverTimeLabel: {
    backgroundColor: alpha(theme.palette.grey[700], 0.92),
    borderRadius: theme.shape.borderRadius,
    color: theme.palette.common.white,
    fontFamily: theme.typography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    lineHeight: theme.typography.caption.lineHeight,
    left: 0,
    maxWidth: 240,
    overflow: "hidden",
    paddingBlock: theme.spacing(0.25),
    paddingInline: theme.spacing(0.75),
    pointerEvents: "none",
    position: "absolute",
    textAlign: "center",
    textOverflow: "ellipsis",
    top: theme.spacing(0.5),
    whiteSpace: "nowrap",
    zIndex: 5,
  },
}));

function getStartTime(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData?.startTime;
}

function getEndTime(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData?.endTime;
}

type Props = {
  componentId: string;
  viewport: TimelineViewport;
};

function UnmemoizedPlaybackBarHoverTicks(props: Props): React.JSX.Element {
  const { componentId, viewport } = props;
  const { classes, theme } = useStyles();

  const startTime = useMessagePipeline(getStartTime);
  const endTime = useMessagePipeline(getEndTime);
  const hoverValue = useHoverValue({ componentId, isPlaybackSeconds: true });
  const { formatTime } = useAppTimeFormat();
  const hoverTimeLabelRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const [hoverTimeLabelWidth, setHoverTimeLabelWidth] = useState(0);

  // Use a debounce and 0 refresh rate to avoid triggering a resize observation while handling
  // an existing resize observation.
  // https://github.com/maslianok/react-resize-detector/issues/45
  const { width, ref } = useResizeDetector({
    handleHeight: false,
    refreshMode: "debounce",
    refreshRate: 0,
  });

  const hoverTimeDisplay = useMemo(() => {
    if (hoverValue?.type !== "PLAYBACK_SECONDS" || !startTime || hoverValue.value < 0) {
      return undefined;
    }
    const stamp = add(startTime, fromSec(hoverValue.value));
    return formatTime(stamp);
  }, [formatTime, hoverValue, startTime]);

  const scaleBounds = useMemo<RpcScales | undefined>(() => {
    if (startTime == undefined || endTime == undefined) {
      return;
    }

    return {
      x: {
        min: viewport.visibleStartSec,
        max: viewport.visibleEndSec,
        pixelMin: 0,
        pixelMax: width ?? 0,
      },
    };
  }, [width, startTime, endTime, viewport]);

  const hoverPositionPx = useMemo(() => {
    if (
      hoverValue?.type !== "PLAYBACK_SECONDS" ||
      width == undefined ||
      viewport.visibleEndSec === viewport.visibleStartSec
    ) {
      return undefined;
    }

    return (
      ((hoverValue.value - viewport.visibleStartSec) /
        (viewport.visibleEndSec - viewport.visibleStartSec)) *
      width
    );
  }, [hoverValue, viewport, width]);

  // Hover time is only displayed when the hover value originates from other components
  const displayHoverTime = hoverValue != undefined && hoverValue.componentId !== componentId;

  useLayoutEffect(() => {
    if (!displayHoverTime || hoverTimeDisplay == undefined) {
      return;
    }

    const label = hoverTimeLabelRef.current;
    if (label == undefined) {
      return;
    }

    const rect = label.getBoundingClientRect();
    setHoverTimeLabelWidth((oldWidth) => (oldWidth === rect.width ? oldWidth : rect.width));
  }, [displayHoverTime, hoverTimeDisplay]);

  const hoverTimeLabelOffsetPx = useMemo(() => {
    if (hoverPositionPx == undefined || width == undefined || hoverTimeLabelWidth === 0) {
      return undefined;
    }

    return clamp(
      -hoverTimeLabelWidth / 2,
      HOVER_TIME_LABEL_EDGE_PADDING_PX - hoverPositionPx,
      width - HOVER_TIME_LABEL_EDGE_PADDING_PX - hoverPositionPx - hoverTimeLabelWidth,
    );
  }, [hoverPositionPx, hoverTimeLabelWidth, width]);

  return (
    <Stack ref={ref} flex="auto" style={{ pointerEvents: "none" }}>
      {scaleBounds && (
        <HoverBar componentId={componentId} scales={scaleBounds} isPlaybackSeconds>
          <TimelinePositionIndicator
            color={theme.palette.warning.main}
            dataTestId="playback-hover-time-indicator"
          />
          {displayHoverTime && hoverTimeDisplay != undefined && (
            <div
              ref={hoverTimeLabelRef}
              className={classes.hoverTimeLabel}
              data-testid="playback-hover-time-label"
              style={{
                transform:
                  hoverTimeLabelOffsetPx == undefined
                    ? "translateX(-50%)"
                    : `translateX(${hoverTimeLabelOffsetPx}px)`,
              }}
            >
              {hoverTimeDisplay}
            </div>
          )}
        </HoverBar>
      )}
    </Stack>
  );
}

export const PlaybackBarHoverTicks = React.memo(UnmemoizedPlaybackBarHoverTicks);
