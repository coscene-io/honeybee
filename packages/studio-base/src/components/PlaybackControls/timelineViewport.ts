// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

export type TimelineViewport = {
  totalStartSec: number;
  totalEndSec: number;
  visibleStartSec: number;
  visibleEndSec: number;
};

export type TimelineClientRect = Pick<DOMRect, "left" | "right" | "width">;

const MIN_VISIBLE_DURATION_SEC = 0.1;
const MAX_ZOOM_WHEEL_DELTA = 600;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export function makeTimelineViewport(totalStartSec: number, totalEndSec: number): TimelineViewport {
  return {
    totalStartSec,
    totalEndSec,
    visibleStartSec: totalStartSec,
    visibleEndSec: totalEndSec,
  };
}

export function getVisibleDuration(viewport: TimelineViewport): number {
  return Math.max(viewport.visibleEndSec - viewport.visibleStartSec, MIN_VISIBLE_DURATION_SEC);
}

export function isViewportZoomed(viewport: TimelineViewport): boolean {
  return (
    viewport.visibleStartSec > viewport.totalStartSec ||
    viewport.visibleEndSec < viewport.totalEndSec
  );
}

export function getTimelineViewportZoomPercent(viewport: TimelineViewport): number {
  const totalDuration = viewport.totalEndSec - viewport.totalStartSec;
  if (totalDuration <= 0) {
    return 0;
  }

  const minDuration = Math.min(MIN_VISIBLE_DURATION_SEC, totalDuration);
  if (totalDuration <= minDuration) {
    return 0;
  }

  const visibleDuration = _.clamp(getVisibleDuration(viewport), minDuration, totalDuration);
  const logRange = Math.log(totalDuration) - Math.log(minDuration);

  return _.clamp(((Math.log(totalDuration) - Math.log(visibleDuration)) / logRange) * 100, 0, 100);
}

export function clampTimelineViewport(viewport: TimelineViewport): TimelineViewport {
  const totalDuration = viewport.totalEndSec - viewport.totalStartSec;
  if (totalDuration <= 0) {
    return makeTimelineViewport(viewport.totalStartSec, viewport.totalEndSec);
  }

  const maxDuration = totalDuration;
  const minDuration = Math.min(MIN_VISIBLE_DURATION_SEC, maxDuration);
  const duration = _.clamp(
    viewport.visibleEndSec - viewport.visibleStartSec,
    minDuration,
    maxDuration,
  );

  let visibleStartSec = viewport.visibleStartSec;
  let visibleEndSec = visibleStartSec + duration;

  if (visibleStartSec < viewport.totalStartSec) {
    visibleStartSec = viewport.totalStartSec;
    visibleEndSec = visibleStartSec + duration;
  }
  if (visibleEndSec > viewport.totalEndSec) {
    visibleEndSec = viewport.totalEndSec;
    visibleStartSec = visibleEndSec - duration;
  }

  return {
    totalStartSec: viewport.totalStartSec,
    totalEndSec: viewport.totalEndSec,
    visibleStartSec,
    visibleEndSec,
  };
}

export function timeToFraction(timeSec: number, viewport: TimelineViewport): number {
  return (timeSec - viewport.visibleStartSec) / getVisibleDuration(viewport);
}

export function fractionToTime(fraction: number, viewport: TimelineViewport): number {
  return viewport.visibleStartSec + fraction * getVisibleDuration(viewport);
}

export function clientXToFraction(clientX: number, rect: TimelineClientRect): number {
  if (rect.width <= 0) {
    return 0;
  }

  return _.clamp((clientX - rect.left) / rect.width, 0, 1);
}

export function clientXToTime(
  clientX: number,
  rect: TimelineClientRect,
  viewport: TimelineViewport,
): number {
  return fractionToTime(clientXToFraction(clientX, rect), viewport);
}

export function timelineRangeToStyle(
  startSec: number,
  endSec: number,
  viewport: TimelineViewport,
): undefined | { left: string; right: string } {
  const leftFraction = _.clamp(timeToFraction(startSec, viewport), 0, 1);
  const rightFraction = _.clamp(timeToFraction(endSec, viewport), 0, 1);

  if (rightFraction <= 0 || leftFraction >= 1 || rightFraction <= leftFraction) {
    return undefined;
  }

  return {
    left: `calc(${leftFraction * 100}% - 1px)`,
    right: `calc(100% - ${rightFraction * 100}% - 1px)`,
  };
}

export function timelinePointToPercent(
  timeSec: number,
  viewport: TimelineViewport,
): string | undefined {
  const fraction = timeToFraction(timeSec, viewport);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    return undefined;
  }

  return `${fraction * 100}%`;
}

export function zoomViewportAtTime(
  viewport: TimelineViewport,
  anchorSec: number,
  wheelDeltaY: number,
): TimelineViewport {
  const totalDuration = viewport.totalEndSec - viewport.totalStartSec;
  if (totalDuration <= 0) {
    return viewport;
  }

  const clampedDelta = _.clamp(wheelDeltaY, -MAX_ZOOM_WHEEL_DELTA, MAX_ZOOM_WHEEL_DELTA);
  const zoomFactor = Math.exp(clampedDelta * WHEEL_ZOOM_SENSITIVITY);
  const oldDuration = getVisibleDuration(viewport);
  const nextDuration = _.clamp(
    oldDuration * zoomFactor,
    Math.min(MIN_VISIBLE_DURATION_SEC, totalDuration),
    totalDuration,
  );
  const anchorOffsetRatio = (anchorSec - viewport.visibleStartSec) / oldDuration;
  const visibleStartSec = anchorSec - anchorOffsetRatio * nextDuration;

  return clampTimelineViewport({
    ...viewport,
    visibleStartSec,
    visibleEndSec: visibleStartSec + nextDuration,
  });
}

export function setTimelineViewportZoomPercentAtTime(
  viewport: TimelineViewport,
  anchorSec: number,
  zoomPercent: number,
): TimelineViewport {
  const totalDuration = viewport.totalEndSec - viewport.totalStartSec;
  if (totalDuration <= 0) {
    return viewport;
  }

  const minDuration = Math.min(MIN_VISIBLE_DURATION_SEC, totalDuration);
  if (totalDuration <= minDuration) {
    return makeTimelineViewport(viewport.totalStartSec, viewport.totalEndSec);
  }

  const zoomRatio = _.clamp(zoomPercent, 0, 100) / 100;
  const nextDuration = Math.exp(
    Math.log(totalDuration) - zoomRatio * (Math.log(totalDuration) - Math.log(minDuration)),
  );
  const visibleStartSec = anchorSec - nextDuration / 2;

  return clampTimelineViewport({
    ...viewport,
    visibleStartSec,
    visibleEndSec: visibleStartSec + nextDuration,
  });
}

export function panViewportBySeconds(
  viewport: TimelineViewport,
  deltaSec: number,
): TimelineViewport {
  return clampTimelineViewport({
    ...viewport,
    visibleStartSec: viewport.visibleStartSec + deltaSec,
    visibleEndSec: viewport.visibleEndSec + deltaSec,
  });
}

export function viewportEquals(left: TimelineViewport, right: TimelineViewport): boolean {
  return (
    left.totalStartSec === right.totalStartSec &&
    left.totalEndSec === right.totalEndSec &&
    left.visibleStartSec === right.visibleStartSec &&
    left.visibleEndSec === right.visibleEndSec
  );
}
