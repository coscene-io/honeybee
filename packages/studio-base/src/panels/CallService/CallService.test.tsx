/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { PanelExtensionContext } from "@foxglove/studio";
import { callService as en } from "@foxglove/studio-base/i18n/en/callService";
import { callService as zh } from "@foxglove/studio-base/i18n/zh/callService";

import { CallService } from "./CallService";

it("retranslates a pending call without repeating the request and preserves the response", async () => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { callService: en }, zh: { callService: zh } },
    interpolation: { escapeValue: false },
  });
  let resolveResponse!: (response: unknown) => void;
  const callService = jest.fn().mockImplementation(
    async () =>
      await new Promise((resolve) => {
        resolveResponse = resolve;
      }),
  );
  const context = {
    initialState: { serviceName: "/test", requestPayload: "{}" },
    callService,
    saveState: jest.fn(),
    setDefaultPanelTitle: jest.fn(),
    watch: jest.fn(),
    updatePanelSettingsEditor: jest.fn(),
  } as unknown as PanelExtensionContext;
  render(
    <I18nextProvider i18n={i18n}>
      <CallService context={context} />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByTestId("call-service-button"));
  expect(screen.getByDisplayValue("Calling /test...")).toBeDefined();
  await act(async () => {
    await i18n.changeLanguage("zh");
  });
  expect(
    screen.getByDisplayValue(i18n.t("callService:callingService", { serviceName: "/test" })),
  ).toBeDefined();
  expect(callService).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveResponse({ result: "unchanged" });
  });
  const response = JSON.stringify({ result: "unchanged" }, undefined, 2)!;
  expect(screen.getByDisplayValue(response, { normalizer: (value) => value })).toBeDefined();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByDisplayValue(response, { normalizer: (value) => value })).toBeDefined();
  expect(callService).toHaveBeenCalledTimes(1);
});
