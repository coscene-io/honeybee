/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

import { segmentationSession } from "@foxglove/studio-base/semanticSegmentation/runtime";

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

  describe("空间标注 column", () => {
    const originalUserAgent = navigator.userAgent;
    const setUserAgent = (value: string) => {
      Object.defineProperty(navigator, "userAgent", { configurable: true, value });
    };
    const openDialog = () => {
      render(<KeyboardShortcutsDialog />);
      act(() => {
        openKeyboardShortcuts();
      });
    };

    afterEach(() => {
      setUserAgent(originalUserAgent);
      act(() => {
        segmentationSession.setState({ open: false });
      });
    });

    it("is absent without an annotation session", () => {
      openDialog();
      expect(screen.queryByText("Spatial annotation")).toBeNull();
      expect(screen.queryByText("Fit to selection")).toBeNull();
    });

    it("shows Mac keys under a Mac user agent", () => {
      setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
      act(() => {
        segmentationSession.setState({ open: true });
      });
      openDialog();
      expect(screen.getByText("Spatial annotation")).toBeTruthy();
      expect(screen.getByText("⌘ + Z")).toBeTruthy();
      expect(screen.getByText("⌘ + Shift + Z")).toBeTruthy();
      expect(screen.getByText("Option + click")).toBeTruthy();
      expect(screen.queryByText("Ctrl + Y")).toBeNull();
    });

    it("shows Ctrl and Alt keys elsewhere", () => {
      setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
      act(() => {
        segmentationSession.setState({ open: true });
      });
      openDialog();
      expect(screen.getByText("Ctrl + Z")).toBeTruthy();
      expect(screen.getByText("Ctrl + Shift + Z")).toBeTruthy();
      expect(screen.getByText("Ctrl + Y")).toBeTruthy();
      expect(screen.getByText("Alt + click")).toBeTruthy();
    });
  });
});
