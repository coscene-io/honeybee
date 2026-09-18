// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { IconButton, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import {
  PLAYBACK_SPEED_OPTIONS,
  formatPlaybackSpeed,
  fractionToPlaybackSpeed,
  playbackSpeedToFraction,
  stepPlaybackSpeed,
} from "@foxglove/studio-base/components/playbackSpeed";
import { PlaybackSpeed } from "@foxglove/studio-base/players/types";

export const PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID = "PlaybackSpeedSlider-Track";
export const PLAYBACK_SPEED_SLIDER_RESET_TEST_ID = "PlaybackSpeedSlider-Reset";

export type PlaybackSpeedSliderProps = {
  value: PlaybackSpeed;
  ariaLabel: string;
  onPreview: (speed: PlaybackSpeed) => void;
  onCommit: (speed: PlaybackSpeed) => void;
  onCancel: () => void;
  /** When set, a header button resets the speed to the parent's default (e.g. 1×). */
  reset?: {
    /** Tooltip text and aria-label for the button. */
    label: string;
    onReset: () => void;
  };
};

const TRACK_HEIGHT_PX = 20;
// Cap-style thumb: same diameter as the track height so it reads as the fill's end cap.
const THUMB_SIZE_PX = 20;

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
    minWidth: 200,
    userSelect: "none",
  },
  header: {
    position: "relative",
  },
  resetButton: {
    color: theme.palette.text.secondary,
    fontSize: 16,
    padding: theme.spacing(0.25),
    position: "absolute",
    right: 0,
    top: "50%",
    transform: "translateY(-50%)",
    ":hover": {
      color: theme.palette.text.primary,
    },
  },
  value: {
    color: theme.palette.primary.main,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 700,
    lineHeight: 1.2,
    textAlign: "center",
  },
  track: {
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
    borderRadius: 999,
    cursor: "ew-resize",
    height: TRACK_HEIGHT_PX,
    outline: "none",
    position: "relative",
    touchAction: "none",
    width: "100%",
    "&:focus-visible": {
      boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
    },
  },
  fill: {
    background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.55)}, ${theme.palette.primary.main})`,
    borderRadius: 999,
    boxShadow: `0 0 8px ${alpha(theme.palette.primary.main, 0.45)}`,
    height: "100%",
    left: 0,
    overflow: "hidden",
    pointerEvents: "none",
    position: "absolute",
    top: 0,
  },
  fillSettled: {
    transition: "width 100ms ease-out",
  },
  thumb: {
    backgroundColor: theme.palette.common.white,
    borderRadius: "50%",
    boxShadow: theme.shadows[2],
    height: THUMB_SIZE_PX,
    marginTop: -THUMB_SIZE_PX / 2,
    pointerEvents: "none",
    position: "absolute",
    top: "50%",
    transition: "transform 80ms ease-out",
    width: THUMB_SIZE_PX,
  },
  thumbSettled: {
    transition: "left 100ms ease-out, transform 80ms ease-out",
  },
  thumbActive: {
    transform: "scale(1.08)",
  },
}));

function clientXToSpeed(track: HTMLElement, clientX: number): PlaybackSpeed {
  const rect = track.getBoundingClientRect();
  // The rect reflects the Popover's Grow scale mid-transition while offsetWidth does not;
  // normalize the pointer position into layout pixels so the inset-thumb math stays exact.
  const scale = rect.width === 0 ? 1 : track.offsetWidth / rect.width;
  const localX = (clientX - rect.left) * scale;
  // The thumb center travels within [THUMB_SIZE_PX / 2, width - THUMB_SIZE_PX / 2], so the
  // pointer maps against that inset range (fractionToPlaybackSpeed clamps the endpoints).
  const travel = track.offsetWidth - THUMB_SIZE_PX;
  const fraction = travel <= 0 ? 0 : (localX - THUMB_SIZE_PX / 2) / travel;
  return fractionToPlaybackSpeed(fraction);
}

function PlaybackSpeedSlider(props: PlaybackSpeedSliderProps): React.JSX.Element {
  const { value, ariaLabel, onPreview, onCommit, onCancel, reset } = props;
  const { classes, cx } = useStyles();
  const trackRef = useRef<HTMLDivElement>(ReactNull);
  const draggingRef = useRef(false);
  const activePointerIdRef = useRef<number | undefined>(undefined);
  const dragPositionRef = useRef<{ clientX: number; speed: PlaybackSpeed } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const fraction = playbackSpeedToFraction(value);

  // The thumb travels fully inside the track: its left edge goes from 0 to
  // (track width - thumb size), and the fill always extends to the thumb's center.
  const thumbTravel = `${fraction * 100}% - ${fraction * THUMB_SIZE_PX}px`;
  const thumbLeft = `calc(${thumbTravel})`;
  const fillWidth = `calc(${thumbTravel} + ${THUMB_SIZE_PX / 2}px)`;

  const stopDragging = useCallback(() => {
    draggingRef.current = false;
    activePointerIdRef.current = undefined;
    dragPositionRef.current = undefined;
    setDragging(false);
  }, []);

  const previewAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (track == undefined) {
        return undefined;
      }
      // Grow can move the track under a stationary pointer. Retain its last preview
      // until the pointer actually changes position, including on release.
      if (dragPositionRef.current?.clientX !== clientX) {
        const speed = clientXToSpeed(track, clientX);
        dragPositionRef.current = { clientX, speed };
        onPreview(speed);
      }
      return dragPositionRef.current.speed;
    },
    [onPreview],
  );

  const finishDrag = useCallback(
    (next: "commit" | "cancel", clientX?: number) => {
      if (!draggingRef.current) {
        return;
      }
      const speed = next === "commit" && clientX != undefined ? previewAt(clientX) : undefined;
      stopDragging();
      if (speed != undefined) {
        onCommit(speed);
        return;
      }
      onCancel();
    },
    [onCancel, onCommit, previewAt, stopDragging],
  );

  const commitPreset = useCallback(
    (next: PlaybackSpeed) => {
      stopDragging();
      onPreview(next);
      onCommit(next);
    },
    [onCommit, onPreview, stopDragging],
  );

  useLayoutEffect(() => {
    trackRef.current?.focus();
  }, []);

  // If the popover closes mid-drag (e.g. a backdrop tap from a second pointer), the
  // pending pointerup never arrives — release the preview back to the committed speed.
  const onCancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  });
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        onCancelRef.current();
      }
    };
  }, []);

  useEffect(() => {
    const isActivePointer = (event: PointerEvent) =>
      draggingRef.current && event.pointerId === activePointerIdRef.current;

    const onMove = (event: PointerEvent) => {
      if (!isActivePointer(event)) {
        return;
      }
      // End when the primary button is released, including chorded-button moves and
      // recovery after a pointerup was lost outside the window.
      if ((event.buttons & 1) === 0) {
        finishDrag("commit", event.clientX);
        return;
      }
      previewAt(event.clientX);
    };
    const onUp = (event: PointerEvent) => {
      if (!isActivePointer(event)) {
        return;
      }
      // Ignore secondary releases while another button stays held.
      if (event.button !== 0 && event.buttons !== 0) {
        return;
      }
      finishDrag("commit", event.clientX);
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (!isActivePointer(event)) {
        return;
      }
      finishDrag("cancel");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [finishDrag, previewAt]);

  return (
    <div className={classes.root}>
      <div className={classes.header}>
        <Typography className={classes.value} variant="subtitle1" component="div">
          {formatPlaybackSpeed(value)}
        </Typography>
        {reset != undefined && (
          <Tooltip title={reset.label}>
            <IconButton
              className={classes.resetButton}
              aria-label={reset.label}
              data-testid={PLAYBACK_SPEED_SLIDER_RESET_TEST_ID}
              onClick={() => {
                stopDragging();
                reset.onReset();
              }}
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.stopPropagation();
                }
              }}
              size="small"
            >
              <RestartAltIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        )}
      </div>
      <div
        ref={trackRef}
        className={classes.track}
        data-testid={PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0.01}
        aria-valuemax={10}
        aria-valuenow={value}
        aria-valuetext={formatPlaybackSpeed(value)}
        onPointerDown={(event) => {
          if (event.button !== 0 || draggingRef.current) {
            return;
          }
          event.preventDefault();
          draggingRef.current = true;
          activePointerIdRef.current = event.pointerId;
          setDragging(true);
          event.currentTarget.focus();
          previewAt(event.clientX);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (draggingRef.current) {
              event.stopPropagation();
              finishDrag("cancel");
            }
            return;
          }
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            commitPreset(stepPlaybackSpeed(value, "increase"));
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            commitPreset(stepPlaybackSpeed(value, "decrease"));
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            commitPreset(PLAYBACK_SPEED_OPTIONS[0]);
            return;
          }
          if (event.key === "End") {
            const next = PLAYBACK_SPEED_OPTIONS[PLAYBACK_SPEED_OPTIONS.length - 1];
            if (next == undefined) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            commitPreset(next);
          }
        }}
      >
        <div
          className={cx(classes.fill, !dragging && classes.fillSettled)}
          style={{ width: fillWidth }}
        />
        <div
          className={cx(
            classes.thumb,
            dragging && classes.thumbActive,
            !dragging && classes.thumbSettled,
          )}
          style={{ left: thumbLeft }}
        />
      </div>
    </div>
  );
}

export default React.memo(PlaybackSpeedSlider);
