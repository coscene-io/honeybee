/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import SeekStepControls from "./SeekStepControls";

describe("SeekStepControls", () => {
  it.each(["Enter", "Escape"])(
    "restores keyboard focus and %s applies the expected step",
    async (key) => {
      await i18n.changeLanguage("en");
      render(
        <ThemeProvider isDark>
          <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
            <SeekStepControls />
          </AppConfigurationContext.Provider>
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByRole("button"));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "0.25" } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key });
      expect(screen.getByRole("button").textContent).toContain(
        key === "Enter" ? "0.25 sec" : "0.1 sec",
      );
      expect(document.activeElement).toBe(screen.getByRole("button"));
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
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(onEditingChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.getByRole("textbox")).toBeTruthy();
    result.unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });
});
