/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { ShortcutsHelpButton } from "./ShortcutsHelpButton";
import { TimelineToolbar } from "./TimelineToolbar";

let mockWidth = 1200;
jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: mockWidth, ref: jest.fn() }),
}));

function ToolbarFixture({
  onCreate = jest.fn(),
  onHeightChange,
  realHelp,
}: {
  onCreate?: () => void;
  onHeightChange?: (height: number) => void;
  realHelp?: boolean;
}): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <TimelineToolbar
        onHeightChange={onHeightChange}
        playback={
          <>
            <button>Back</button>
            <button>Play</button>
            <button>Forward</button>
          </>
        }
        playbackOptions={<button>Repeat</button>}
        seekStep={<button>Step</button>}
        speed={<button>Speed</button>}
        time={({ compact }) => <input aria-label="Time" data-compact={compact} />}
        sourceInfo={<button>Source</button>}
        create={() => <button onClick={onCreate}>Create</button>}
        editing={() => <button>Edit</button>}
        zoom={<input type="range" aria-label="Timeline zoom" />}
        fit={() => <button>Fit</button>}
        help={({ showLabel }) =>
          realHelp === true ? <ShortcutsHelpButton showLabel={showLabel} /> : <button>Help</button>
        }
      />
    </ThemeProvider>
  );
}

describe("TimelineToolbar", () => {
  beforeEach(async () => {
    mockWidth = 1200;
    await i18n.changeLanguage("en");
  });

  it.each([1200, 1000, 999, 640])(
    "keeps playback on the left and seek step immediately before more at %dpx",
    (width) => {
      mockWidth = width;
      render(<ToolbarFixture />);
      const toolbar = screen.getByRole("toolbar", { name: "Timeline controls" });
      expect(
        within(toolbar)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual([
        "Back",
        "Play",
        "Forward",
        "Repeat",
        "Speed",
        ...(width >= 1000 ? ["Source"] : []),
        "Create",
        ...(width >= 1000 ? ["Edit"] : []),
        "Fit",
        "Step",
        "",
      ]);
      expect(screen.getAllByRole("button", { name: "Step" })).toHaveLength(1);
      expect(screen.getByLabelText("Time").dataset.compact).toBe(String(width < 1000));
    },
  );

  it("moves secondary tools into more based on actual width and mounts each control once", () => {
    const result = render(<ToolbarFixture />);
    mockWidth = 720;
    result.rerender(<ToolbarFixture />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByLabelText("Time").dataset.compact).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  });

  it.each([1200, 1000, 999, 640, 639, 480, 479, 375])(
    "keeps the zoom slider outside more at %dpx",
    (width) => {
      mockWidth = width;
      render(<ToolbarFixture />);
      const toolbar = screen.getByRole("toolbar", { name: "Timeline controls" });
      const slider = within(toolbar).getByRole("slider", { name: "Timeline zoom" });
      fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));

      expect(toolbar.contains(slider)).toBe(true);
      expect(screen.getAllByRole("slider", { name: "Timeline zoom", hidden: true })).toHaveLength(
        1,
      );
      expect(within(screen.getByRole("dialog")).queryByRole("slider")).toBeNull();
    },
  );

  it("gives zoom its own row at narrow widths", () => {
    mockWidth = 375;
    const { rerender } = render(<ToolbarFixture />);
    const toolbar = screen.getByRole("toolbar", { name: "Timeline controls" });
    expect(getComputedStyle(toolbar).flexWrap).toBe("wrap");
    expect(getComputedStyle(toolbar).height).toBe("80px");

    mockWidth = 480;
    rerender(<ToolbarFixture />);
    expect(getComputedStyle(toolbar).height).toBe("40px");
  });

  it("reports toolbar height changes when its width crosses the two-row breakpoint", () => {
    const onHeightChange = jest.fn();
    const { rerender } = render(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(40);

    mockWidth = 375;
    rerender(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(80);

    mockWidth = 480;
    rerender(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(40);
    expect(onHeightChange).toHaveBeenCalledTimes(3);
  });

  it("keeps shortcut help mounted when opened from more and returns to the tools", async () => {
    mockWidth = 375;
    render(<ToolbarFixture realHelp />);
    fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help).toBeTruthy();
    fireEvent.keyDown(help, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    });
    expect(screen.getByRole("dialog", { name: "More timeline tools" })).toBeTruthy();
  });

  it.each([
    { width: 1200, language: "en" },
    { width: 1200, language: "zh" },
    { width: 375, language: "en" },
    { width: 375, language: "zh" },
  ])(
    "gives shortcut help a full menu row at $width px in $language",
    async ({ width, language }) => {
      mockWidth = width;
      await i18n.changeLanguage(language);
      render(<ToolbarFixture realHelp />);
      const trigger = screen.getByRole("button", { name: i18n.t("general:timelineMoreTools") });
      expect(getComputedStyle(trigger).width).toBe("30px");
      fireEvent.click(trigger);
      const menu = screen.getByRole("dialog", { name: i18n.t("general:timelineMoreTools") });
      const help = within(menu).getByRole("button", { name: i18n.t("general:keyboardShortcuts") });

      expect(getComputedStyle(help).width).toBe("100%");
    },
  );

  it.each([639, 375])(
    "retains playback, speed and time at %dpx and exposes hidden tools in more",
    (width) => {
      mockWidth = width;
      const onCreate = jest.fn();
      render(<ToolbarFixture onCreate={onCreate} />);
      for (const name of ["Play", "Speed"]) {
        expect(screen.getByRole("button", { name })).toBeTruthy();
      }
      for (const name of [
        "Step",
        "Repeat",
        "Source",
        "Create",
        "Edit",
        ...(width < 480 ? ["Fit"] : []),
      ]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
      const more = screen.getByRole("dialog");
      for (const name of [
        "Step",
        "Repeat",
        "Source",
        "Create",
        "Edit",
        ...(width < 480 ? ["Fit"] : []),
        "Help",
      ]) {
        expect(within(more).getByRole("button", { name })).toBeTruthy();
      }
      expect(screen.getAllByRole("button", { name: "Step" })).toHaveLength(1);
      fireEvent.click(within(more).getByRole("button", { name: "Create" }));
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "More timeline tools" }).getAttribute("aria-expanded"),
      ).toBe("false");
    },
  );
});
