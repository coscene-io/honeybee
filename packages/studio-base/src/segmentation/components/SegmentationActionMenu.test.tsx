/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen, within } from "@testing-library/react";

import { SegmentationActionMenu } from "./SegmentationActionMenu";
import { render, testHost, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument, setMockControls } from "../testing/mockService";
import { allowSlowRunner } from "../testing/slowRunner";

allowSlowRunner();

installSegmentationTestHost();

async function open(panelId = "panel-1") {
  const document = createSeedDocument();
  document.frames = document.frames.slice(0, 3);
  const runtime = createMockSegmentationRuntime(document);
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  testHost().session.setState({
    runtime,
    open: true,
    panelId,
    sourceReady: true,
    workflow: { open: false, nonce: 0 },
  });
  return runtime;
}

afterEach(() => {
  testHost().session.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    workflow: { open: false, nonce: 0 },
  });
});

describe("SegmentationActionMenu", () => {
  it("renders nothing while no session is open", () => {
    const { container } = render(<SegmentationActionMenu />);
    expect(container.textContent).toBe("");
  });

  it("shows undo, redo and submit as three header buttons", async () => {
    const runtime = await open();
    render(<SegmentationActionMenu />);
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual(["Undo annotation", "Redo annotation", "Submit"]);
    expect(screen.getByRole("button", { name: "Undo annotation" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Redo annotation" })).toHaveProperty(
      "disabled",
      true,
    );
    runtime.dispose();
  });

  it("undoes and redoes staged edits from the header icons", async () => {
    const runtime = await open();
    render(<SegmentationActionMenu />);
    act(() => {
      runtime.store.getState().addClass("Fresh class");
    });
    expect(screen.getByLabelText("1 staged change").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Undo annotation" }));
    expect(runtime.store.getState().stagedOperations).toHaveLength(0);
    expect(screen.queryByLabelText("1 staged change")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Redo annotation" }));
    expect(runtime.store.getState().stagedOperations).toHaveLength(1);
    runtime.dispose();
  });

  it("holds submission, version history and ending the session behind Submit", async () => {
    const runtime = await open();
    render(<SegmentationActionMenu />);
    act(() => {
      runtime.store.getState().addClass("Fresh class");
    });
    fireEvent.click(screen.getByRole("button", { name: /^Submit/ }));
    const menu = screen.getByRole("dialog", { name: "Submit" });
    expect(within(menu).getByRole("button", { name: "Submit 1" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(within(menu).getByLabelText("Submit message")).toBeTruthy();
    expect(within(menu).getByText(/Waiting to submit: 1/)).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Clear staged" })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "End annotation" }));
    expect(testHost().session.getState().open).toBe(false);
    runtime.dispose();
  });
});
