/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { ShortcutsHelpButton } from "./ShortcutsHelpButton";
import { closeKeyboardShortcuts, openKeyboardShortcuts } from "./keyboardShortcutsDialogStore";

describe("KeyboardShortcutsDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    act(() => {
      closeKeyboardShortcuts();
    });
  });

  it("opens one dialog no matter which trigger is used", () => {
    render(
      <>
        <ShortcutsHelpButton />
        <ShortcutsHelpButton showLabel />
        <KeyboardShortcutsDialog />
      </>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Keyboard shortcuts" })[1]!);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("opens when called from outside the timeline and closes on Escape", async () => {
    render(<KeyboardShortcutsDialog />);
    act(() => {
      openKeyboardShortcuts();
    });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
