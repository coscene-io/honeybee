// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTheme } from "@mui/material";
import { useCallback, useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { subtract as subtractTimes, toSec } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";

import {
  TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX,
  TimelinePositionIndicator,
} from "./TimelinePositionIndicator";
import {
  clientXToFraction,
  fractionToTime,
  timeToFraction,
  type TimelineViewport,
} from "./timelineViewport";

export type HoverOverEvent = {
  /** Hovered playback seconds relative to the playback start. */
  playbackSeconds: number;
  /** Current hovered X position in client coordinates */
  clientX: number;
  /** Current hovered Y position in client coordinates */
  clientY: number;
};

export type ContextMenuEvent = HoverOverEvent;

type PendingHoverEvent = {
  clientX: number;
};

type Props = {
  disabled?: boolean;
  onChange: (playbackSeconds: number) => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
  onHoverOver?: (event: HoverOverEvent) => void;
  onHoverOut?: () => void;
  cursor: string;
  viewport: TimelineViewport;
};

const useStyles = makeStyles<{ cursor: string }>()((theme, props) => ({
  root: {
    label: "Slider-root",
    display: "flex",
    width: "100%",
    height: "100%",
    position: "relative",
    alignItems: "center",
    cursor: props.cursor,
  },
  rootDisabled: {
    label: "Slider-rootDisabled",
    cursor: "not-allowed",
    opacity: theme.palette.action.disabledOpacity,
  },
}));

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;

function RenderSlider({ viewport }: { viewport: TimelineViewport }): React.JSX.Element | ReactNull {
  const theme = useTheme();

  const startTime = useMessagePipeline(selectStartTime);
  const currentTime = useMessagePipeline(selectCurrentTime);

  const fraction = useMemo(
    () =>
      currentTime && startTime
        ? timeToFraction(toSec(subtractTimes(currentTime, startTime)), viewport)
        : undefined,
    [currentTime, startTime, viewport],
  );

  if (fraction == undefined || fraction < 0 || fraction > 1) {
    return ReactNull;
  }

  return (
    <TimelinePositionIndicator
      color={theme.palette.text.primary}
      dataTestId="playback-current-time-indicator"
      fillOpacity={0.85}
      style={{ left: `${fraction * 100}%` }}
    />
  );
}

function Slider(props: Props): React.JSX.Element {
  const {
    disabled = false,
    onContextMenu,
    onHoverOver,
    onHoverOut,
    onChange,
    cursor,
    viewport,
  } = props;
  const { classes, cx } = useStyles({ cursor });

  const elRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const pendingHoverRef = useRef<PendingHoverEvent | undefined>(undefined);
  const hoverAnimationFrameRef = useRef<number | undefined>(undefined);

  const getPlaybackSecondsAtClientX = useCallback(
    (clientX: number): number => {
      if (!elRef.current) {
        return 0;
      }
      const rect = elRef.current.getBoundingClientRect();
      return fractionToTime(clientXToFraction(clientX, rect), viewport);
    },
    [viewport],
  );

  const getPlaybackSecondsAtMouse = useCallback(
    (ev: React.MouseEvent | MouseEvent): number => {
      return getPlaybackSecondsAtClientX(ev.clientX);
    },
    [getPlaybackSecondsAtClientX],
  );

  const cancelPendingHover = useCallback(() => {
    if (hoverAnimationFrameRef.current != undefined) {
      cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = undefined;
    }
    pendingHoverRef.current = undefined;
  }, []);

  const flushPendingHover = useCallback(() => {
    hoverAnimationFrameRef.current = undefined;

    const pendingHover = pendingHoverRef.current;
    pendingHoverRef.current = undefined;

    const target = elRef.current;
    if (pendingHover == undefined || target == undefined || disabled) {
      return;
    }

    const elRect = target.getBoundingClientRect();
    onHoverOver?.({
      playbackSeconds: getPlaybackSecondsAtClientX(pendingHover.clientX),
      clientX: pendingHover.clientX,
      clientY: elRect.y + TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX / 2,
    });
  }, [disabled, getPlaybackSecondsAtClientX, onHoverOver]);

  const scheduleHoverOver = useCallback(
    (clientX: number) => {
      if (onHoverOver == undefined) {
        cancelPendingHover();
        return;
      }
      pendingHoverRef.current = { clientX };
      if (hoverAnimationFrameRef.current == undefined) {
        hoverAnimationFrameRef.current = requestAnimationFrame(flushPendingHover);
      }
    },
    [cancelPendingHover, flushPendingHover, onHoverOver],
  );

  const [mouseDown, setMouseDown] = useState(false);
  const mouseDownRef = useRef(mouseDown);
  useLayoutEffect(() => {
    mouseDownRef.current = mouseDown;
  }, [mouseDown]);

  const [mouseInside, setMouseInside] = useState(false);
  const mouseInsideRef = useRef(mouseInside);
  useLayoutEffect(() => {
    mouseInsideRef.current = mouseInside;
  }, [mouseInside]);

  const onMouseEnter = useCallback(() => {
    setMouseInside(true);
  }, []);

  const onMouseLeave = useCallback(() => {
    setMouseInside(false);
    if (!mouseDownRef.current) {
      cancelPendingHover();
      onHoverOut?.();
    }
  }, [cancelPendingHover, onHoverOut]);

  const onPointerUp = useCallback((): void => {
    setMouseDown(false);
    if (!mouseInsideRef.current) {
      cancelPendingHover();
      onHoverOut?.();
    }
  }, [cancelPendingHover, onHoverOut]);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent | PointerEvent): void => {
      if (mouseDownRef.current && ev.currentTarget !== window) {
        // onPointerMove is used on the <div/> for hovering, and on the window for dragging. While
        // dragging we only want to pay attention to the window events (otherwise we'd be handling
        // each event twice).
        return;
      }
      if (disabled) {
        return;
      }

      scheduleHoverOver(ev.clientX);
      if (!mouseDownRef.current) {
        return;
      }
      const playbackSeconds = getPlaybackSecondsAtMouse(ev);
      onChange(playbackSeconds);
    },
    [disabled, getPlaybackSecondsAtMouse, onChange, scheduleHoverOver],
  );

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>): void => {
      if (disabled) {
        return;
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      ev.preventDefault();
      onChange(getPlaybackSecondsAtMouse(ev));
      setMouseDown(true);
    },
    [disabled, getPlaybackSecondsAtMouse, onChange],
  );

  const handleContextMenu = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>): void => {
      if (disabled) {
        return;
      }

      ev.preventDefault();
      const playbackSeconds = getPlaybackSecondsAtMouse(ev);
      onContextMenu?.({
        playbackSeconds,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
    },
    [disabled, getPlaybackSecondsAtMouse, onContextMenu],
  );

  useEffect(() => {
    if (mouseDown) {
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointermove", onPointerMove);
      return () => {
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointermove", onPointerMove);
      };
    }
    return undefined;
  }, [mouseDown, onPointerMove, onPointerUp]);

  useEffect(() => {
    return cancelPendingHover;
  }, [cancelPendingHover]);

  return (
    <div
      ref={elRef}
      data-testid="scrubber-slider"
      onContextMenu={handleContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cx(classes.root, {
        [classes.rootDisabled]: disabled,
      })}
    >
      <RenderSlider viewport={viewport} />
    </div>
  );
}

export default React.memo(Slider);
