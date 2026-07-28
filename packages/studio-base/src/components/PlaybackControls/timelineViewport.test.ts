// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  clientXToTime,
  getTimelineViewportZoomPercent,
  getViewportScrollMetrics,
  makeTimelineViewport,
  panViewportBySeconds,
  setTimelineViewportZoomPercentAtTime,
  setViewportVisibleStartSec,
  timeToFraction,
  timelineRangeToStyle,
  zoomViewportAtTime,
} from "./timelineViewport";

describe("timelineViewport", () => {
  it("maps times through the visible window", () => {
    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 40,
      visibleEndSec: 60,
    };

    expect(timeToFraction(50, viewport)).toBe(0.5);
    expect(clientXToTime(150, { left: 100, right: 300, width: 200 }, viewport)).toBe(45);
  });

  it("zooms around the anchor time", () => {
    const viewport = makeTimelineViewport(0, 100);
    const nextViewport = zoomViewportAtTime(viewport, 25, -200);

    expect(nextViewport.visibleEndSec - nextViewport.visibleStartSec).toBeLessThan(100);
    expect(timeToFraction(25, nextViewport)).toBeCloseTo(0.25);
  });

  it("reports zoom progress from the visible duration", () => {
    expect(getTimelineViewportZoomPercent(makeTimelineViewport(0, 100))).toBe(0);

    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 49.95,
      visibleEndSec: 50.05,
    };

    expect(getTimelineViewportZoomPercent(viewport)).toBeCloseTo(100);
  });

  it("sets zoom progress around the anchor time", () => {
    const viewport = makeTimelineViewport(0, 100);
    const nextViewport = setTimelineViewportZoomPercentAtTime(viewport, 25, 50);

    expect(nextViewport.visibleEndSec - nextViewport.visibleStartSec).toBeLessThan(100);
    expect(nextViewport.visibleEndSec - nextViewport.visibleStartSec).toBeGreaterThan(0.1);
    expect(timeToFraction(25, nextViewport)).toBeCloseTo(0.5);
    expect(getTimelineViewportZoomPercent(nextViewport)).toBeCloseTo(50);
  });

  it("clamps zoom progress around the total bounds", () => {
    const viewport = makeTimelineViewport(0, 100);
    const nextViewport = setTimelineViewportZoomPercentAtTime(viewport, 1, 50);

    expect(nextViewport.visibleStartSec).toBe(0);
    expect(nextViewport.visibleEndSec).toBeLessThan(100);
  });

  it("clamps panning to total bounds", () => {
    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 20,
      visibleEndSec: 40,
    };

    expect(panViewportBySeconds(viewport, -100)).toEqual({
      totalStartSec: 0,
      totalEndSec: 100,
      visibleStartSec: 0,
      visibleEndSec: 20,
    });
  });

  it("moves the visible window start while preserving its duration", () => {
    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 20,
      visibleEndSec: 40,
    };

    expect(setViewportVisibleStartSec(viewport, 50)).toEqual({
      totalStartSec: 0,
      totalEndSec: 100,
      visibleStartSec: 50,
      visibleEndSec: 70,
    });
  });

  it("clamps the visible window start to the total bounds", () => {
    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 20,
      visibleEndSec: 40,
    };

    expect(setViewportVisibleStartSec(viewport, 90)).toEqual({
      totalStartSec: 0,
      totalEndSec: 100,
      visibleStartSec: 80,
      visibleEndSec: 100,
    });
    expect(setViewportVisibleStartSec(viewport, -10)).toEqual({
      totalStartSec: 0,
      totalEndSec: 100,
      visibleStartSec: 0,
      visibleEndSec: 20,
    });
  });

  it("reports scrollbar thumb position and size from the visible window", () => {
    expect(getViewportScrollMetrics(makeTimelineViewport(0, 100))).toEqual({
      thumbStartFraction: 0,
      thumbSizeFraction: 1,
    });

    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 20,
      visibleEndSec: 40,
    };
    expect(getViewportScrollMetrics(viewport)).toEqual({
      thumbStartFraction: 0.2,
      thumbSizeFraction: 0.2,
    });
  });

  it("clamps the scrollbar thumb within the track at the end of the range", () => {
    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 80,
      visibleEndSec: 100,
    };

    const { thumbStartFraction, thumbSizeFraction } = getViewportScrollMetrics(viewport);
    expect(thumbSizeFraction).toBeCloseTo(0.2);
    expect(thumbStartFraction).toBeCloseTo(0.8);
    expect(thumbStartFraction + thumbSizeFraction).toBeLessThanOrEqual(1);
  });

  it("clips ranges to the visible window", () => {
    const viewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 20,
      visibleEndSec: 40,
    };

    expect(timelineRangeToStyle(10, 30, viewport)).toEqual({
      left: "calc(0% - 1px)",
      right: "calc(100% - 50% - 1px)",
    });
    expect(timelineRangeToStyle(50, 60, viewport)).toBeUndefined();
  });
});
