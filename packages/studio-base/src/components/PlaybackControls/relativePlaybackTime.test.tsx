/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { TimeFormat } from "@foxglove/studio-base/components/AppSettingsDialog/settings";
import { DataSourceInfoView } from "@foxglove/studio-base/components/DataSourceInfoView";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import Timestamp from "@foxglove/studio-base/components/Timestamp";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import { usePlaybackTimeFormat } from "@foxglove/studio-base/hooks/usePlaybackTimeFormat";
import Stamp from "@foxglove/studio-base/panels/Log/Stamp";
import Metadata from "@foxglove/studio-base/panels/RawMessages/Metadata";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { PlaybackControlsTooltipContent } from "./PlaybackControlsTooltipContent";
import PlaybackTimeDisplay from "./PlaybackTimeDisplay";

const startTime = Object.freeze({ sec: 1_700_000_000, nsec: 500_000_000 });
const currentTime = Object.freeze({ sec: 1_700_000_014, nsec: 605_000_000 });

function LogStamp(): React.JSX.Element {
  const { timeFormat, timeZone, playbackOrigin } = usePlaybackTimeFormat();
  return (
    <output data-testid="log-time">
      <Stamp
        stamp={currentTime}
        timestampFormat={timeFormat}
        timeZone={timeZone}
        playbackOrigin={playbackOrigin}
      />
    </output>
  );
}

it("keeps settings, playback, file boundaries, log and raw-message metadata synchronized without changing raw data", async () => {
  await i18n.changeLanguage("en");
  const config = makeMockAppConfiguration([
    [AppSetting.TIME_FORMAT, "SEC"],
    [AppSetting.TIMEZONE, "UTC"],
  ]);
  const data = Object.freeze({ header: Object.freeze({ stamp: currentTime }) });
  const serialized = JSON.stringify(data);
  const onSeek = jest.fn();
  render(
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={config}>
        <MockMessagePipelineProvider
          startTime={startTime}
          currentTime={currentTime}
          endTime={{ sec: 1_700_000_314, nsec: 500_000_000 }}
        >
          <TimeFormat />
          <PlaybackTimeDisplay onSeek={onSeek} onPause={jest.fn()} />
          <div data-testid="file-start">
            <Timestamp time={startTime} />
          </div>
          <LogStamp />
          <Metadata
            data={data}
            diffData={undefined}
            diff={undefined}
            message={{
              topic: "/test",
              receiveTime: currentTime,
              message: data,
              sizeInBytes: 0,
              schemaName: "test",
            }}
          />
        </MockMessagePipelineProvider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByTestId("timeformat-relative"));
  await waitFor(() => {
    expect(config.get(AppSetting.TIME_FORMAT)).toBe("REL");
  });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Elapsed time" }).value).toBe(
    "00:00:14.105",
  );
  expect(screen.getByTestId("playback-total-duration").textContent).toBe("/ 00:05:14.000");
  expect(screen.getByTestId("file-start").textContent).toBe("00:00:00.000");
  expect(screen.getByTestId("log-time").textContent).toBe("00:00:14.105");
  expect(screen.getByText("@ 00:00:14.105", { exact: false })).toBeTruthy();
  expect(JSON.stringify(data)).toBe(serialized);
  expect(onSeek).not.toHaveBeenCalled();
  fireEvent.click(document.getElementById("playback-time-display-toggle-button")!);
  fireEvent.click(screen.getByRole("menuitem", { name: /Unix timestamp/ }));
  await waitFor(() => {
    expect(screen.getByTestId("timeformat-seconds").getAttribute("aria-pressed")).toBe("true");
  });
  expect(screen.getByTestId("log-time").textContent).toBe("1700000014.605000000");
  expect(screen.queryByTestId("playback-total-duration")).toBeNull();
  expect(JSON.stringify(data)).toBe(serialized);
});

it("shows original simulation timestamps in relative-mode tooltips across playback surfaces", async () => {
  await i18n.changeLanguage("en");
  const start = { sec: 100, nsec: 123456789 };
  const current = { sec: 114, nsec: 728456789 };
  const config = makeMockAppConfiguration([
    [AppSetting.TIME_FORMAT, "REL"],
    [AppSetting.TIMEZONE, "UTC"],
  ]);
  render(
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={config}>
        <EventsProvider>
          <TimelineInteractionStateProvider>
            <MockMessagePipelineProvider startTime={start} currentTime={current} endTime={current}>
              <div data-testid="sim-start">
                <Timestamp time={start} />
              </div>
              <div data-testid="custom-title">
                <Timestamp time={start} title="Custom title" />
              </div>
              <div data-testid="sim-info">
                <DataSourceInfoView />
              </div>
              <div data-testid="sim-hover">
                <PlaybackControlsTooltipContent stamp={current} />
              </div>
              <PlaybackTimeDisplay onSeek={jest.fn()} onPause={jest.fn()} />
            </MockMessagePipelineProvider>
          </TimelineInteractionStateProvider>
        </EventsProvider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>,
  );
  expect(screen.getByTestId("sim-start").querySelector("[title]")?.getAttribute("title")).toBe(
    "100.123456789",
  );
  expect(screen.getByTestId("custom-title").querySelector("[title]")?.getAttribute("title")).toBe(
    "Custom title",
  );
  expect(screen.getByTestId("sim-info").querySelector('[title="114.728456789"]')).not.toBeNull();
  expect(within(screen.getByTestId("sim-hover")).getByText("114.728456789")).toBeTruthy();
  expect(within(screen.getByTestId("sim-hover")).getByText("00:00:14.605")).toBeTruthy();
  fireEvent.mouseOver(screen.getByRole("textbox", { name: "Elapsed time" }));
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", "114.728456789");
  expect(screen.queryByText(/1970-/)).toBeNull();
});
