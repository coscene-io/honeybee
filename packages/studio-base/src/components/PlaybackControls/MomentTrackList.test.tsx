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

it("collapses by stable identity and virtualizes labels against the shared scroll container", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "Expand or collapse Platform: Option 0" }));
  expect(onViewChange).toHaveBeenCalledWith({ collapsed: { "track/0": true } });
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
