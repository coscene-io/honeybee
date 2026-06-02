/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import Scrubber from "./Scrubber";

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider value={{} as never}>
          <CoreDataProvider>
            <WorkspaceContextProvider disablePersistenceForStorybook>
              <MockMessagePipelineProvider
                startTime={{ sec: 0, nsec: 0 }}
                endTime={{ sec: 10, nsec: 0 }}
                currentTime={{ sec: 1, nsec: 0 }}
              >
                <TimelineInteractionStateProvider>
                  <CoScenePlaylistProvider>
                    <EventsProvider>{children}</EventsProvider>
                  </CoScenePlaylistProvider>
                </TimelineInteractionStateProvider>
              </MockMessagePipelineProvider>
            </WorkspaceContextProvider>
          </CoreDataProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("<Scrubber />", () => {
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
});
