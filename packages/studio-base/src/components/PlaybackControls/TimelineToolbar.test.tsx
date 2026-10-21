/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import SeekStepControls from "./SeekStepControls";
import { ShortcutsHelpButton } from "./ShortcutsHelpButton";
import { TimelineToolbar } from "./TimelineToolbar";

let mockWidth = 1200;
let mockHeight: number | undefined = 40;
jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: mockWidth, height: mockHeight, ref: jest.fn() }),
}));

function ToolbarFixture({
  onCreate = jest.fn(),
  onHeightChange,
  realHelp,
  seekStep = <button>Step</button>,
}: {
  onCreate?: () => void;
  onHeightChange?: (height: number) => void;
  realHelp?: boolean;
  seekStep?: React.ReactNode;
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
        seekStep={seekStep}
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
    mockHeight = 40;
    await i18n.changeLanguage("en");
  });

  it.each([1200, 1000, 999, 640, 639, 480, 479, 375])(
    "keeps playback on the left and seek step inside more at %dpx",
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
        "Source",
        "Create",
        "Edit",
        "Fit",
        "",
      ]);
      expect(screen.queryByRole("button", { name: "Step" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
      const more = screen.getByRole("dialog");
      expect(
        within(more)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Help", "Step"]);
      expect(screen.getAllByRole("button", { name: "Step" })).toHaveLength(1);
      expect(screen.getByLabelText("Time").dataset.compact).toBe(String(width < 1000));
    },
  );

  it("keeps secondary controls mounted on the toolbar when its width changes", () => {
    const result = render(<ToolbarFixture />);
    const edit = screen.getByRole("button", { name: "Edit" });
    mockWidth = 375;
    result.rerender(<ToolbarFixture />);
    expect(screen.getByRole("button", { name: "Edit" })).toBe(edit);
    expect(screen.getByLabelText("Time").dataset.compact).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Edit" })).toBeNull();
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

  it("allows toolbar controls to wrap instead of adding them to more", () => {
    mockWidth = 375;
    render(<ToolbarFixture />);
    const toolbar = screen.getByRole("toolbar", { name: "Timeline controls" });
    expect(getComputedStyle(toolbar).flexWrap).toBe("wrap");
    expect(getComputedStyle(toolbar).minHeight).toBe("40px");
  });

  it("reports the measured height so wrapped controls retain timeline space", () => {
    const onHeightChange = jest.fn();
    mockHeight = undefined;
    const { rerender } = render(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(40);

    mockWidth = 375;
    mockHeight = 118;
    rerender(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(118);

    // A label or source-info change can alter height without changing the width.
    mockHeight = 157;
    rerender(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(157);

    mockWidth = 1200;
    mockHeight = 40;
    rerender(<ToolbarFixture onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(40);
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

  it.each([639, 375])("retains all other tools outside more at %dpx", (width) => {
    mockWidth = width;
    const onCreate = jest.fn();
    render(<ToolbarFixture onCreate={onCreate} />);
    const toolbar = screen.getByRole("toolbar", { name: "Timeline controls" });
    for (const name of ["Play", "Speed", "Repeat", "Source", "Create", "Edit", "Fit"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(within(toolbar).getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "More timeline tools" }));
    const more = screen.getByRole("dialog");
    expect(
      within(more)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Help", "Step"]);
  });

  it.each([
    { width: 1200, key: "Enter", expectedStep: 250 },
    { width: 1200, key: "Escape", expectedStep: 100 },
    { width: 375, key: "Enter", expectedStep: 250 },
    { width: 375, key: "Escape", expectedStep: 100 },
  ])("preserves $key editing inside more at $width px", async ({ width, key, expectedStep }) => {
    mockWidth = width;
    const configuration = makeMockAppConfiguration([[AppSetting.SEEK_STEP_MS, 100]]);
    const onEditingChange = jest.fn();
    render(
      <AppConfigurationContext.Provider value={configuration}>
        <ToolbarFixture seekStep={<SeekStepControls onEditingChange={onEditingChange} />} />
      </AppConfigurationContext.Provider>,
    );
    const trigger = screen.getByRole("button", { name: "More timeline tools" });
    fireEvent.click(trigger);
    const more = screen.getByRole("dialog", { name: "More timeline tools" });
    const input = within(more).getByRole<HTMLInputElement>("textbox", { name: "Step size" });
    fireEvent.focus(input);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(input, { target: { value: "0.25" } });
    fireEvent.keyDown(input, { key });

    expect(configuration.get(AppSetting.SEEK_STEP_MS)).toBe(expectedStep);
    expect(within(more).getByRole("textbox", { name: "Step size" })).toBe(input);
    expect(input.value).toBe(String(expectedStep / 1000));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("dialog", { name: "More timeline tools" })).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "More timeline tools" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    fireEvent.click(trigger);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Step size" }).value).toBe(
      String(expectedStep / 1000),
    );
  });
});
