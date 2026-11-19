/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";

import type { Time } from "@foxglove/rostime";
import type { IAppTimeFormat } from "@foxglove/studio-base/hooks/useAppTimeFormat";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import type { TimeDisplayMethod } from "@foxglove/studio-base/types/panels";
import { formatDate, formatTime } from "@foxglove/studio-base/util/formatTime";

import { UnconnectedPlaybackTimeDisplay } from "./UnconnectedPlaybackTimeDisplay";

describe("UnconnectedPlaybackTimeDisplay", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows compact time, restores the full value for editing and seeks without losing precision", () => {
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
          compact
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
    expect(input.value).toBe(formatTime(currentTime, "UTC"));
    fireEvent.focus(input);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(input.value).toBe(`${formatDate(currentTime, "UTC")} ${formatTime(currentTime, "UTC")}`);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    fireEvent.change(input, { target: { value: "1700000006.123456789" } });
    expect(input.selectionStart).toBe(input.value.length);
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith({ sec: 1700000006, nsec: 123456789 });
    expect(appTimeFormat.setTimeFormat).toHaveBeenCalledWith("SEC");
    const formatButton = screen.getByRole("button", { name: "Time display format" });
    fireEvent.focus(formatButton);
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

function renderTimeDisplay({
  compact = false,
  timeFormat = "REL",
  startTime = { sec: 1_700_000_000, nsec: 987_654_321 },
  endTime = { sec: 1_700_000_314, nsec: 987_654_321 },
}: {
  compact?: boolean;
  timeFormat?: TimeDisplayMethod;
  startTime?: Time;
  endTime?: Time;
} = {}) {
  const onSeek = jest.fn();
  const onPause = jest.fn();
  const setTimeFormat = jest.fn().mockResolvedValue(undefined);
  render(
    <ThemeProvider isDark>
      <UnconnectedPlaybackTimeDisplay
        compact={compact}
        appTimeFormat={{ timeFormat, setTimeFormat } as unknown as IAppTimeFormat}
        timezone="UTC"
        currentTime={{ sec: startTime.sec + 5, nsec: 123_456_789 }}
        startTime={startTime}
        endTime={endTime}
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
    input: screen.getByRole<HTMLInputElement>("textbox", {
      name: timeFormat === "REL" ? "Elapsed time" : "Current playback time",
    }),
  };
}

describe("relative playback editing", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([false, true])("shows elapsed / total in compact=%s", (compact) => {
    const { input } = renderTimeDisplay({ compact });
    expect(input.value).toBe("00:00:04.135");
    expect(screen.getByTestId("playback-total-duration").textContent).toBe("/ 00:05:14.000");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("seeks to the original absolute time on Enter, with the source's nanosecond origin", () => {
    const { input, onSeek, setTimeFormat } = renderTimeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:01:23.500" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith({ sec: 1_700_000_084, nsec: 487_654_321 });
    expect(setTimeFormat).not.toHaveBeenCalled();
  });

  it("commits decimal relative seconds on blur", () => {
    const { input, onSeek } = renderTimeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.000000001" } });
    fireEvent.blur(input);
    expect(onSeek).toHaveBeenCalledWith({ sec: 1_700_000_001, nsec: 987_654_322 });
  });

  it("does not seek when an unchanged, millisecond-only display loses focus", () => {
    const { input, onSeek } = renderTimeDisplay();
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("cancels edits on Escape", () => {
    const { input, onSeek } = renderTimeDisplay();
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
      const { input, onSeek } = renderTimeDisplay();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest("form")!);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(onSeek).not.toHaveBeenCalled();
    },
  );

  it("shows supported formats on hover and keeps the reason after an invalid edit blurs", async () => {
    jest.useFakeTimers();
    const { input, onSeek } = renderTimeDisplay();
    const currentTime = input.value;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:60:00" } });
    fireEvent.submit(input.closest("form")!);
    expect(input.value).toBe("00:60:00");
    fireEvent.mouseOver(input);
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /Invalid time format.*00:01:23\.500.*83\.5/,
    );
    fireEvent.mouseLeave(screen.getByTestId("PlaybackTime-text"));
    fireEvent.blur(input);
    expect(input.value).toBe(currentTime);
    expect(onSeek).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.mouseOver(input);
    expect((await screen.findByRole("tooltip")).textContent).toContain("Invalid time format");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it.each(["-0.000000001", "314.000000002"])(
    "shows precise range bounds for an out-of-range offset %s submitted on blur",
    async (value) => {
      const { input, onSeek } = renderTimeDisplay({
        startTime: { sec: 0, nsec: 0 },
        endTime: { sec: 314, nsec: 1 },
      });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      fireEvent.mouseOver(input);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain("Outside the current file’s time range");
      expect(tooltip.textContent).toContain("0 to 314.000000001");
      expect(onSeek).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["0", 1_700_000_000],
    ["314", 1_700_000_314],
  ])("accepts the exact range boundary %s", (value, sec) => {
    const { input, onSeek } = renderTimeDisplay();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
    expect(onSeek).toHaveBeenCalledWith({ sec, nsec: 987_654_321 });
  });

  it("offers named global modes in the dropdown", async () => {
    const { setTimeFormat } = renderTimeDisplay();
    fireEvent.click(screen.getByRole("button", { name: "Time display format" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Unix timestamp/ }));
    });
    expect(setTimeFormat).toHaveBeenCalledWith("SEC");
  });
});

describe("absolute playback input tooltips", () => {
  it("shows date and Unix examples for an unparseable absolute time", async () => {
    const { input, onSeek } = renderTimeDisplay({ timeFormat: "SEC" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    fireEvent.mouseOver(input);
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /Invalid time format.*2023-11-14 10:13:20\.000 PM UTC.*1700000000\.123456789/,
    );
    expect(onSeek).not.toHaveBeenCalled();
  });

  it.each([
    [123_000_000, "2023-11-14 10:13:20.123 PM UTC to 2023-11-14 10:18:34.000 PM UTC"],
    [123_456_789, "1700000000.123456789 to 1700000314.000000000"],
  ])("shows exact absolute range bounds with a start fraction of %s ns", async (nsec, range) => {
    const { input, onSeek, setTimeFormat } = renderTimeDisplay({
      timeFormat: "TOD",
      startTime: { sec: 1_700_000_000, nsec },
      endTime: { sec: 1_700_000_314, nsec: 0 },
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2023-11-14 10:13:20.000 PM UTC" } });
    fireEvent.blur(input);
    fireEvent.mouseOver(input);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Outside the current file’s time range");
    expect(tooltip.textContent).toContain(range);
    expect(onSeek).not.toHaveBeenCalled();
    expect(setTimeFormat).not.toHaveBeenCalled();
  });
});
