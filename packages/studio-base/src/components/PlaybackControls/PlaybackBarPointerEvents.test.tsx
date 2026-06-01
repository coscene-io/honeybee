/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { BagsOverlay } from "./BagsOverlay";
import { PlaybackBarHoverTicks } from "./PlaybackBarHoverTicks";
import { ProgressPlot } from "./ProgressPlot";
import { makeTimelineViewport } from "./timelineViewport";

const viewport = makeTimelineViewport(0, 10);

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
        <BagsOverlay />
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
});
