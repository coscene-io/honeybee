// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { keyframes } from "@emotion/react";
import { simplify } from "intervals-fn";
import * as _ from "lodash-es";
import { useMemo } from "react";
import { useResizeDetector } from "react-resize-detector";
import tinycolor from "tinycolor2";
import { makeStyles } from "tss-react/mui";

import { filterMap } from "@foxglove/den/collection";
import { Immutable } from "@foxglove/studio";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";

import {
  getVisibleDuration,
  timelinePointToPercent,
  type TimelineViewport,
  timelineRangeToStyle,
} from "./timelineViewport";

type ProgressProps = Immutable<{
  loading: boolean;
  viewport: TimelineViewport;
}>;

const STRIPE_WIDTH = 8;
const MIN_MAJOR_TICK_SPACING_PX = 96;
const MINOR_TICKS_PER_MAJOR_INTERVAL = 8;
const TICK_EPSILON = 0.000001;
const TIME_STEP_SECONDS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
  14400, 21600, 43200, 86400,
];

type Tick = {
  key: string;
  timeSec: number;
};

const animatedBackground = keyframes`
  0% { background-position: 0 0; }
  100% { background-position: ${STRIPE_WIDTH * 2}px 0; }
`;

const useStyles = makeStyles()((theme) => ({
  root: {
    label: "ProgressPlot-root",
    backgroundColor:
      theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.02)",
    borderBottom: `1px solid ${theme.palette.divider}`,
    height: "100%",
    overflow: "hidden",
    pointerEvents: "none",
    position: "relative",
    width: "100%",
  },
  progressBand: {
    label: "ProgressPlot-progressBand",
    bottom: 0,
    height: 4,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    zIndex: 0,
  },
  loadingIndicator: {
    label: "ProgressPlot-loadingIndicator",
    position: "absolute",
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    animation: `${animatedBackground} 300ms linear infinite`,
    backgroundRepeat: "repeat-x",
    backgroundSize: `${STRIPE_WIDTH * 2}px 100%`,
    backgroundImage: `repeating-linear-gradient(${[
      "90deg",
      theme.palette.background.paper,
      `${theme.palette.background.paper} ${STRIPE_WIDTH / 2}px`,
      `transparent ${STRIPE_WIDTH / 2}px`,
      `transparent ${STRIPE_WIDTH}px`,
    ].join(",")})`,
  },
  range: {
    label: "ProgressPlot-range",
    position: "absolute",
    pointerEvents: "none",
    backgroundColor:
      theme.palette.mode === "dark"
        ? tinycolor(theme.palette.text.secondary).darken(25).toHexString()
        : tinycolor(theme.palette.text.secondary).lighten(25).toHexString(),
    height: "100%",
  },
  minorTick: {
    label: "ProgressPlot-minorTick",
    backgroundColor: theme.palette.divider,
    height: 4,
    position: "absolute",
    top: 1,
    transform: "translateX(-50%)",
    width: 1,
    zIndex: 1,
  },
  majorTick: {
    label: "ProgressPlot-majorTick",
    backgroundColor: theme.palette.divider,
    height: 10,
    position: "absolute",
    top: 1,
    transform: "translateX(-50%)",
    width: 1,
    zIndex: 2,
  },
  tickLabel: {
    label: "ProgressPlot-tickLabel",
    color: theme.palette.text.disabled,
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontVariantNumeric: "tabular-nums",
    lineHeight: "12px",
    position: "absolute",
    top: 1,
    transform: "translateX(4px)",
    whiteSpace: "nowrap",
    zIndex: 3,
  },
}));

const selectRanges = (ctx: MessagePipelineContext) =>
  ctx.playerState.progress.fullyLoadedFractionRanges;

function formatTickTime(timeSec: number, stepSec: number): string {
  const isNegative = timeSec < -TICK_EPSILON;
  const absSec = Math.abs(timeSec);
  const decimals = stepSec < 1 ? Math.min(3, Math.max(1, Math.ceil(-Math.log10(stepSec)))) : 0;
  const roundedSec = decimals > 0 ? Number(absSec.toFixed(decimals)) : Math.round(absSec);
  const wholeSeconds = Math.floor(roundedSec);
  const fractionalSeconds = decimals > 0 ? roundedSec - wholeSeconds : 0;
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  const fraction =
    decimals > 0
      ? `.${Math.round(fractionalSeconds * 10 ** decimals)
          .toString()
          .padStart(decimals, "0")}`
      : "";
  const sign = isNegative ? "-" : "";

  if (hours > 0) {
    return `${sign}${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}${fraction}`;
  }

  return `${sign}${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}${fraction}`;
}

function chooseMajorStepSec(viewport: TimelineViewport, width: number | undefined): number {
  if (width == undefined || width <= 0) {
    return 0;
  }

  const minimumStep = (getVisibleDuration(viewport) / width) * MIN_MAJOR_TICK_SPACING_PX;
  const timeStep = TIME_STEP_SECONDS.find((step) => step >= minimumStep);
  if (timeStep != undefined) {
    return timeStep;
  }

  const magnitude = 10 ** Math.floor(Math.log10(minimumStep));
  const normalizedStep = minimumStep / magnitude;
  const multiplier = [1, 2, 5, 10].find((candidate) => candidate >= normalizedStep) ?? 10;
  return multiplier * magnitude;
}

function roundTickTime(value: number): number {
  return Number(value.toFixed(6));
}

function makeTicks(startSec: number, endSec: number, stepSec: number): Tick[] {
  if (stepSec <= 0 || endSec < startSec) {
    return [];
  }

  const ticks: Tick[] = [];
  const firstTick = Math.ceil((startSec - TICK_EPSILON) / stepSec) * stepSec;

  for (
    let timeSec = firstTick;
    timeSec <= endSec + TICK_EPSILON;
    timeSec = roundTickTime(timeSec + stepSec)
  ) {
    const roundedTimeSec = roundTickTime(timeSec);
    ticks.push({ key: roundedTimeSec.toFixed(6), timeSec: roundedTimeSec });
  }

  return ticks;
}

function makeMinorTicks(viewport: TimelineViewport, majorStepSec: number): Tick[] {
  const minorStepSec = majorStepSec / MINOR_TICKS_PER_MAJOR_INTERVAL;
  const ticks = makeTicks(viewport.visibleStartSec, viewport.visibleEndSec, minorStepSec);

  return ticks.filter((tick) => {
    const majorTickRatio = tick.timeSec / majorStepSec;
    return Math.abs(majorTickRatio - Math.round(majorTickRatio)) > TICK_EPSILON;
  });
}

function UnmemoizedProgressPlot(props: ProgressProps): React.JSX.Element {
  const { loading, viewport } = props;
  const availableRanges = useMessagePipeline(selectRanges);
  const { classes } = useStyles();
  const { width, ref } = useResizeDetector<HTMLDivElement>({
    handleHeight: false,
    refreshMode: "debounce",
    refreshRate: 0,
  });

  const clampedRanges = useMemo(() => {
    if (!availableRanges) {
      return undefined;
    }

    return availableRanges.map((range) => ({
      start: _.clamp(range.start, 0, 1),
      end: _.clamp(range.end, 0, 1),
    }));
  }, [availableRanges]);

  const ranges = useMemo(() => {
    if (!clampedRanges) {
      return <></>;
    }
    const mergedRanges = simplify(clampedRanges);

    return filterMap(mergedRanges, (range, idx) => {
      const totalDuration = viewport.totalEndSec - viewport.totalStartSec;
      const startSec = viewport.totalStartSec + range.start * totalDuration;
      const endSec = viewport.totalStartSec + range.end * totalDuration;
      const style = timelineRangeToStyle(startSec, endSec, viewport);
      if (style == undefined) {
        return;
      }

      return (
        <div
          className={classes.range}
          data-testid="timeline-progress-range"
          key={idx}
          style={style}
        />
      );
    });
  }, [clampedRanges, classes.range, viewport]);

  const majorStepSec = useMemo(() => chooseMajorStepSec(viewport, width), [viewport, width]);
  const majorTicks = useMemo(
    () => makeTicks(viewport.visibleStartSec, viewport.visibleEndSec, majorStepSec),
    [majorStepSec, viewport.visibleEndSec, viewport.visibleStartSec],
  );
  const minorTicks = useMemo(
    () => makeMinorTicks(viewport, majorStepSec),
    [majorStepSec, viewport],
  );

  return (
    <div ref={ref} className={classes.root} data-testid="timeline-progress-ruler">
      <div className={classes.progressBand}>
        {loading && (
          <div className={classes.loadingIndicator} data-testid="timeline-progress-loading" />
        )}
        {ranges}
      </div>
      {minorTicks.map((tick) => {
        const left = timelinePointToPercent(tick.timeSec, viewport);
        if (left == undefined) {
          return ReactNull;
        }

        return (
          <div
            className={classes.minorTick}
            data-testid="timeline-ruler-minor-tick"
            key={tick.key}
            style={{ left }}
          />
        );
      })}
      {majorTicks.map((tick) => {
        const left = timelinePointToPercent(tick.timeSec, viewport);
        if (left == undefined) {
          return ReactNull;
        }

        return (
          <div
            className={classes.majorTick}
            data-testid="timeline-ruler-major-tick"
            key={tick.key}
            style={{ left }}
          />
        );
      })}
      {majorTicks.map((tick) => {
        const left = timelinePointToPercent(tick.timeSec, viewport);
        if (left == undefined) {
          return ReactNull;
        }

        return (
          <div
            className={classes.tickLabel}
            data-testid="timeline-ruler-label"
            key={tick.key}
            style={{ left }}
          >
            {formatTickTime(tick.timeSec, majorStepSec)}
          </div>
        );
      })}
    </div>
  );
}

export const ProgressPlot = React.memo(UnmemoizedProgressPlot);
