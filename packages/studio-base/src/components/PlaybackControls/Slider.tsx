// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTheme } from "@mui/material";
import { useCallback, useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";

import {
  TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX,
  TimelinePositionIndicator,
} from "./TimelinePositionIndicator";
import { timelineDurationSeconds } from "./eventTimeContainment";
import {
  clientXToFraction,
  fractionToTime,
  timeToFraction,
  type TimelineViewport,
} from "./timelineViewport";
import { useTimelineHoverDismissal } from "./useTimelineHoverDismissal";

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
  seekBlocked?: boolean;
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
    touchAction: "pan-y",
  },
  rootDisabled: {
    label: "Slider-rootDisabled",
    cursor: "not-allowed",
    opacity: theme.palette.action.disabledOpacity,
  },
}));

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;

const DRAG_SEEK_INTERVAL_MS = 500;

type Scrub = {
  pointerId: number;
  clientX: number;
  finalSeconds?: number;
  lastSentSeconds?: number;
  nextSeekAt: number;
};

function RenderSlider({
  viewport,
  previewSeconds,
}: {
  viewport: TimelineViewport;
  previewSeconds?: number;
}): React.JSX.Element | ReactNull {
  const theme = useTheme();

  const startTime = useMessagePipeline(selectStartTime);
  const currentTime = useMessagePipeline(selectCurrentTime);

  const fraction = useMemo(() => {
    const seconds =
      previewSeconds ??
      (currentTime && startTime ? timelineDurationSeconds(startTime, currentTime) : undefined);
    return seconds == undefined ? undefined : timeToFraction(seconds, viewport);
  }, [currentTime, startTime, viewport, previewSeconds]);

  if (fraction == undefined || fraction < 0 || fraction > 1) {
    return ReactNull;
  }

  return (
    <TimelinePositionIndicator
      color={theme.palette.error.main}
      dataTestId="playback-current-time-indicator"
      fillOpacity={0.85}
      style={{ left: `${fraction * 100}%` }}
    />
  );
}

function Slider(props: Props): React.JSX.Element {
  const {
    disabled = false,
    seekBlocked = false,
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

  const scrubRef = useRef<Scrub | undefined>(undefined);
  const seekTimer = useRef<number | undefined>(undefined);
  const [previewSeconds, setPreviewSeconds] = useState<number>();
  const [dragging, setDragging] = useState(false);

  const clearSeekTimer = useCallback(() => {
    window.clearTimeout(seekTimer.current);
    seekTimer.current = undefined;
  }, []);

  // Only the latest pointer target survives a cooldown or a video recovery lock.
  const submitSeek = useCallback(
    function submitLatest() {
      const scrub = scrubRef.current;
      if (disabled || seekBlocked || scrub == undefined) {
        return;
      }

      if (scrub.finalSeconds != undefined) {
        clearSeekTimer();
        scrubRef.current = undefined;
        setPreviewSeconds(undefined);
      }
      const now = performance.now();
      const delay = scrub.nextSeekAt - now;
      if (scrub.finalSeconds == undefined && delay > 0) {
        seekTimer.current ??= window.setTimeout(() => {
          seekTimer.current = undefined;
          submitLatest();
        }, delay);
        return;
      }

      const seconds = scrub.finalSeconds ?? getPlaybackSecondsAtClientX(scrub.clientX);
      if (seconds !== scrub.lastSentSeconds) {
        scrub.lastSentSeconds = seconds;
        scrub.nextSeekAt = now + DRAG_SEEK_INTERVAL_MS;
        onChange(seconds);
      }
    },
    [clearSeekTimer, disabled, getPlaybackSecondsAtClientX, onChange, seekBlocked],
  );

  const cancelPendingHover = useCallback(() => {
    if (hoverAnimationFrameRef.current != undefined) {
      cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = undefined;
    }
    pendingHoverRef.current = undefined;
  }, []);

  const dismissHover = useCallback(() => {
    cancelPendingHover();
    onHoverOut?.();
  }, [cancelPendingHover, onHoverOut]);
  useTimelineHoverDismissal(dismissHover);

  const flushPendingHover = useCallback(() => {
    hoverAnimationFrameRef.current = undefined;

    const pendingHover = pendingHoverRef.current;
    pendingHoverRef.current = undefined;

    const target = elRef.current;
    if (pendingHover == undefined || target == undefined || disabled) {
      return;
    }

    const elRect = target.getBoundingClientRect();
    const seconds = fractionToTime(clientXToFraction(pendingHover.clientX, elRect), viewport);
    if (scrubRef.current != undefined && scrubRef.current.finalSeconds == undefined) {
      setPreviewSeconds(seconds);
    }
    onHoverOver?.({
      playbackSeconds: seconds,
      clientX: pendingHover.clientX,
      clientY: elRect.y + TIMELINE_POSITION_INDICATOR_HANDLE_HEIGHT_PX / 2,
    });
  }, [disabled, onHoverOver, viewport]);

  const scheduleHoverOver = useCallback(
    (clientX: number) => {
      if (onHoverOver == undefined && scrubRef.current == undefined) {
        cancelPendingHover();
        return;
      }
      pendingHoverRef.current = { clientX };
      hoverAnimationFrameRef.current ??= requestAnimationFrame(flushPendingHover);
    },
    [cancelPendingHover, flushPendingHover, onHoverOver],
  );

  const mouseInside = useRef(false);
  const onMouseEnter = useCallback(() => {
    mouseInside.current = true;
  }, []);

  const onMouseLeave = useCallback(() => {
    mouseInside.current = false;
    if (!dragging) {
      dismissHover();
    }
  }, [dismissHover, dragging]);

  const onPointerUp = useCallback(
    (event: PointerEvent): void => {
      const scrub = scrubRef.current;
      if (
        scrub == undefined ||
        scrub.finalSeconds != undefined ||
        scrub.pointerId !== event.pointerId
      ) {
        return;
      }
      scrub.finalSeconds = getPlaybackSecondsAtClientX(event.clientX);
      setPreviewSeconds(scrub.finalSeconds);
      setDragging(false);
      submitSeek();
      if (mouseInside.current) {
        scheduleHoverOver(event.clientX);
      } else {
        dismissHover();
      }
    },
    [dismissHover, getPlaybackSecondsAtClientX, scheduleHoverOver, submitSeek],
  );

  const cancelScrub = useCallback(() => {
    clearSeekTimer();
    scrubRef.current = undefined;
    setPreviewSeconds(undefined);
    setDragging(false);
    dismissHover();
  }, [clearSeekTimer, dismissHover]);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent | PointerEvent): void => {
      if (disabled) {
        return;
      }
      const scrub = scrubRef.current;
      if (scrub != undefined && scrub.finalSeconds == undefined) {
        // The window listener also receives moves outside the slider.
        if (ev.currentTarget !== window || ev.pointerId !== scrub.pointerId) {
          return;
        }
        scrub.clientX = ev.clientX;
        submitSeek();
      }
      scheduleHoverOver(ev.clientX);
    },
    [disabled, scheduleHoverOver, submitSeek],
  );

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>): void => {
      if (disabled || ev.button !== 0 || dragging) {
        return;
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      ev.preventDefault();
      const seconds = getPlaybackSecondsAtMouse(ev);
      clearSeekTimer();
      scrubRef.current = { clientX: ev.clientX, pointerId: ev.pointerId, nextSeekAt: 0 };
      setPreviewSeconds(seconds);
      setDragging(true);
      scheduleHoverOver(ev.clientX);
      submitSeek();
    },
    [clearSeekTimer, disabled, dragging, getPlaybackSecondsAtMouse, scheduleHoverOver, submitSeek],
  );

  const handleContextMenu = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>): void => {
      if (disabled || seekBlocked) {
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
    [disabled, getPlaybackSecondsAtMouse, onContextMenu, seekBlocked],
  );

  useLayoutEffect(() => {
    if (!dragging) {
      return;
    }
    const onPointerCancel = (ev: PointerEvent) => {
      if (scrubRef.current?.pointerId === ev.pointerId) {
        cancelScrub();
      }
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", cancelScrub);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", cancelScrub);
    };
  }, [cancelScrub, dragging, onPointerMove, onPointerUp]);

  useLayoutEffect(() => {
    if (disabled && scrubRef.current != undefined) {
      cancelScrub();
    } else {
      submitSeek();
    }
    return clearSeekTimer;
  }, [cancelScrub, clearSeekTimer, disabled, submitSeek]);

  useEffect(() => cancelPendingHover, [cancelPendingHover]);

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
      <RenderSlider viewport={viewport} previewSeconds={previewSeconds} />
    </div>
  );
}

export default React.memo(Slider);
