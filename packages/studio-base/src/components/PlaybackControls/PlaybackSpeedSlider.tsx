// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Typography } from "@mui/material";
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

export type PlaybackSpeedSliderProps = {
  value: PlaybackSpeed;
  ariaLabel: string;
  onPreview: (speed: PlaybackSpeed) => void;
  onCommit: (speed: PlaybackSpeed) => void;
  onCancel: () => void;
};

const PARTICLES: ReadonlyArray<{ left: string; top: string; minFraction: number }> = [
  { left: "14%", top: "38%", minFraction: 0.12 },
  { left: "28%", top: "62%", minFraction: 0.28 },
  { left: "42%", top: "32%", minFraction: 0.4 },
  { left: "56%", top: "58%", minFraction: 0.52 },
  { left: "70%", top: "36%", minFraction: 0.68 },
  { left: "84%", top: "54%", minFraction: 0.82 },
];

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1.5),
    minWidth: 228,
    userSelect: "none",
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
    height: 28,
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
    boxShadow: `0 0 12px ${alpha(theme.palette.primary.main, 0.45)}`,
    height: "100%",
    left: 0,
    overflow: "hidden",
    pointerEvents: "none",
    position: "absolute",
    top: 0,
  },
  particle: {
    backgroundColor: alpha(theme.palette.common.white, 0.7),
    borderRadius: "50%",
    height: 3,
    pointerEvents: "none",
    position: "absolute",
    width: 3,
  },
  thumb: {
    backgroundColor: theme.palette.common.white,
    borderRadius: "50%",
    boxShadow: theme.shadows[2],
    height: 18,
    marginTop: -9,
    pointerEvents: "none",
    position: "absolute",
    top: "50%",
    transform: "translateX(-50%)",
    transition: "transform 80ms ease-out",
    width: 18,
  },
  thumbActive: {
    transform: "translateX(-50%) scale(1.08)",
  },
}));

function clientXToSpeed(track: HTMLElement, clientX: number): PlaybackSpeed {
  const rect = track.getBoundingClientRect();
  const fraction = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
  return fractionToPlaybackSpeed(fraction);
}

function PlaybackSpeedSlider(props: PlaybackSpeedSliderProps): React.JSX.Element {
  const { value, ariaLabel, onPreview, onCommit, onCancel } = props;
  const { classes, cx } = useStyles();
  const trackRef = useRef<HTMLDivElement>(ReactNull);
  const draggingRef = useRef(false);
  const activePointerIdRef = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const fraction = playbackSpeedToFraction(value);

  const finishDrag = useCallback(
    (next: "commit" | "cancel", clientX?: number) => {
      if (!draggingRef.current) {
        return;
      }
      draggingRef.current = false;
      activePointerIdRef.current = undefined;
      setDragging(false);
      const track = trackRef.current;
      if (next === "commit" && track != undefined && clientX != undefined) {
        onCommit(clientXToSpeed(track, clientX));
        return;
      }
      onCancel();
    },
    [onCancel, onCommit],
  );

  useLayoutEffect(() => {
    trackRef.current?.focus();
  }, []);

  useEffect(() => {
    const isActivePointer = (event: PointerEvent) =>
      draggingRef.current && event.pointerId === activePointerIdRef.current;

    const onMove = (event: PointerEvent) => {
      if (!isActivePointer(event)) {
        return;
      }
      const track = trackRef.current;
      if (track == undefined) {
        return;
      }
      onPreview(clientXToSpeed(track, event.clientX));
    };
    const onUp = (event: PointerEvent) => {
      if (!isActivePointer(event)) {
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
  }, [finishDrag, onPreview]);

  return (
    <div className={classes.root}>
      <Typography className={classes.value} variant="h6" component="div">
        {formatPlaybackSpeed(value)}
      </Typography>
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
          onPreview(clientXToSpeed(event.currentTarget, event.clientX));
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
            const next = stepPlaybackSpeed(value, "increase");
            onPreview(next);
            onCommit(next);
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            const next = stepPlaybackSpeed(value, "decrease");
            onPreview(next);
            onCommit(next);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            const next = PLAYBACK_SPEED_OPTIONS[0];
            onPreview(next);
            onCommit(next);
            return;
          }
          if (event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            const next = PLAYBACK_SPEED_OPTIONS[PLAYBACK_SPEED_OPTIONS.length - 1];
            if (next == undefined) {
              return;
            }
            onPreview(next);
            onCommit(next);
          }
        }}
      >
        <div className={classes.fill} style={{ width: `${fraction * 100}%` }}>
          {PARTICLES.filter((particle) => fraction >= particle.minFraction).map((particle) => (
            <span
              key={particle.left}
              className={classes.particle}
              style={{ left: particle.left, top: particle.top }}
            />
          ))}
        </div>
        <div
          className={cx(classes.thumb, dragging && classes.thumbActive)}
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

export default React.memo(PlaybackSpeedSlider);
