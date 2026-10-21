/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { ProgressPlot } from "./ProgressPlot";
import { type TimelineViewport, makeTimelineViewport } from "./timelineViewport";

let mockResizeWidth = 1348;

jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: mockResizeWidth, ref: jest.fn() }),
}));

function renderProgressPlot({
  loading = false,
  progressRanges,
  viewport,
}: {
  loading?: boolean;
  progressRanges?: { start: number; end: number }[];
  viewport: TimelineViewport;
}): void {
  render(
    <ThemeProvider isDark>
      <MockMessagePipelineProvider
        progress={{ fullyLoadedFractionRanges: progressRanges }}
        startTime={{ sec: 100, nsec: 0 }}
        currentTime={{ sec: 100, nsec: 0 }}
        endTime={{ sec: 122, nsec: 0 }}
      >
        <ProgressPlot loading={loading} viewport={viewport} />
      </MockMessagePipelineProvider>
    </ThemeProvider>,
  );
}

describe("ProgressPlot", () => {
  beforeEach(() => {
    mockResizeWidth = 1348;
  });

  it("renders Figma-style two second ruler labels at the default zoom", () => {
    renderProgressPlot({ viewport: makeTimelineViewport(0, 22) });

    expect(screen.getByTestId("timeline-progress-ruler")).not.toBeNull();
    expect(screen.getByText("00:00")).not.toBeNull();
    expect(screen.getByText("00:02")).not.toBeNull();
    expect(screen.getByText("00:22")).not.toBeNull();
    expect(screen.getAllByTestId("timeline-ruler-major-tick")).toHaveLength(12);
    expect(screen.getAllByTestId("timeline-ruler-minor-tick").length).toBeGreaterThan(0);
  });

  it("uses finer tick labels when the viewport is zoomed in", () => {
    renderProgressPlot({
      viewport: {
        totalStartSec: 0,
        totalEndSec: 22,
        visibleStartSec: 4,
        visibleEndSec: 6,
      },
    });

    expect(screen.getByText("00:04.0")).not.toBeNull();
    expect(screen.getByText("00:04.2")).not.toBeNull();
    expect(screen.getByText("00:05.0")).not.toBeNull();
    expect(screen.queryByText("00:02")).toBeNull();
  });

  it("uses coarser tick labels when the viewport is zoomed out", () => {
    renderProgressPlot({ viewport: makeTimelineViewport(0, 600) });

    expect(screen.getByText("00:00")).not.toBeNull();
    expect(screen.getByText("01:00")).not.toBeNull();
    expect(screen.getByText("10:00")).not.toBeNull();
    expect(screen.queryByText("00:02")).toBeNull();
  });

  it("renders cached progress ranges clipped to the visible viewport", () => {
    renderProgressPlot({
      progressRanges: [{ start: 0.2, end: 0.5 }],
      viewport: {
        totalStartSec: 0,
        totalEndSec: 100,
        visibleStartSec: 25,
        visibleEndSec: 75,
      },
    });

    const range = screen.getByTestId("timeline-progress-range");
    expect(range.style.left).toBe("calc(0% - 1px)");
    expect(range.style.right).toBe("calc(50% - 1px)");
  });

  it("places the progress band below the timeline ruler", () => {
    renderProgressPlot({ viewport: makeTimelineViewport(0, 22) });

    const ruler = screen.getByTestId("timeline-ruler");
    const progressBand = screen.getByTestId("timeline-progress-band");

    expect(getComputedStyle(ruler).flexBasis).toBe("16px");
    expect(ruler.nextElementSibling).toBe(progressBand);
    expect(getComputedStyle(progressBand).flexBasis).toBe("4px");
  });

  it("keeps both major and minor ticks below the label line boxes", () => {
    renderProgressPlot({ viewport: makeTimelineViewport(0, 22) });
    const rulerStyle = getComputedStyle(screen.getByTestId("timeline-ruler"));
    const contentHeight =
      Number.parseFloat(rulerStyle.flexBasis) - Number.parseFloat(rulerStyle.borderBottomWidth);
    const labelBottom = Math.max(
      ...screen.getAllByTestId("timeline-ruler-label").map((label) => {
        const style = getComputedStyle(label);
        return Number.parseFloat(style.top) + Number.parseFloat(style.lineHeight);
      }),
    );
    for (const tick of [
      ...screen.getAllByTestId("timeline-ruler-major-tick"),
      ...screen.getAllByTestId("timeline-ruler-minor-tick"),
    ]) {
      const style = getComputedStyle(tick);
      const top = Number.parseFloat(style.top);
      const tickTop = Number.isFinite(top)
        ? top
        : contentHeight - Number.parseFloat(style.bottom) - Number.parseFloat(style.height);
      expect(tickTop).toBeGreaterThanOrEqual(labelBottom);
      expect(tickTop + Number.parseFloat(style.height)).toBeLessThanOrEqual(contentHeight);
    }
  });

  it("keeps ruler labels visible while loading", () => {
    renderProgressPlot({ loading: true, viewport: makeTimelineViewport(0, 22) });

    expect(screen.getByTestId("timeline-progress-loading")).not.toBeNull();
    expect(screen.getByText("00:00")).not.toBeNull();
    expect(screen.getByText("00:02")).not.toBeNull();
  });
});
