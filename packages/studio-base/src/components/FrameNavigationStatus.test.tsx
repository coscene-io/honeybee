/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material";
import { fireEvent, render, screen } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import FrameNavigationStatus from "./FrameNavigationStatus";

function normalizedColor(color: string): string {
  const element = document.createElement("div");
  element.style.color = color;
  document.body.appendChild(element);
  const normalized = getComputedStyle(element).color;
  element.remove();
  return normalized;
}

describe("FrameNavigationStatus", () => {
  it.each(["light", "dark"] as const)("uses theme colors in %s mode", (mode) => {
    const onCancel = jest.fn();
    const theme = createMuiTheme(mode, "en");

    render(
      <ThemeProvider theme={theme}>
        <FrameNavigationStatus
          message="Searching for next frame"
          cancelLabel="Cancel"
          onCancel={onCancel}
        />
      </ThemeProvider>,
    );

    const status = screen.getByRole("status");
    const style = getComputedStyle(status);
    expect(status.textContent).toContain("Searching for next frame");
    expect(style.backgroundColor).toBe(normalizedColor(theme.palette.background.paper));
    expect(style.borderTopColor).toBe(normalizedColor(theme.palette.divider));
    expect(style.borderBottomColor).toBe(normalizedColor(theme.palette.divider));
    expect(style.color).toBe(normalizedColor(theme.palette.text.secondary));
    expect(screen.getByRole("progressbar")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a completed result in the same status bar without pending controls", () => {
    const onClose = jest.fn();
    render(
      <FrameNavigationStatus
        message="No next matching frame"
        closeLabel="Close"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("No next matching frame");
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
