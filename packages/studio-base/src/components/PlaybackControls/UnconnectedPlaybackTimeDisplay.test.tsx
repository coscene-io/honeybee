/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";

import type { IAppTimeFormat } from "@foxglove/studio-base/hooks/useAppTimeFormat";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { formatDate, formatTime } from "@foxglove/studio-base/util/formatTime";

import { UnconnectedPlaybackTimeDisplay } from "./UnconnectedPlaybackTimeDisplay";

describe("UnconnectedPlaybackTimeDisplay", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("keeps the full date-time display and seeks without losing precision", () => {
    const currentTime = { sec: 1700000005, nsec: 123456789 };
    const onPause = jest.fn();
    const onSeek = jest.fn();
    const appTimeFormat = {
      timeFormat: "TOD",
      setTimeFormat: jest.fn().mockResolvedValue(undefined),
    } as unknown as IAppTimeFormat;
    render(
      <ThemeProvider isDark>
        <UnconnectedPlaybackTimeDisplay
          appTimeFormat={appTimeFormat}
          timezone="UTC"
          currentTime={currentTime}
          startTime={{ sec: 1700000000, nsec: 0 }}
          endTime={{ sec: 1700000060, nsec: 0 }}
          onPause={onPause}
          onSeek={onSeek}
          isPlaying={false}
        />
      </ThemeProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Current playback time" });
    expect(input.value).toBe(`${formatDate(currentTime, "UTC")} ${formatTime(currentTime, "UTC")}`);
    fireEvent.focus(input);
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "1700000006.123456789" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith({ sec: 1700000006, nsec: 123456789 });
    expect(appTimeFormat.setTimeFormat).toHaveBeenCalledWith("SEC");
    expect(
      document.getElementById("playback-time-display-toggle-button")?.getAttribute("aria-label"),
    ).toBe("Time display format");
  });
});

function renderRelativeDisplay({ currentNanos = 123_456_789 }: { currentNanos?: number } = {}) {
  const onSeek = jest.fn();
  const onPause = jest.fn();
  const setTimeFormat = jest.fn().mockResolvedValue(undefined);
  render(
    <ThemeProvider isDark>
      <UnconnectedPlaybackTimeDisplay
        appTimeFormat={{ timeFormat: "REL", setTimeFormat } as unknown as IAppTimeFormat}
        timezone="UTC"
        currentTime={{ sec: 1_700_000_005, nsec: currentNanos }}
        startTime={{ sec: 1_700_000_000, nsec: 987_654_321 }}
        endTime={{ sec: 1_700_000_314, nsec: 987_654_321 }}
        onPause={onPause}
        onSeek={onSeek}
        isPlaying={false}
      />
    </ThemeProvider>,
  );
  return {
    onSeek,
    onPause,
    setTimeFormat,
    input: screen.getByRole<HTMLInputElement>("textbox", { name: "Elapsed time" }),
  };
}

describe("relative playback editing", () => {
  it("shows elapsed time and the total duration", () => {
    const { input } = renderRelativeDisplay();
    expect(input.value).toBe("00:00:04.135");
    expect(screen.getByTestId("playback-total-duration").textContent).toBe("/ 00:05:14.000");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("seeks to the original absolute time on Enter, with the source's nanosecond origin", () => {
    const { input, onSeek, setTimeFormat } = renderRelativeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:01:23.500" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith({ sec: 1_700_000_084, nsec: 487_654_321 });
    expect(setTimeFormat).not.toHaveBeenCalled();
  });

  it("commits decimal relative seconds on blur", () => {
    const { input, onSeek } = renderRelativeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.000000001" } });
    fireEvent.blur(input);
    expect(onSeek).toHaveBeenCalledWith({ sec: 1_700_000_001, nsec: 987_654_322 });
  });

  it("does not seek when an unchanged, millisecond-only display loses focus", () => {
    const { input, onSeek } = renderRelativeDisplay();
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("cancels edits on Escape", () => {
    const { input, onSeek } = renderRelativeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onSeek).not.toHaveBeenCalled();
    expect(input.value).toBe("00:00:04.135");
  });

  it.each(["00:05:14.001", "-0.001", "00:60:00", "abc"])(
    "rejects invalid or outside-range input %s",
    (value) => {
      const { input, onSeek } = renderRelativeDisplay();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest("form")!);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(onSeek).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["0", 1_700_000_000],
    ["314", 1_700_000_314],
  ])("accepts the exact range boundary %s", (value, sec) => {
    const { input, onSeek } = renderRelativeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledWith({ sec, nsec: 987_654_321 });
  });

  it("offers named global modes in the dropdown", async () => {
    const { setTimeFormat } = renderRelativeDisplay();
    fireEvent.click(document.getElementById("playback-time-display-toggle-button")!);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Unix timestamp/ }));
    });
    expect(setTimeFormat).toHaveBeenCalledWith("SEC");
  });
});
