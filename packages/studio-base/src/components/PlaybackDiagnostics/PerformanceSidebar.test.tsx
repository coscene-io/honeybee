/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen, fireEvent } from "@testing-library/react";

import { makeTimelineViewport } from "@foxglove/studio-base/components/PlaybackControls/timelineViewport";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import {
  PlaybackDiagnostics,
  PlaybackDiagnosticsContext,
} from "@foxglove/studio-base/services/playbackDiagnostics";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { DiagnosticPreview } from "./DiagnosticPreview";
import { PerformanceSidebar } from "./PerformanceSidebar";

it("previews historical findings only during interaction and clears on close", () => {
  const session = new PlaybackDiagnostics();
  session.record({
    topic: "/camera",
    kind: "gap",
    duration: 2,
    start: 18000000000n,
    end: 20000000000n,
  });
  session.record({
    topic: "/camera",
    kind: "gap",
    duration: 2,
    start: 30000000000n,
    end: 32000000000n,
  });
  const config = makeMockAppConfiguration();
  function view(state: "open" | "closed") {
    return (
      <AppConfigurationContext.Provider value={config}>
        <PlaybackDiagnosticsContext.Provider value={session}>
          {state === "open" && <PerformanceSidebar />}
          <DiagnosticPreview
            startTime={{ sec: 0, nsec: 0 }}
            viewport={makeTimelineViewport(0, 60)}
          />
        </PlaybackDiagnosticsContext.Provider>
      </AppConfigurationContext.Provider>
    );
  }
  const { rerender } = render(view("closed"));
  expect(screen.queryByTestId("diagnostic-preview")).toBeNull();
  rerender(view("open"));
  fireEvent.click(screen.getByRole("button", { name: /Long keyframe interval/ }));
  const [row, other] = screen.getAllByRole("listitem") as [HTMLElement, HTMLElement];
  expect(row.textContent).toContain("18.000 s");
  fireEvent.mouseEnter(row);
  expect(screen.getByTestId("diagnostic-preview")).toBeTruthy();
  fireEvent.mouseLeave(row);
  expect(screen.queryByTestId("diagnostic-preview")).toBeNull();
  fireEvent.focus(row);
  fireEvent.mouseEnter(other);
  expect(screen.getByTestId("diagnostic-preview").style.left).toBe("50%");
  fireEvent.mouseLeave(other);
  expect(screen.getByTestId("diagnostic-preview").style.left).toBe("30%");
  fireEvent.mouseEnter(row);
  fireEvent.blur(row);
  expect(screen.getByTestId("diagnostic-preview").style.left).toBe("30%");
  rerender(view("closed"));
  expect(screen.queryByTestId("diagnostic-preview")).toBeNull();
  expect(session.topic("/camera").findings.get("gap")?.size).toBe(2);
});

it("shows timed-out seek attempts before a bound image topic's first frame", () => {
  const session = new PlaybackDiagnostics();
  session.bind("3d", "/camera");
  const panel = session.panel("3d", "/camera");
  panel.pending = { seek: { sequence: 1, started: 0, target: { sec: 1, nsec: 0 } } };
  session.expire(panel, 10000);
  render(
    <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
      <PlaybackDiagnosticsContext.Provider value={session}>
        <PerformanceSidebar />
      </PlaybackDiagnosticsContext.Provider>
    </AppConfigurationContext.Provider>,
  );
  expect(screen.getByText("Successful / cancelled / timed out · 0 / 0 / 1")).toBeTruthy();
});
