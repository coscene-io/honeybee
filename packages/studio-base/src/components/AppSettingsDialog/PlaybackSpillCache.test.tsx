/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { PlaybackSpillCache } from "@foxglove/studio-base/components/AppSettingsDialog/settings";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

describe("PlaybackSpillCache", () => {
  it("is disabled by default and persists the user's choice", async () => {
    const appConfiguration = makeMockAppConfiguration();
    const setSpy = jest.spyOn(appConfiguration, "set");

    render(
      <AppConfigurationContext.Provider value={appConfiguration}>
        <PlaybackSpillCache />
      </AppConfigurationContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "On" }));

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith(AppSetting.PLAYBACK_SPILL_CACHE_ENABLED, true);
    });
    expect(screen.getByRole("button", { name: "On" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("loads an enabled user setting", () => {
    const appConfiguration = makeMockAppConfiguration([
      [AppSetting.PLAYBACK_SPILL_CACHE_ENABLED, true],
    ]);

    render(
      <AppConfigurationContext.Provider value={appConfiguration}>
        <PlaybackSpillCache />
      </AppConfigurationContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "On" }).getAttribute("aria-pressed")).toBe("true");
  });
});
