// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ButtonBase } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { subtract as subtractTimes, toSec } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { layoutEventLanes } from "@foxglove/studio-base/components/PlaybackControls/eventLanes";
import { makeTimelineViewport } from "@foxglove/studio-base/components/PlaybackControls/timelineViewport";
import {
  type EventsStore,
  type TimelinePositionedEvent,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import {
  type MomentSubtitlePosition,
  type WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";

export const MOMENT_SUBTITLE_DEFAULT_BOTTOM_PX: number = 80;
export const MOMENT_SUBTITLE_DEFAULT_FONT_SIZE_PX: number = 16;
export const MOMENT_SUBTITLE_FONT_SIZE_STEP_PX: number = 4;
export const MOMENT_SUBTITLE_MAX_FONT_SIZE_PX: number = 56;
export const MOMENT_SUBTITLE_MIN_FONT_SIZE_PX: number = 12;

const MOMENT_SUBTITLE_CONTROLS_HIDE_DELAY_MS: number = 200;

const DEFAULT_SUBTITLE_POSITION: MomentSubtitlePosition = {
  anchorX: 0.5,
  bottom: MOMENT_SUBTITLE_DEFAULT_BOTTOM_PX,
};

const useStyles = makeStyles<void, "controls" | "controlsVisible" | "dragging" | "hoverBridge">()(
  (theme, _params, classes) => ({
    root: {
      alignItems: "center",
      display: "flex",
      flexDirection: "column",
      left: "50%",
      maxWidth: "min(80vw, 960px)",
      pointerEvents: "auto",
      position: "fixed",
      transform: "translateX(-50%)",
      zIndex: 100010,

      [`&.${classes.controlsVisible} .${classes.controls}`]: {
        opacity: 1,
        pointerEvents: "auto",
        transform: "translate(-50%, 0px)",
        visibility: "visible",
      },

      [`&.${classes.controlsVisible} .${classes.hoverBridge}`]: {
        pointerEvents: "auto",
      },
    },
    controlsVisible: {},
    dragging: {},
    hoverBridge: {
      bottom: "100%",
      height: 8,
      left: -160,
      pointerEvents: "none",
      position: "absolute",
      right: -160,
    },
    controls: {
      alignItems: "center",
      bottom: "calc(100% + 8px)",
      display: "flex",
      gap: 8,
      justifyContent: "center",
      left: "50%",
      opacity: 0,
      pointerEvents: "none",
      position: "absolute",
      transform: "translate(-50%, 2px)",
      transition: theme.transitions.create(["opacity", "transform"], {
        duration: theme.transitions.duration.shortest,
      }),
      visibility: "hidden",
      whiteSpace: "nowrap",
    },
    controlButton: {
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      borderRadius: 6,
      color: "#fff",
      fontSize: 12,
      fontWeight: 400,
      height: 28,
      lineHeight: "20px",
      minWidth: 0,
      padding: "4px 8px",

      "&:hover": {
        backgroundColor: "rgba(0, 0, 0, 0.72)",
      },

      "&.Mui-disabled": {
        color: "rgba(255, 255, 255, 0.45)",
        opacity: 0.6,
      },
    },
    resetButton: {
      "&:hover": {
        backgroundColor: "rgba(0, 0, 0, 0.72)",
      },
    },
    subtitle: {
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      borderRadius: 8,
      color: "#fff",
      cursor: "grab",
      fontWeight: 500,
      maxWidth: "100%",
      outline: 0,
      overflowWrap: "anywhere",
      padding: 8,
      textAlign: "center",
      touchAction: "none",
      userSelect: "none",
      whiteSpace: "pre-wrap",

      [`&.${classes.dragging}`]: {
        cursor: "grabbing",
      },

      "&:focus-visible": {
        boxShadow: `0 0 0 2px ${theme.palette.primary.main}`,
      },
    },
    subtitleLine: {
      display: "block",
    },
  }),
);

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectEvents = (store: EventsStore) => store.events;
const selectMomentSubtitle = (store: WorkspaceContextStore) =>
  store.playbackControls.momentSubtitle;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPositiveDimension(primary: number, fallback: number): number {
  if (Number.isFinite(primary) && primary > 0) {
    return primary;
  }

  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }

  return 1;
}

function getWindowSize(): { height: number; width: number } {
  return {
    height: getPositiveDimension(window.innerHeight, document.documentElement.clientHeight),
    width: getPositiveDimension(window.innerWidth, document.documentElement.clientWidth),
  };
}

function getEventDisplayName(event: TimelinePositionedEvent): string {
  const displayName = event.event.displayName.trim();
  return displayName.length > 0 ? displayName : event.event.name;
}

function getEffectivePosition(
  position: undefined | MomentSubtitlePosition,
): MomentSubtitlePosition {
  return position ?? DEFAULT_SUBTITLE_POSITION;
}

function isDefaultPosition(position: undefined | MomentSubtitlePosition): boolean {
  return (
    position == undefined ||
    (Math.abs(position.anchorX - DEFAULT_SUBTITLE_POSITION.anchorX) < 0.0001 &&
      position.bottom === DEFAULT_SUBTITLE_POSITION.bottom)
  );
}

function isPlaybackSecondsInEvent({
  playbackSeconds,
  event,
  timelineDurationSeconds,
}: {
  playbackSeconds: number;
  event: TimelinePositionedEvent;
  timelineDurationSeconds: number;
}): boolean {
  const eventStartSeconds = event.secondsSinceStart;
  const eventEndSeconds =
    event.secondsSinceStart + toSec(subtractTimes(event.endTime, event.startTime));

  if (eventStartSeconds === eventEndSeconds) {
    return playbackSeconds === eventStartSeconds;
  }

  return (
    playbackSeconds >= eventStartSeconds &&
    (playbackSeconds < eventEndSeconds ||
      (playbackSeconds === timelineDurationSeconds && eventEndSeconds === timelineDurationSeconds))
  );
}

export function MomentSubtitleOverlay(): React.JSX.Element | ReactNull {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("general");
  const subtitle = useWorkspaceStore(selectMomentSubtitle);
  const events = useEvents(selectEvents);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const {
    playbackControlActions: { setMomentSubtitleFontSize, setMomentSubtitlePosition },
  } = useWorkspaceActions();
  const subtitleRef = useRef<HTMLDivElement>(ReactNull);
  const hideControlsTimeoutRef = useRef<number | undefined>(undefined);
  const keyboardFocusVisibleRef = useRef(true);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const [dragging, setDragging] = useState(false);

  const activeEvents = useMemo((): TimelinePositionedEvent[] => {
    if (
      !subtitle.enabled ||
      currentTime == undefined ||
      startTime == undefined ||
      endTime == undefined
    ) {
      return [];
    }

    const timelineDurationSeconds = toSec(subtractTimes(endTime, startTime));
    if (timelineDurationSeconds < 0) {
      return [];
    }

    const playbackSeconds = toSec(subtractTimes(currentTime, startTime));
    const allEvents = events.value ?? [];
    const viewport = makeTimelineViewport(0, timelineDurationSeconds);
    const laneLayout = layoutEventLanes({ events: allEvents, viewport });
    const laneByEventName = new Map(
      laneLayout.items.map((item) => [item.event.event.name, item.lane]),
    );

    return allEvents
      .filter((event) =>
        isPlaybackSecondsInEvent({
          playbackSeconds,
          event,
          timelineDurationSeconds,
        }),
      )
      .sort((left, right) => {
        const laneDelta =
          (laneByEventName.get(left.event.name) ?? Number.MAX_SAFE_INTEGER) -
          (laneByEventName.get(right.event.name) ?? Number.MAX_SAFE_INTEGER);
        if (laneDelta !== 0) {
          return laneDelta;
        }

        const startDelta = left.secondsSinceStart - right.secondsSinceStart;
        if (startDelta !== 0) {
          return startDelta;
        }

        return left.event.name.localeCompare(right.event.name);
      });
  }, [currentTime, endTime, events.value, startTime, subtitle.enabled]);

  const decreaseFontSize = useCallback((): void => {
    setMomentSubtitleFontSize((old) =>
      Math.max(MOMENT_SUBTITLE_MIN_FONT_SIZE_PX, old - MOMENT_SUBTITLE_FONT_SIZE_STEP_PX),
    );
  }, [setMomentSubtitleFontSize]);

  const increaseFontSize = useCallback((): void => {
    setMomentSubtitleFontSize((old) =>
      Math.min(MOMENT_SUBTITLE_MAX_FONT_SIZE_PX, old + MOMENT_SUBTITLE_FONT_SIZE_STEP_PX),
    );
  }, [setMomentSubtitleFontSize]);

  const resetPosition = useCallback((): void => {
    setMomentSubtitlePosition(undefined);
  }, [setMomentSubtitlePosition]);

  const clearHideControlsTimeout = useCallback((): void => {
    if (hideControlsTimeoutRef.current == undefined) {
      return;
    }

    window.clearTimeout(hideControlsTimeoutRef.current);
    hideControlsTimeoutRef.current = undefined;
  }, []);

  const showHoverControls = useCallback((): void => {
    clearHideControlsTimeout();
    setHovered(true);
  }, [clearHideControlsTimeout]);

  const hideHoverControlsLater = useCallback((): void => {
    clearHideControlsTimeout();
    hideControlsTimeoutRef.current = window.setTimeout(() => {
      hideControlsTimeoutRef.current = undefined;
      setHovered(false);
    }, MOMENT_SUBTITLE_CONTROLS_HIDE_DELAY_MS);
  }, [clearHideControlsTimeout]);

  useEffect(() => {
    return clearHideControlsTimeout;
  }, [clearHideControlsTimeout]);

  const handleKeyDown = useCallback((): void => {
    keyboardFocusVisibleRef.current = true;
  }, []);

  const handlePointerDownCapture = useCallback((): void => {
    keyboardFocusVisibleRef.current = false;
    setFocusedWithin(false);
  }, []);

  const handleFocus = useCallback((): void => {
    if (!keyboardFocusVisibleRef.current) {
      return;
    }

    clearHideControlsTimeout();
    setFocusedWithin(true);
  }, [clearHideControlsTimeout]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = subtitleRef.current?.getBoundingClientRect();
      const { width: windowWidth, height: windowHeight } = getWindowSize();
      const startPosition = getEffectivePosition(subtitle.position);
      const startCenterX = startPosition.anchorX * windowWidth;
      const startPointerX = event.clientX;
      const startPointerY = event.clientY;
      const subtitleWidth = rect?.width ?? 0;
      const subtitleHeight = rect?.height ?? 0;
      const minAnchorX = subtitleWidth > 0 ? subtitleWidth / 2 / windowWidth : 0;
      const maxAnchorX = subtitleWidth > 0 ? (windowWidth - subtitleWidth / 2) / windowWidth : 1;
      const maxBottom = Math.max(0, windowHeight - subtitleHeight);

      setDragging(true);

      const onPointerMove = (pointerEvent: PointerEvent): void => {
        const deltaX = pointerEvent.clientX - startPointerX;
        const deltaY = pointerEvent.clientY - startPointerY;
        setMomentSubtitlePosition({
          anchorX: clamp((startCenterX + deltaX) / windowWidth, minAnchorX, maxAnchorX),
          bottom: clamp(startPosition.bottom - deltaY, 0, maxBottom),
        });
      };

      const onPointerUp = (): void => {
        setDragging(false);
        window.removeEventListener("pointermove", onPointerMove);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [setMomentSubtitlePosition, subtitle.position],
  );

  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>): void => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setFocusedWithin(false);
  }, []);

  if (!subtitle.enabled || activeEvents.length === 0) {
    return ReactNull;
  }

  const position = getEffectivePosition(subtitle.position);
  const showControls = hovered || focusedWithin;
  const decreaseDisabled = subtitle.fontSize <= MOMENT_SUBTITLE_MIN_FONT_SIZE_PX;
  const increaseDisabled = subtitle.fontSize >= MOMENT_SUBTITLE_MAX_FONT_SIZE_PX;
  const resetDisabled = isDefaultPosition(subtitle.position);

  return (
    <div
      className={cx(classes.root, showControls && classes.controlsVisible)}
      data-controls-visible={showControls ? "true" : "false"}
      data-testid="moment-subtitle-container"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onMouseEnter={showHoverControls}
      onMouseLeave={hideHoverControlsLater}
      onPointerDownCapture={handlePointerDownCapture}
      style={{
        bottom: `${position.bottom}px`,
        left: `${position.anchorX * 100}%`,
      }}
    >
      <div
        aria-hidden
        className={classes.hoverBridge}
        onMouseEnter={showHoverControls}
        onMouseLeave={hideHoverControlsLater}
      />
      <div
        className={classes.controls}
        data-testid="moment-subtitle-controls"
        onMouseEnter={showHoverControls}
        onMouseLeave={hideHoverControlsLater}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <ButtonBase
          aria-label={t("decreaseMomentSubtitleFontSize")}
          className={classes.controlButton}
          disabled={decreaseDisabled}
          onClick={decreaseFontSize}
          type="button"
        >
          A-
        </ButtonBase>
        <ButtonBase
          aria-label={t("increaseMomentSubtitleFontSize")}
          className={classes.controlButton}
          disabled={increaseDisabled}
          onClick={increaseFontSize}
          type="button"
        >
          A+
        </ButtonBase>
        <ButtonBase
          aria-label={t("resetMomentSubtitlePosition")}
          className={cx(classes.controlButton, classes.resetButton)}
          disabled={resetDisabled}
          onClick={resetPosition}
          type="button"
        >
          {t("resetMomentSubtitlePosition")}
        </ButtonBase>
      </div>
      <div
        className={cx(classes.subtitle, dragging && classes.dragging)}
        data-testid="moment-subtitle"
        onPointerDown={startDrag}
        ref={subtitleRef}
        style={{
          fontSize: `${subtitle.fontSize}px`,
          lineHeight: `${subtitle.fontSize * 1.5}px`,
        }}
        tabIndex={0}
      >
        {activeEvents.map((event) => (
          <span
            className={classes.subtitleLine}
            data-testid="moment-subtitle-line"
            key={event.event.name}
          >
            {getEventDisplayName(event)}
          </span>
        ))}
      </div>
    </div>
  );
}
