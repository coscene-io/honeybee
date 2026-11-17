/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import PanelCatalogContext, { PanelInfo } from "@foxglove/studio-base/context/PanelCatalogContext";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { PanelCatalog } from "./PanelCatalog";

it("keeps all matching regular and preconfigured panels searchable beyond ten results", () => {
  const panels: PanelInfo[] = ["regular", "preset"].flatMap((kind) =>
    Array.from({ length: 15 }, (_, index) => ({
      type: `${kind}-${index}`,
      title: `Matching Panel ${index.toString().padStart(2, "0")} ${kind}`,
      config: kind === "preset" ? { example: true } : undefined,
      module: async () => {
        throw new Error("Panel modules are not loaded by the catalog");
      },
    })),
  );
  panels.push({ ...panels[0]!, type: "unrelated", title: "Unrelated" });
  const onPanelSelect = jest.fn();
  render(
    <ThemeProvider isDark>
      <PanelCatalogContext.Provider
        value={{ getPanels: () => panels, getPanelByType: () => undefined }}
      >
        <PanelCatalog mode="grid" onPanelSelect={onPanelSelect} />
      </PanelCatalogContext.Provider>
    </ThemeProvider>,
  );
  expect(screen.getAllByTestId(/^panel-grid-card /)).toHaveLength(31);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Matching" } });
  expect(screen.getAllByTestId(/^panel-grid-card /)).toHaveLength(30);
  expect(screen.queryByTestId("panel-grid-card Unrelated")).toBe(ReactNull);
  fireEvent.click(screen.getByTestId("panel-grid-card Matching Panel 14 preset"));
  expect(onPanelSelect).toHaveBeenLastCalledWith({ type: "preset-14", config: { example: true } });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  expect(screen.getAllByTestId(/^panel-grid-card /)).toHaveLength(31);
});
