// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PopperProps, Tooltip } from "@mui/material";
import type { Instance } from "@popperjs/core";
import { useEffect, useMemo, useRef } from "react";
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
import {
  TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX,
  TimelinePositionIndicator,
  getTimelinePositionIndicatorHandleAnchorRect,
} from "./TimelinePositionIndicator";
import { type TimelineViewport } from "./timelineViewport";

const useStyles = makeStyles()((theme) => ({
  time: {
    textAlign: "center",
    fontFamily: theme.typography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    lineHeight: theme.typography.caption.lineHeight,
    letterSpacing: theme.typography.caption.letterSpacing,
    whiteSpace: "nowrap",
  },
  tooltip: {
    '&[data-popper-placement*="top"] .MuiTooltip-tooltip': {
      marginBottom: `${theme.spacing(1)} !important`,
    },
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
  const indicatorRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const popperRef = useRef<Instance>(ReactNull);

  const startTime = useMessagePipeline(getStartTime);
  const endTime = useMessagePipeline(getEndTime);
  const hoverValue = useHoverValue({ componentId, isPlaybackSeconds: true });
  const { formatTime } = useAppTimeFormat();

  // Use a debounce and 0 refresh rate to avoid triggering a resize observation while handling
  // an existing resize observation.
  // https://github.com/maslianok/react-resize-detector/issues/45
  const { width, ref } = useResizeDetector({
    handleHeight: false,
    refreshMode: "debounce",
    refreshRate: 0,
  });

  const hoverTimeDisplay = useMemo(() => {
    if (
      !hoverValue ||
      hoverValue.type !== "PLAYBACK_SECONDS" ||
      !startTime ||
      hoverValue.value < 0
    ) {
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

  // Hover time is only displayed when the hover value originates from other components
  const displayHoverTime = hoverValue != undefined && hoverValue.componentId !== componentId;

  const popperProps: Partial<PopperProps> = useMemo(
    () => ({
      popperRef,
      anchorEl: {
        getBoundingClientRect: () => {
          const rect = indicatorRef.current?.getBoundingClientRect();
          return getTimelinePositionIndicatorHandleAnchorRect(
            rect ??
              ({
                left: 0,
                top: -TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX / 2,
                width: 0,
              } as DOMRect),
          );
        },
      },
    }),
    [],
  );

  useEffect(() => {
    if (popperRef.current != undefined) {
      void popperRef.current.update();
    }
  }, [hoverValue]);

  return (
    <Stack ref={ref} flex="auto">
      {scaleBounds && (
        <HoverBar componentId={componentId} scales={scaleBounds} isPlaybackSeconds>
          <Tooltip
            arrow
            classes={{ popper: classes.tooltip }}
            placement="top"
            disableFocusListener
            disableHoverListener
            disableTouchListener
            disableInteractive
            open={displayHoverTime}
            title={<div className={classes.time}>{hoverTimeDisplay}</div>}
            slotProps={{
              popper: popperProps,
              transition: { timeout: 0 },
            }}
          >
            <TimelinePositionIndicator
              ref={indicatorRef}
              color={theme.palette.warning.main}
              dataTestId="playback-hover-time-indicator"
            />
          </Tooltip>
        </HoverBar>
      )}
    </Stack>
  );
}

export const PlaybackBarHoverTicks = React.memo(UnmemoizedPlaybackBarHoverTicks);
