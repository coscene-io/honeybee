/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";

import { fromSec } from "@foxglove/rostime";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import PlaybackControls from "./index";

jest.mock(
  "./PlaybackTimeDisplay",
  () =>
    function MockPlaybackTimeDisplay() {
      return <></>;
    },
);
jest.mock(
  "./Scrubber",
  () =>
    function MockScrubber() {
      return <></>;
    },
);
jest.mock(
  "@foxglove/studio-base/components/PlaybackSpeedControls",
  () =>
    function MockPlaybackSpeedControls() {
      return <></>;
    },
);
jest.mock("./SeekStepControls", () => ({
  __esModule: true,
  MIN_SEEK_STEP_MS: 1e-6 * 1000,
  MAX_SEEK_STEP_MS: 3600 * 1000,
  default: function MockSeekStepControls() {
    return <></>;
  },
}));

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  const mockConsoleApi = {
    createEvent: {
      permission: () => false,
    },
  };

  return (
    <CoSceneConsoleApiContext.Provider value={mockConsoleApi as never}>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoreDataProvider>
          <WorkspaceContextProvider>
            <MockMessagePipelineProvider>
              <ThemeProvider isDark>{children}</ThemeProvider>
            </MockMessagePipelineProvider>
          </WorkspaceContextProvider>
        </CoreDataProvider>
      </AppConfigurationContext.Provider>
    </CoSceneConsoleApiContext.Provider>
  );
}

describe("<PlaybackControls />", () => {
  it("supports legacy Windows right key names for seek forward", () => {
    const seek = jest.fn();

    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          play={jest.fn()}
          pause={jest.fn()}
          seek={seek}
          enableRepeatPlayback={jest.fn()}
          getTimeInfo={() => ({
            startTime: fromSec(0),
            currentTime: fromSec(1),
            endTime: fromSec(2),
          })}
        />
      </Wrapper>,
    );

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        code: "",
        key: "Right",
      }),
    );

    expect(seek).toHaveBeenCalledWith(fromSec(1.1));
  });

  it("supports legacy Windows left key names for seek backward", () => {
    const seek = jest.fn();

    render(
      <Wrapper>
        <PlaybackControls
          isPlaying={false}
          repeatEnabled={false}
          play={jest.fn()}
          pause={jest.fn()}
          seek={seek}
          enableRepeatPlayback={jest.fn()}
          getTimeInfo={() => ({
            startTime: fromSec(0),
            currentTime: fromSec(1),
            endTime: fromSec(2),
          })}
        />
      </Wrapper>,
    );

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        code: "",
        key: "Left",
      }),
    );

    expect(seek).toHaveBeenCalledWith(fromSec(0.9));
  });
});
