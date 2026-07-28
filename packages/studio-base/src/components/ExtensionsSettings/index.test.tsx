/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { createStore } from "zustand";

import {
  ExtensionCatalog,
  ExtensionCatalogContext,
} from "@foxglove/studio-base/context/ExtensionCatalogContext";

import ExtensionsSettings from "./index";

function renderSettings(overrides: Partial<ExtensionCatalog>): void {
  const store = createStore<ExtensionCatalog>(() => ({
    downloadExtension: async () => new Uint8Array(),
    installExtension: async () => {
      throw new Error("unsupported");
    },
    refreshExtensions: async () => {},
    uninstallExtension: async () => {},
    loadState: "ready",
    loadErrors: [],
    installedExtensions: [],
    installedMessageConverters: [],
    installedPanels: {},
    installedTopicAliasFunctions: [],
    panelSettings: {},
    ...overrides,
  }));

  render(
    <SnackbarProvider>
      <ExtensionCatalogContext.Provider value={store}>
        <ExtensionsSettings />
      </ExtensionCatalogContext.Provider>
    </SnackbarProvider>,
  );
}

describe("ExtensionsSettings", () => {
  it("shows a non-blocking initial loading state", () => {
    renderSettings({ loadState: "loading", installedExtensions: undefined });

    expect(screen.getByRole("status").textContent).toContain("Loading extensions");
    expect(screen.queryByText("No installed extensions")).toBeNull();
  });

  it("shows degraded state details and retries extension loading", () => {
    const refreshExtensions = jest.fn().mockResolvedValue(undefined);
    renderSettings({
      loadState: "degraded",
      loadErrors: [
        {
          namespace: "org",
          stage: "list",
          message: "timed out",
          timedOut: true,
        },
        {
          namespace: "local",
          stage: "load",
          extensionId: "broken-extension",
          message: "failed",
          timedOut: false,
        },
      ],
      refreshExtensions,
    });

    expect(screen.getByRole("alert").textContent).toContain("2 errors");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refreshExtensions).toHaveBeenCalledTimes(1);
  });
});
