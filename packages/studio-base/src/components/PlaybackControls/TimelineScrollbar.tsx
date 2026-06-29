// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useResizeDetector } from "react-resize-detector";
import { useLatest } from "react-use";
import { makeStyles } from "tss-react/mui";

import {
  getViewportScrollMetrics,
  type TimelineScrollMetrics,
  type TimelineViewport,
} from "./timelineViewport";

// Horizontal scrollbar shown beneath the timeline while it is zoomed in. The thumb mirrors the
// share of the recording currently visible; dragging it (or clicking the track) pans the viewport.

export const TIMELINE_SCROLLBAR_HEIGHT_PX: number = 12;

// Keep the thumb grabbable even when zoomed in so far that its true proportional width would be a
// sliver. The drag math accounts for this widened thumb so panning still reaches both ends.
const MIN_THUMB_WIDTH_PX: number = 24;

// Fraction of the visible window panned per Arrow key press; Page keys move a full window.
const ARROW_STEP_FRACTION: number = 0.1;

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

type ThumbGeometry = {
  /** Rendered thumb width in px (never below MIN_THUMB_WIDTH_PX). */
  thumbWidthPx: number;
  /** Rendered thumb left offset in px. */
  thumbLeftPx: number;
  /** Distance the thumb's left edge can travel across the track in px. */
  travelPx: number;
  /** Largest possible visible-window start as a fraction of the total range. */
  maxStartFraction: number;
};

// Resolve the rendered thumb geometry for a track width. Because the thumb is clamped to a minimum
// width, its travel is `trackWidth - thumbWidthPx` rather than the full track — both rendering and
// pointer math go through here so they agree (otherwise the thumb can't pan to the very end).
function getThumbGeometry(metrics: TimelineScrollMetrics, trackWidth: number): ThumbGeometry {
  const thumbWidthPx = Math.max(metrics.thumbSizeFraction * trackWidth, MIN_THUMB_WIDTH_PX);
  const travelPx = Math.max(0, trackWidth - thumbWidthPx);
  const maxStartFraction = Math.max(0, 1 - metrics.thumbSizeFraction);
  const scrollProgress = maxStartFraction > 0 ? metrics.thumbStartFraction / maxStartFraction : 0;
  const thumbLeftPx = clamp(scrollProgress * travelPx, 0, travelPx);

  return { thumbWidthPx, thumbLeftPx, travelPx, maxStartFraction };
}

const useStyles = makeStyles()((theme) => ({
  root: {
    alignItems: "center",
    display: "flex",
    flex: `0 0 ${TIMELINE_SCROLLBAR_HEIGHT_PX}px`,
    height: TIMELINE_SCROLLBAR_HEIGHT_PX,
    paddingInline: theme.spacing(0.5),
  },
  track: {
    backgroundColor: alpha(theme.palette.text.primary, 0.06),
    borderRadius: TIMELINE_SCROLLBAR_HEIGHT_PX / 2,
    cursor: "pointer",
    flex: "1 1 auto",
    height: 8,
    position: "relative",
    touchAction: "none",
  },
  trackDisabled: {
    cursor: "default",
    opacity: theme.palette.action.disabledOpacity,
    pointerEvents: "none",
  },
  thumb: {
    backgroundColor: alpha(theme.palette.text.secondary, 0.45),
    borderRadius: TIMELINE_SCROLLBAR_HEIGHT_PX / 2,
    bottom: 0,
    cursor: "grab",
    minWidth: MIN_THUMB_WIDTH_PX,
    position: "absolute",
    top: 0,
    transition: theme.transitions.create("background-color", {
      duration: theme.transitions.duration.shortest,
    }),

    "&:hover": {
      backgroundColor: alpha(theme.palette.text.secondary, 0.6),
    },
    "&:focus-visible": {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 1,
    },
  },
  thumbDragging: {
    backgroundColor: alpha(theme.palette.text.secondary, 0.75),
    cursor: "grabbing",

    "&:hover": {
      backgroundColor: alpha(theme.palette.text.secondary, 0.75),
    },
  },
}));

type Props = {
  viewport: TimelineViewport;
  /** Called with the desired visible-window start (seconds from the recording start). */
  onScroll: (visibleStartSec: number) => void;
  disabled?: boolean;
};

function TimelineScrollbar(props: Props): React.JSX.Element {
  const { viewport, onScroll, disabled = false } = props;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("general");

  const { width: trackWidth, ref: trackRef } = useResizeDetector<HTMLDivElement>({
    handleHeight: false,
    refreshMode: "debounce",
    refreshRate: 0,
  });
  // Distance between the pointer and the thumb's left edge captured at pointer-down, so the grabbed
  // point stays glued under the cursor for the whole drag (drift-free near the track edges).
  const grabOffsetRef = useRef(0);
  const latestViewport = useLatest(viewport);
  const onScrollRef = useLatest(onScroll);

  const [dragging, setDragging] = useState(false);

  const metrics = getViewportScrollMetrics(viewport);

  // Map an absolute pointer position to a visible-window start and emit it. Reads the track rect
  // fresh each call so resizes/scrolls mid-drag stay accurate.
  const scrollToPointer = useCallback(
    (clientX: number): void => {
      const track = trackRef.current;
      const currentViewport = latestViewport.current;
      if (track == undefined) {
        return;
      }

      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const { travelPx, maxStartFraction } = getThumbGeometry(
        getViewportScrollMetrics(currentViewport),
        rect.width,
      );
      const totalDuration = currentViewport.totalEndSec - currentViewport.totalStartSec;
      const desiredLeftPx = clientX - rect.left - grabOffsetRef.current;
      // Convert the desired thumb position back through the rendered travel, not the full track.
      const scrollProgress = travelPx > 0 ? clamp(desiredLeftPx / travelPx, 0, 1) : 0;
      const nextStartFraction = scrollProgress * maxStartFraction;

      onScrollRef.current(currentViewport.totalStartSec + nextStartFraction * totalDuration);
    },
    [latestViewport, onScrollRef, trackRef],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const track = trackRef.current;
      if (disabled || event.button !== 0 || track == undefined) {
        return;
      }

      event.preventDefault();

      const rect = track.getBoundingClientRect();
      const { thumbLeftPx, thumbWidthPx } = getThumbGeometry(
        getViewportScrollMetrics(latestViewport.current),
        rect.width,
      );
      const pointerPx = event.clientX - rect.left;

      const onThumb = pointerPx >= thumbLeftPx && pointerPx <= thumbLeftPx + thumbWidthPx;
      // On the thumb: keep the exact grabbed point under the cursor. On the track: center the thumb
      // under the cursor so the click jumps the window there, then continue as a drag.
      grabOffsetRef.current = onThumb ? pointerPx - thumbLeftPx : thumbWidthPx / 2;

      setDragging(true);
      scrollToPointer(event.clientX);
    },
    [disabled, latestViewport, scrollToPointer, trackRef],
  );

  // Keyboard panning so the scrollbar is operable without a pointer (it is announced as a
  // scrollbar, so it must respond to the standard scroll keys).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (disabled) {
        return;
      }

      const currentViewport = latestViewport.current;
      const visibleDuration = Math.max(
        currentViewport.visibleEndSec - currentViewport.visibleStartSec,
        0,
      );
      const step = visibleDuration * ARROW_STEP_FRACTION;

      let target: number;
      switch (event.key) {
        case "ArrowLeft":
          target = currentViewport.visibleStartSec - step;
          break;
        case "ArrowRight":
          target = currentViewport.visibleStartSec + step;
          break;
        case "PageUp":
          target = currentViewport.visibleStartSec - visibleDuration;
          break;
        case "PageDown":
          target = currentViewport.visibleStartSec + visibleDuration;
          break;
        case "Home":
          target = currentViewport.totalStartSec;
          break;
        case "End":
          target = currentViewport.totalEndSec;
          break;
        default:
          return;
      }

      event.preventDefault();
      // Stop the handled key from bubbling to the document-level KeyListener, whose Arrow handlers
      // seek playback — otherwise panning the zoomed timeline would also move the playhead.
      event.stopPropagation();
      onScrollRef.current(target);
    },
    [disabled, latestViewport, onScrollRef],
  );

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    const onPointerMove = (event: PointerEvent): void => {
      scrollToPointer(event.clientX);
    };
    const onPointerUp = (): void => {
      setDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging, scrollToPointer]);

  // Once the track is measured, size and position the thumb in pixels so the minimum width is
  // honored without ever overflowing the track edges. Fall back to proportional units until then.
  let thumbStyle: React.CSSProperties;
  if (trackWidth != undefined && trackWidth > 0) {
    const { thumbLeftPx, thumbWidthPx } = getThumbGeometry(metrics, trackWidth);
    thumbStyle = { left: thumbLeftPx, width: thumbWidthPx };
  } else {
    thumbStyle = {
      left: `${metrics.thumbStartFraction * 100}%`,
      width: `${metrics.thumbSizeFraction * 100}%`,
    };
  }

  // Report progress through the scrollable range (0 at the start, 100 fully scrolled to the end).
  const maxStartFraction = Math.max(0, 1 - metrics.thumbSizeFraction);
  const scrollProgressPercent =
    maxStartFraction > 0 ? Math.round((metrics.thumbStartFraction / maxStartFraction) * 100) : 0;

  return (
    <div className={classes.root}>
      <div
        ref={trackRef}
        className={cx(classes.track, { [classes.trackDisabled]: disabled })}
        data-testid="timeline-scrollbar"
        onPointerDown={onPointerDown}
      >
        <div
          aria-controls="timeline-content"
          aria-label={t("panTimeline")}
          aria-orientation="horizontal"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={scrollProgressPercent}
          className={cx(classes.thumb, { [classes.thumbDragging]: dragging })}
          data-testid="timeline-scrollbar-thumb"
          onKeyDown={onKeyDown}
          role="scrollbar"
          style={thumbStyle}
          tabIndex={disabled ? -1 : 0}
        />
      </div>
    </div>
  );
}

export default React.memo(TimelineScrollbar);
