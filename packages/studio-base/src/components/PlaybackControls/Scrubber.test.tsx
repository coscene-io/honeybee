/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import { useEffect } from "react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { type CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlaybackInteractionState } from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import Scrubber from "./Scrubber";

jest.mock("./EventsOverlay", () => ({
  EventsOverlay: function MockEventsOverlay(): React.JSX.Element {
    return <div data-testid="events-overlay" />;
  },
}));

jest.mock("./PlaybackBarHoverTicks", () => ({
  PlaybackBarHoverTicks: function MockPlaybackBarHoverTicks(): React.JSX.Element {
    return <div data-testid="playback-bar-hover-ticks" />;
  },
}));

jest.mock("./ProgressPlot", () => ({
  ProgressPlot: function MockProgressPlot({ loading }: { loading: boolean }): React.JSX.Element {
    return <div data-testid={loading ? "timeline-progress-loading" : "progress-plot"} />;
  },
}));

jest.mock("./Slider", () => ({
  __esModule: true,
  default: function MockSlider({ disabled }: { disabled?: boolean }): React.JSX.Element {
    return <div data-testid="scrubber-slider" data-disabled={String(disabled)} />;
  },
}));

function SeedEventFeature({ enabled }: { enabled: boolean }): ReactNull {
  const setDataSource = useCoreData((store: CoreDataStore) => store.setDataSource);

  useEffect(() => {
    setDataSource(enabled ? { id: "coscene-data-platform", type: "connection" } : undefined);
  }, [enabled, setDataSource]);

  return ReactNull;
}

function MomentSubtitleStateProbe(): React.JSX.Element {
  const enabled = useWorkspaceStore(
    (store) =>
      (
        store.playbackControls as {
          momentSubtitle?: { enabled: boolean };
        }
      ).momentSubtitle?.enabled,
  );
  return <div data-testid="moment-subtitle-enabled">{String(enabled)}</div>;
}

function KeyframeSearchLock(): ReactNull {
  const acquireKeyframeSearchLock = usePlaybackInteractionState(
    (store) => store.acquireKeyframeSearchLock,
  );

  useEffect(() => {
    return acquireKeyframeSearchLock({ isPlaying: false });
  }, [acquireKeyframeSearchLock]);

  return ReactNull;
}

function Wrapper({
  children,
  eventEnabled = false,
}: React.PropsWithChildren<{ eventEnabled?: boolean }>): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider
          value={
            {
              createEvent: { permission: () => false },
              updateEvent: { permission: () => false },
            } as never
          }
        >
          <CoreDataProvider>
            <WorkspaceContextProvider disablePersistence>
              <MockMessagePipelineProvider
                startTime={{ sec: 0, nsec: 0 }}
                endTime={{ sec: 10, nsec: 0 }}
                currentTime={{ sec: 1, nsec: 0 }}
              >
                <PlaybackInteractionStateProvider>
                  <TimelineInteractionStateProvider>
                    <CoScenePlaylistProvider>
                      <EventsProvider>
                        <SeedEventFeature enabled={eventEnabled} />
                        {children}
                        <MomentSubtitleStateProbe />
                      </EventsProvider>
                    </CoScenePlaylistProvider>
                  </TimelineInteractionStateProvider>
                </PlaybackInteractionStateProvider>
              </MockMessagePipelineProvider>
            </WorkspaceContextProvider>
          </CoreDataProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("<Scrubber />", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("keeps the first moment lane at least 4px below the bag file bar", () => {
    render(
      <Wrapper>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const eventLaneLayerTop = Number.parseFloat(
      getComputedStyle(screen.getByTestId("event-lane-layer")).top,
    );

    expect(eventLaneLayerTop).toBeGreaterThanOrEqual(28);
  });

  it("shows timeline loading while keyframe search is active", () => {
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(screen.getByTestId("timeline-progress-loading")).toBeTruthy();
  });

  it("disables the timeline slider while keyframe search is active", () => {
    render(
      <Wrapper>
        <KeyframeSearchLock />
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(screen.getByTestId("scrubber-slider").dataset.disabled).toBe("true");
  });

  it("renders and toggles the moment subtitle button when events are enabled", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    const subtitleButton = await screen.findByLabelText("Enable moment subtitles");

    expect(within(subtitleButton).getByTestId("moment-subtitle-icon-inactive")).toBeTruthy();
    expect(within(subtitleButton).queryByTestId("moment-subtitle-icon-active")).toBeNull();
    expect(screen.getByTestId("moment-subtitle-enabled").textContent).toBe("false");

    fireEvent.click(subtitleButton);

    expect(screen.getByTestId("moment-subtitle-enabled").textContent).toBe("true");
    expect(screen.getByLabelText("Disable moment subtitles")).toBeTruthy();
    expect(within(subtitleButton).getByTestId("moment-subtitle-icon-active")).toBeTruthy();
    expect(within(subtitleButton).queryByTestId("moment-subtitle-icon-inactive")).toBeNull();
  });

  it("shows the moment subtitle toggle without event write permission", async () => {
    render(
      <Wrapper eventEnabled>
        <Scrubber onSeek={jest.fn()} />
      </Wrapper>,
    );

    expect(await screen.findByLabelText("Enable moment subtitles")).toBeTruthy();
    expect(screen.queryByLabelText("Enable linked event adjustment")).toBeNull();
    expect(screen.queryByLabelText("Disable linked event adjustment")).toBeNull();
  });
});
