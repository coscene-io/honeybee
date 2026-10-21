/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import SeekStepControls from "./SeekStepControls";

describe("SeekStepControls", () => {
  it.each(["Enter", "Escape"])(
    "keeps the input mounted and focused while %s applies the expected step",
    async (key) => {
      await i18n.changeLanguage("en");
      render(
        <ThemeProvider isDark>
          <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
            <SeekStepControls />
          </AppConfigurationContext.Provider>
        </ThemeProvider>,
      );
      const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Step size" });
      act(() => {
        input.focus();
      });
      fireEvent.change(input, { target: { value: "0.25" } });
      fireEvent.keyDown(input, { key });
      expect(input.value).toBe(key === "Enter" ? "0.25" : "0.1");
      expect(screen.getByRole("textbox")).toBe(input);
      expect(document.activeElement).toBe(input);
    },
  );

  it("releases the playback keyboard lock when an editing control is unmounted", async () => {
    await i18n.changeLanguage("en");
    const onEditingChange = jest.fn();
    const result = render(
      <ThemeProvider isDark>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <SeekStepControls onEditingChange={onEditingChange} />
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );
    fireEvent.focus(screen.getByRole("textbox"));
    await waitFor(() => {
      expect(onEditingChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.getByRole("textbox")).toBeTruthy();
    result.unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    { value: "0.25", expectedMs: 250 },
    { value: "0.000001", expectedMs: 0.001 },
    { value: "0.000000001", expectedMs: 0.001 },
    { value: "3601", expectedMs: 3600000 },
    { value: "", expectedMs: 100 },
    { value: "invalid", expectedMs: 100 },
  ])("saves $value on blur using the existing bounds", async ({ value, expectedMs }) => {
    await i18n.changeLanguage("en");
    const configuration = makeMockAppConfiguration([[AppSetting.SEEK_STEP_MS, 500]]);
    render(
      <ThemeProvider isDark>
        <AppConfigurationContext.Provider value={configuration}>
          <SeekStepControls />
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    expect(configuration.get(AppSetting.SEEK_STEP_MS)).toBe(500);
    fireEvent.blur(input);
    expect(configuration.get(AppSetting.SEEK_STEP_MS)).toBe(expectedMs);
    expect(input.value).toBe(String(expectedMs / 1000));
  });

  it("does not commit a canceled draft when focus leaves the input", async () => {
    await i18n.changeLanguage("en");
    const configuration = makeMockAppConfiguration([[AppSetting.SEEK_STEP_MS, 100]]);
    render(
      <ThemeProvider isDark>
        <AppConfigurationContext.Provider value={configuration}>
          <SeekStepControls />
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0.25" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(configuration.get(AppSetting.SEEK_STEP_MS)).toBe(100);
    expect(input.value).toBe("0.1");
  });

  it("disables the input when playback controls are unavailable", async () => {
    await i18n.changeLanguage("en");
    render(
      <ThemeProvider isDark>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <SeekStepControls disabled />
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Step size" }).disabled).toBe(
      true,
    );
  });

  it.each([
    { language: "en", label: "Step size", unit: "sec" },
    { language: "zh", label: "步长", unit: "秒" },
    { language: "ja", label: "ステップ幅", unit: "秒" },
  ])("labels the input and unit in $language", async ({ language, label, unit }) => {
    await i18n.changeLanguage(language);
    render(
      <ThemeProvider isDark>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <SeekStepControls />
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: label });
    expect(input.value).toBe("0.1");
    expect(screen.getByText(unit)).toBeTruthy();
    for (const descriptionId of input.getAttribute("aria-describedby")!.split(" ")) {
      expect(document.getElementById(descriptionId)).toBeTruthy();
    }
  });
});
