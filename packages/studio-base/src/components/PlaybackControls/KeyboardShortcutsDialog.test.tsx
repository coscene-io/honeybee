/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

import {
  WorkspaceSlotsProvider,
  createWorkspaceSlotsStore,
  registerWorkspaceSlot,
} from "@foxglove/studio-base/context/WorkspaceSlots";

import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { ShortcutsHelpButton } from "./ShortcutsHelpButton";
import {
  KeyboardShortcutsDialogProvider,
  createKeyboardShortcutsDialogStore,
} from "./keyboardShortcutsDialogStore";

describe("KeyboardShortcutsDialog", () => {
  let slots = createWorkspaceSlotsStore();
  let dialogStore = createKeyboardShortcutsDialogStore();
  const Providers = ({ children }: { children: React.ReactNode }) => (
    <WorkspaceSlotsProvider store={slots}>
      <KeyboardShortcutsDialogProvider store={dialogStore}>
        {children}
      </KeyboardShortcutsDialogProvider>
    </WorkspaceSlotsProvider>
  );

  beforeEach(async () => {
    slots = createWorkspaceSlotsStore();
    dialogStore = createKeyboardShortcutsDialogStore();
    await i18n.changeLanguage("en");
  });

  it("opens one dialog no matter which trigger is used", () => {
    render(
      <>
        <ShortcutsHelpButton />
        <ShortcutsHelpButton showLabel />
        <KeyboardShortcutsDialog />
      </>,
      { wrapper: Providers },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Keyboard shortcuts" })[1]!);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("opens when called from outside the timeline and closes on Escape", async () => {
    render(<KeyboardShortcutsDialog />, { wrapper: Providers });
    act(() => {
      dialogStore.setState({ open: true });
    });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("adds a column registered through WorkspaceSlots and drops it on unregister", () => {
    render(<KeyboardShortcutsDialog />, { wrapper: Providers });
    act(() => {
      dialogStore.setState({ open: true });
    });
    expect(screen.queryByText("Feature column")).toBeNull();
    let unregister = () => {};
    act(() => {
      unregister = registerWorkspaceSlot(slots, "shortcutColumns", "test", {
        title: "Feature column",
        sections: [{ title: "Feature section", rows: [{ label: "Do it", keys: ["X"] }] }],
      });
    });
    expect(screen.getByText("Feature column")).toBeTruthy();
    expect(screen.getByText("Do it")).toBeTruthy();
    expect(screen.getByText("X")).toBeTruthy();
    act(() => {
      unregister();
    });
    expect(screen.queryByText("Feature column")).toBeNull();
  });
});
