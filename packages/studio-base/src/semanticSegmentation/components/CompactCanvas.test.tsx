/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, within } from "@testing-library/react";

import { createMockSemanticSegmentationService, createSeedDocument } from "../mockService";
import { createSemanticSegmentationStore } from "../store";
import { SegmentationCanvas } from "./SegmentationCanvas";

async function setup(layout: "standalone" | "compact") {
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({
      document: createSeedDocument(),
      controls: { delayMs: 0 },
    }),
  );
  await store.getState().initialize();
  render(<SegmentationCanvas store={store} compact={layout === "compact"} />);
  return store;
}

it("keeps the toolbar and hint footer in the standalone canvas", async () => {
  const store = await setup("standalone");
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
  expect(screen.getByText(/Select an instance/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "View tools" })).toBeNull();
  store.getState().dispose();
});

it("compact canvas shows only the view tools button until it is opened", async () => {
  const store = await setup("compact");
  expect(screen.queryByRole("button", { name: "Zoom out" })).toBeNull();
  expect(screen.queryByText(/Select an instance/)).toBeNull();
  const fab = screen.getByRole("button", { name: "View tools" });
  expect(fab.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(fab);
  expect(fab.getAttribute("aria-expanded")).toBe("true");
  const tools = screen.getByRole("group", { name: "View tools" });
  expect(within(tools).getByRole("button", { name: "Zoom out" })).toBeTruthy();
  expect(within(tools).getByRole("button", { name: "Pan" })).toBeTruthy();
  expect(within(tools).getByLabelText("Overlay opacity")).toBeTruthy();
  expect(within(tools).getByRole("button", { name: "Shortcuts" })).toBeTruthy();
  fireEvent.keyDown(within(tools).getByRole("button", { name: "Zoom out" }), { key: "Escape" });
  expect(screen.queryByRole("group", { name: "View tools" })).toBeNull();
  expect(fab.getAttribute("aria-expanded")).toBe("false");
  store.getState().dispose();
});
