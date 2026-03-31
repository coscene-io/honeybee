/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import PlaybackControls from ".";

jest.mock("./PlaybackTimeDisplay", () => ({
  __esModule: true,
  default: function MockPlaybackTimeDisplay() {
    return <div data-testid="playback-time-display" />;
  },
}));
jest.mock("./Scrubber", () => ({
  __esModule: true,
  default: function MockScrubber() {
    return <div data-testid="scrubber" />;
  },
}));
jest.mock("./SeekStepControls", () => ({
  __esModule: true,
  default: function MockSeekStepControls() {
    return <div data-testid="seek-step-controls" />;
  },
  MIN_SEEK_STEP_MS: 1,
  MAX_SEEK_STEP_MS: 60 * 60 * 1000,
}));

function SpeedObserver(): React.JSX.Element {
  const speed = useWorkspaceStore((store) => store.playbackControls.speed);
  return <div data-testid="playback-speed">{speed}</div>;
}

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider
          value={
            {
              createEvent: {
                permission: () => false,
              },
            } as never
          }
        >
          <CoreDataProvider>
            <WorkspaceContextProvider
              disablePersistenceForStorybook
              initialState={{ playbackControls: { repeat: false, speed: 1 } }}
            >
              <MockMessagePipelineProvider>
                {children}
                <SpeedObserver />
              </MockMessagePipelineProvider>
            </WorkspaceContextProvider>
          </CoreDataProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("<PlaybackControls />", () => {
  it("adjusts playback speed with keyboard shortcuts", () => {
    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={jest.fn()}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );

    expect(screen.getByTestId("playback-speed").textContent).toBe("1");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          key: "+",
          shiftKey: true,
        }),
      );
    });

    expect(screen.getByTestId("playback-speed").textContent).toBe("2");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Minus",
          key: "-",
        }),
      );
    });

    expect(screen.getByTestId("playback-speed").textContent).toBe("1");
  });

  it("ignores playback speed shortcuts when ctrl or cmd is pressed", () => {
    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          getTimeInfo={() => ({})}
          play={jest.fn()}
          pause={jest.fn()}
          seek={jest.fn()}
          enableRepeatPlayback={jest.fn()}
        />
      </Wrapper>,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          ctrlKey: true,
          key: "=",
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Equal",
          key: "=",
          metaKey: true,
        }),
      );
    });

    expect(screen.getByTestId("playback-speed").textContent).toBe("1");
  });
});
