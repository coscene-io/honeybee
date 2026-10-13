/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import KeyListener from "@foxglove/studio-base/components/KeyListener";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import {
  PLAYBACK_SPEED_SLIDER_RESET_TEST_ID,
  PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID,
} from "@foxglove/studio-base/components/PlaybackControls/PlaybackSpeedSlider";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import PlaybackSpeedControls from "./PlaybackSpeedControls";

// jsdom 26 does not implement PointerEvent, so fireEvent.pointer* would otherwise
// construct a generic Event without clientX.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;

    public constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }

  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
}

const TRACK_LEFT = 100;
const TRACK_WIDTH = 250;

function SpeedObserver(): React.JSX.Element {
  const speed = useWorkspaceStore((store) => store.playbackControls.speed);
  return <div data-testid="committed-speed">{speed}</div>;
}

function renderControls(): HTMLElement {
  render(
    <ThemeProvider isDark>
      <WorkspaceContextProvider
        disablePersistence
        initialState={{ playbackControls: { repeat: false, speed: 1 } }}
      >
        <MockMessagePipelineProvider>
          <PlaybackSpeedControls />
          <SpeedObserver />
        </MockMessagePipelineProvider>
      </WorkspaceContextProvider>
    </ThemeProvider>,
  );

  fireEvent.click(screen.getByTestId("PlaybackSpeedControls-Dropdown"));
  const track = screen.getByTestId(PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID);
  jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
    bottom: 68,
    height: 28,
    left: TRACK_LEFT,
    right: TRACK_LEFT + TRACK_WIDTH,
    top: 40,
    width: TRACK_WIDTH,
    x: TRACK_LEFT,
    y: 40,
    toJSON: () => ({}),
  });
  // jsdom has no layout, so offsetWidth is always 0 — mirror the mocked rect width.
  Object.defineProperty(track, "offsetWidth", { configurable: true, value: TRACK_WIDTH });
  return track;
}

function clientXForIndex(index: number): number {
  return TRACK_LEFT + 10 + (index / 25) * (TRACK_WIDTH - 20);
}

describe("<PlaybackSpeedControls />", () => {
  it("opens a slider popover instead of a menu", () => {
    renderControls();
    expect(screen.getByRole("slider")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Playback speed" })).toBeTruthy();
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").getAttribute("aria-haspopup")).toBe(
      "dialog",
    );
  });

  it("focuses the slider when the popover opens", () => {
    const track = renderControls();
    expect(document.activeElement).toBe(track);
  });

  it("does not commit workspace speed while dragging", () => {
    const track = renderControls();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(25), buttons: 1 });
    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("10×");
  });

  it("commits workspace speed on pointerup", () => {
    const track = renderControls();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(screen.getByTestId("committed-speed").textContent).toBe("1.5");
  });

  it("resets to 1× when the reset button is clicked", () => {
    const track = renderControls();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(screen.getByTestId("committed-speed").textContent).toBe("1.5");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("1.5×");

    fireEvent.click(screen.getByTestId(PLAYBACK_SPEED_SLIDER_RESET_TEST_ID));

    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("1×");
    // The popover stays open so the slider can be adjusted again right away.
    expect(screen.getByTestId(PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID)).toBeTruthy();
  });

  it("clears an in-progress preview when the reset button is clicked", () => {
    const track = renderControls();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("10×");

    fireEvent.click(screen.getByTestId(PLAYBACK_SPEED_SLIDER_RESET_TEST_ID));

    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("1×");
  });

  it("activates reset with Space without invoking global playback shortcuts", () => {
    const onSpace = jest.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    render(<KeyListener global keyDownHandlers={{ Space: onSpace }} />);
    const track = renderControls();
    fireEvent.keyDown(track, { key: "End" });
    expect(screen.getByTestId("committed-speed").textContent).toBe("10");
    const resetButton = screen.getByTestId(PLAYBACK_SPEED_SLIDER_RESET_TEST_ID);
    act(() => {
      resetButton.focus();
    });
    expect(fireEvent.keyDown(resetButton, { key: " ", code: "Space" })).toBe(true);
    fireEvent.keyUp(resetButton, { key: " ", code: "Space" });
    // jsdom does not synthesize the native button click after Space.
    fireEvent.click(resetButton);
    expect(onSpace).not.toHaveBeenCalled();
    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
  });

  it("restores the committed speed when an in-progress drag is cancelled", () => {
    const track = renderControls();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    fireEvent.keyDown(track, { key: "Escape" });
    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("1×");
  });

  it("does not commit a cancelled drag during the popover exit transition", () => {
    const track = renderControls();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    // A second contact can close the popover while the first pointer is still down.
    const backdrop = document.querySelector(".MuiBackdrop-root")!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(16), buttons: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(16) });
    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
    expect(screen.getByTestId("PlaybackSpeedControls-Dropdown").textContent).toBe("1×");
  });

  it("closes the popover on Escape when no drag is in progress", async () => {
    const track = renderControls();
    fireEvent.keyDown(track, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId(PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID)).toBeNull();
    });
    expect(screen.getByTestId("committed-speed").textContent).toBe("1");
  });
});
