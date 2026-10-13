/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render } from "@testing-library/react";
import i18n from "i18next";

import { PanelExtensionContext } from "@foxglove/studio";

import MapPanel from "./MapPanel";

it("updates translated settings without changing subscriptions", async () => {
  const previousLanguage = i18n.language;
  await i18n.changeLanguage("en");
  const subscribe = jest.fn();
  const unsubscribeAll = jest.fn();
  const updatePanelSettingsEditor = jest.fn();
  const context = {
    initialState: {},
    subscribe,
    unsubscribeAll,
    updatePanelSettingsEditor,
    watch: jest.fn(),
    saveState: jest.fn(),
  } as unknown as PanelExtensionContext;
  const { unmount } = render(<MapPanel context={context} />);
  try {
    act(() => {
      context.onRender?.(
        {
          topics: [
            {
              name: "/gps",
              schemaName: "sensor_msgs/NavSatFix",
              messageCount: 1,
              messageFrequency: 1,
            },
          ],
        },
        jest.fn(),
      );
    });
    expect(subscribe).toHaveBeenLastCalledWith([
      { topic: "/gps", convertTo: "sensor_msgs/NavSatFix", preload: true },
    ]);
    const previousSettings = JSON.stringify(updatePanelSettingsEditor.mock.lastCall);
    subscribe.mockClear();
    unsubscribeAll.mockClear();
    updatePanelSettingsEditor.mockClear();
    await act(async () => {
      await i18n.changeLanguage("zh");
    });
    expect(updatePanelSettingsEditor).toHaveBeenCalled();
    expect(JSON.stringify(updatePanelSettingsEditor.mock.lastCall)).not.toBe(previousSettings);
    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribeAll).not.toHaveBeenCalled();
  } finally {
    unmount();
    await i18n.changeLanguage(previousLanguage);
  }
});
