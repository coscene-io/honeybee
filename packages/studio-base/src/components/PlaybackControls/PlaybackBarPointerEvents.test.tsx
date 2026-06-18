/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";
import { useEffect } from "react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import { useSetHoverValue } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { BagsOverlay } from "./BagsOverlay";
import { PlaybackBarHoverTicks } from "./PlaybackBarHoverTicks";
import { ProgressPlot } from "./ProgressPlot";
import { makeTimelineViewport } from "./timelineViewport";

const viewport = makeTimelineViewport(0, 10);
let mockResizeDetectorWidth: number | undefined = 200;

jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({
    width: mockResizeDetectorWidth,
    ref: jest.fn(),
  }),
}));

function SeedHoverValue({ value = 5 }: { value?: number }): ReactNull {
  const setHoverValue = useSetHoverValue();

  useEffect(() => {
    setHoverValue({ componentId: "other-component", type: "PLAYBACK_SECONDS", value });
  }, [setHoverValue, value]);

  return ReactNull;
}

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <MockMessagePipelineProvider
          startTime={{ sec: 0, nsec: 0 }}
          endTime={{ sec: 10, nsec: 0 }}
          progress={{ fullyLoadedFractionRanges: [{ start: 0.25, end: 0.5 }] }}
        >
          <TimelineInteractionStateProvider>
            <CoScenePlaylistProvider>{children}</CoScenePlaylistProvider>
          </TimelineInteractionStateProvider>
        </MockMessagePipelineProvider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("Playback bar pointer events", () => {
  beforeEach(() => {
    mockResizeDetectorWidth = 200;
  });

  it("keeps progress plot visual layers out of hit testing", () => {
    const { container } = render(
      <Wrapper>
        <ProgressPlot loading viewport={viewport} />
      </Wrapper>,
    );

    const progressRoot = container.firstElementChild;
    const loadingIndicator = container.querySelector('[class*="ProgressPlot-loadingIndicator"]');
    const range = container.querySelector('[class*="ProgressPlot-range"]');

    expect(progressRoot).not.toBeNull();
    expect(loadingIndicator).not.toBeNull();
    expect(range).not.toBeNull();
    expect(getComputedStyle(progressRoot!).pointerEvents).toBe("none");
    expect(getComputedStyle(loadingIndicator!).pointerEvents).toBe("none");
    expect(getComputedStyle(range!).pointerEvents).toBe("none");
  });

  it("keeps bags overlay out of hit testing", () => {
    const { container } = render(
      <Wrapper>
        <BagsOverlay viewport={viewport} />
      </Wrapper>,
    );

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(getComputedStyle(root!).pointerEvents).toBe("none");
  });

  it("keeps playback hover ticks out of hit testing", () => {
    const { container } = render(
      <Wrapper>
        <PlaybackBarHoverTicks componentId="test-component" viewport={viewport} />
      </Wrapper>,
    );

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(getComputedStyle(root!).pointerEvents).toBe("none");
  });

  it("shows an inline hover time label for external playback hover values", () => {
    render(
      <Wrapper>
        <SeedHoverValue />
        <PlaybackBarHoverTicks componentId="test-component" viewport={viewport} />
      </Wrapper>,
    );

    expect(screen.getByTestId("playback-hover-time-indicator")).toBeTruthy();
    expect(screen.getByTestId("playback-hover-time-label")).toBeTruthy();
  });

  it("clamps the external hover time label inside the timeline edges", () => {
    const getBoundingClientRect = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRectMock(this: HTMLElement) {
        if (this.dataset.testid === "playback-hover-time-label") {
          return {
            bottom: 20,
            height: 20,
            left: 0,
            right: 80,
            top: 0,
            width: 80,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        }

        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    try {
      const { rerender } = render(
        <Wrapper>
          <SeedHoverValue value={0} />
          <PlaybackBarHoverTicks componentId="test-component" viewport={viewport} />
        </Wrapper>,
      );

      expect(screen.getByTestId("playback-hover-time-label").style.transform).toBe(
        "translateX(0px)",
      );

      rerender(
        <Wrapper>
          <SeedHoverValue value={10} />
          <PlaybackBarHoverTicks componentId="test-component" viewport={viewport} />
        </Wrapper>,
      );

      expect(screen.getByTestId("playback-hover-time-label").style.transform).toBe(
        "translateX(-80px)",
      );
    } finally {
      getBoundingClientRect.mockRestore();
    }
  });
});
