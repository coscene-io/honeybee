/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import { StrictMode } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

import type { PanelExtensionContext } from "@foxglove/studio";
import { mountPanel } from "@foxglove/studio-base/components/PanelExtensionAdapter/mountPanel";
import { dataCollection as en } from "@foxglove/studio-base/i18n/en/dataCollection";
import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

import { DataCollection } from "./DataCollection";
import { DataCollectionProvider } from "./DataCollectionContext";

it("commits authenticated content and acknowledges frames across two independent root lifecycles", async () => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { dataCollection: en } },
    interpolation: { escapeValue: false },
  });
  const listUserProjects = jest.fn(async () => ({ userProjects: [] }));
  const consoleApi = { listUserProjects } as unknown as ConsoleApi;
  const userInfo = {
    userId: "fixture-user",
    nickName: "Fixture",
    avatarUrl: "",
    phoneNumber: "",
    agreedAgreement: "",
    role: "",
    email: "fixture@example.test",
    targetSite: "",
  };
  const callService = jest.fn();
  for (let cycle = 0; cycle < 2; cycle++) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const context = {
      panelElement: container,
      initialState: {},
      callService,
      watch: jest.fn(),
      saveState: jest.fn(),
      updatePanelSettingsEditor: jest.fn(),
    } as unknown as PanelExtensionContext;
    let cleanup: (() => void) | undefined;
    try {
      await act(async () => {
        cleanup = mountPanel(
          container,
          <StrictMode>
            <I18nextProvider i18n={i18n}>
              <DataCollectionProvider
                panelState="NOMAL"
                userInfo={userInfo}
                consoleApi={consoleApi}
                deviceLink="/fixture-device"
              >
                <DataCollection context={context} />
              </DataCollectionProvider>
            </I18nextProvider>
          </StrictMode>,
        );
      });
      await screen.findByRole("button", { name: "Start collection" });
      await waitFor(() => {
        expect(context.onRender).toBeDefined();
      });
      const done = jest.fn();
      await act(async () => {
        context.onRender?.({ colorScheme: "dark", extensionData: {} }, done);
      });
      expect(done).toHaveBeenCalledTimes(1);
      expect(listUserProjects).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "fixture-user" }),
      );
      expect(callService).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        cleanup?.();
      });
      expect(context.onRender).toBeUndefined();
      expect(container.childElementCount).toBe(0);
      container.remove();
    }
  }
});
