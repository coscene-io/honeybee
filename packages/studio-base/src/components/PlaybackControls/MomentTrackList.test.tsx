/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { MomentTrackList } from "./MomentTrackList";
import type { MomentTrackLayout } from "./momentTracks";

function layout(count: number): MomentTrackLayout {
  return {
    items: [],
    laneCount: count,
    rows: Array.from({ length: count }, (_, lane) => ({
      lane,
      laneCount: 1,
      collapsed: false,
      track: {
        id: `track/${lane}`,
        title: `Option ${lane}`,
        fieldName: "Platform",
        depth: 0,
        kind: "value",
        count: 1,
        events: [],
        children: [],
      },
    })),
  };
}

it("virtualizes leaf labels against the shared scroll container", async () => {
  const onViewChange = jest.fn();
  let scrollOffset = 0;
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.testid === "moment-track-list" ? -scrollOffset : 0;
    return {
      x: 0,
      y: top,
      top,
      bottom: top + 200,
      left: 0,
      right: 220,
      width: 220,
      height: 200,
      toJSON: () => ({}),
    };
  });
  render(
    <ThemeProvider isDark>
      <div data-timeline-scroll-container data-testid="scroll">
        <MomentTrackList layout={layout(400)} view={{}} onViewChange={onViewChange} />
      </div>
    </ThemeProvider>,
  );
  expect(screen.getAllByTestId("moment-track-title").length).toBeLessThan(15);
  expect(screen.queryByRole("button")).toBeNull();
  act(() => {
    scrollOffset = 2800;
    fireEvent.scroll(screen.getByTestId("scroll"));
  });
  await waitFor(() => {
    expect(screen.getByText("Platform: Option 100 (1)")).toBeTruthy();
  });
  expect(screen.queryByText("Platform: Option 0 (1)")).toBeNull();
  expect(screen.getAllByTestId("moment-track-title").length).toBeLessThan(15);
});

it("only offers a toggle on a group with children", () => {
  const grouped = layout(2);
  const parent = grouped.rows[0]!.track;
  const leaf = grouped.rows[1]!.track;
  parent.children = [leaf];
  parent.count = 2;
  leaf.depth = 1;
  const onViewChange = jest.fn();
  render(
    <ThemeProvider isDark>
      <MomentTrackList layout={grouped} view={{}} onViewChange={onViewChange} />
    </ThemeProvider>,
  );
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByText("Platform: Option 1 (1)"));
  expect(onViewChange).not.toHaveBeenCalled();
  const toggle = screen.getByRole("button", { name: "Expand or collapse Platform: Option 0" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(toggle);
  expect(onViewChange).toHaveBeenCalledWith({ collapsed: { [parent.id]: true } });
});

it.each(["value", "missing", "ungrouped"] as const)(
  "renders a %s leaf without an interactive toggle, including saved collapse state",
  (kind) => {
    const leafLayout = layout(1);
    leafLayout.rows[0]!.track.kind = kind;
    leafLayout.rows[0]!.collapsed = true;
    const onViewChange = jest.fn();
    render(
      <ThemeProvider isDark>
        <MomentTrackList
          layout={leafLayout}
          view={{ collapsed: { "track/0": true } }}
          onViewChange={onViewChange}
        />
      </ThemeProvider>,
    );
    const row = screen.getByTestId("moment-track-title");
    expect(row.querySelector("button, [aria-expanded], [tabindex]")).toBeNull();
    fireEvent.click(row);
    expect(onViewChange).not.toHaveBeenCalled();
  },
);
