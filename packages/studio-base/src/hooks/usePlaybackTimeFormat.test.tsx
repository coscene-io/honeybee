/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook } from "@testing-library/react";
import { type PropsWithChildren } from "react";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { useAppTimeFormat } from "./useAppTimeFormat";
import { usePlaybackTimeFormat } from "./usePlaybackTimeFormat";

it("synchronizes the global choice across consumers and keeps one origin as playback advances", async () => {
  const config = makeMockAppConfiguration([
    [AppSetting.TIME_FORMAT, "REL"],
    [AppSetting.TIMEZONE, "UTC"],
  ]);
  let current = 105;
  let start = 100;
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppConfigurationContext.Provider value={config}>
      <MockMessagePipelineProvider
        startTime={{ sec: start, nsec: 500_000_000 }}
        currentTime={{ sec: current, nsec: 0 }}
        endTime={{ sec: 200, nsec: 0 }}
      >
        {children}
      </MockMessagePipelineProvider>
    </AppConfigurationContext.Provider>
  );
  const { result, rerender } = renderHook(
    () => ({ first: usePlaybackTimeFormat(), second: usePlaybackTimeFormat() }),
    { wrapper },
  );
  const stamp = { sec: 114, nsec: 605_000_000 };
  const formatter = result.current.first.formatTime;
  expect(formatter(stamp)).toBe("00:00:14.105");
  expect(result.current.second.formatTime(stamp)).toBe("00:00:14.105");
  expect(result.current.first.formatDate(stamp)).toBe("");
  expect(result.current.first.formatDuration({ sec: 14, nsec: 605_000_000 })).toBe("00:00:14.605");
  current = 150;
  rerender();
  expect(result.current.first.formatTime).toBe(formatter);
  start = 110;
  rerender();
  expect(result.current.first.formatTime(stamp)).toBe("00:00:04.105");
  await act(async () => {
    await result.current.first.setTimeFormat("SEC");
  });
  expect(result.current.second.timeFormat).toBe("SEC");
  expect(result.current.second.formatTime(stamp)).toBe("114.605000000");
  await act(async () => {
    await result.current.second.setTimeFormat("TOD");
  });
  expect(result.current.first.timeFormat).toBe("TOD");
  expect(result.current.first.formatTime(stamp)).toBe("12:01:54.605 AM UTC");
});

it("allows global settings outside playback and uses a placeholder when there is no origin", () => {
  const config = makeMockAppConfiguration([[AppSetting.TIME_FORMAT, "REL"]]);
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppConfigurationContext.Provider value={config}>{children}</AppConfigurationContext.Provider>
  );
  const { result } = renderHook(() => useAppTimeFormat(), { wrapper });
  expect(result.current.timeFormat).toBe("REL");
  expect(result.current.formatTime({ sec: 100, nsec: 0 })).toBe("—");
});

it("retains the default date/time mode for unknown stored settings", () => {
  const config = makeMockAppConfiguration([[AppSetting.TIME_FORMAT, "unknown"]]);
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppConfigurationContext.Provider value={config}>{children}</AppConfigurationContext.Provider>
  );
  const { result } = renderHook(() => useAppTimeFormat(), { wrapper });
  expect(result.current.timeFormat).toBe("TOD");
});
