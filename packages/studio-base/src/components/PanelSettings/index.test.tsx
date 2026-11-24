/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import PanelCatalogContext from "@foxglove/studio-base/context/PanelCatalogContext";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { PanelStateContextProvider } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import {
  PlaybackDiagnostics,
  PlaybackDiagnosticsContext,
} from "@foxglove/studio-base/services/playbackDiagnostics";

import PanelSettings from ".";

it("shows playback diagnostics as a collapsed, searchable section after custom layers for images", () => {
  const session = new PlaybackDiagnostics();
  const settings = {
    nodes: { layers: { label: "Custom layers", children: { grid: { label: "Grid layer" } } } },
    enableFilter: true,
    actionHandler: jest.fn(),
  };
  const view = (panelId: string) => (
    <PlaybackDiagnosticsContext.Provider value={session}>
      <MockCurrentLayoutProvider initialState={{ configById: { "Image!1": {}, "3D!1": {} } }}>
        <PanelStateContextProvider
          initialState={{ settingsTrees: { "Image!1": settings, "3D!1": settings } }}
        >
          <PanelCatalogContext.Provider
            value={{ getPanelByType: () => undefined, getPanels: () => [] }}
          >
            <PanelSettings selectedPanelIdsForTests={[panelId]} />
          </PanelCatalogContext.Provider>
        </PanelStateContextProvider>
      </MockCurrentLayoutProvider>
    </PlaybackDiagnosticsContext.Provider>
  );
  const { rerender } = render(view("Image!1"));
  const button = screen.getByRole("button", { name: "Playback diagnostics", expanded: false });
  const layers = screen.getByRole("button", { name: "Custom layers", expanded: true });
  expect(layers.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  fireEvent.click(layers);
  expect(screen.queryByText("Grid layer")).toBeNull();
  expect(screen.queryByText("Waiting for image data")).toBeNull();
  fireEvent.click(button);
  expect(screen.getByText("Waiting for image data")).toBeTruthy();
  fireEvent.click(button);
  expect(screen.queryByText("Waiting for image data")).toBeNull();

  const search = screen.getByTestId("panel-settings-filter-input");
  fireEvent.change(search, { target: { value: "layers" } });
  expect(screen.queryByRole("button", { name: "Playback diagnostics" })).toBeNull();
  fireEvent.change(search, { target: { value: "Diagnostics" } });
  expect(screen.getByRole("button", { name: /Playback diagnostics/i })).toBeTruthy();
  expect(screen.queryByText("Custom layers")).toBeNull();
  rerender(view("3D!1"));
  expect(screen.getByText("Custom layers")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Playback diagnostics" })).toBeNull();
});
