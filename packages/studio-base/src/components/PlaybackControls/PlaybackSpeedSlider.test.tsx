/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import PlaybackSpeedSlider, {
  PLAYBACK_SPEED_SLIDER_RESET_TEST_ID,
  PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID,
} from "./PlaybackSpeedSlider";

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

function renderSlider(
  overrides: {
    value?: 1 | 1.5 | 10;
    onPreview?: jest.Mock;
    onCommit?: jest.Mock;
    onCancel?: jest.Mock;
    onReset?: jest.Mock;
  } = {},
) {
  const onPreview = overrides.onPreview ?? jest.fn();
  const onCommit = overrides.onCommit ?? jest.fn();
  const onCancel = overrides.onCancel ?? jest.fn();

  const { unmount } = render(
    <ThemeProvider isDark>
      <PlaybackSpeedSlider
        value={overrides.value ?? 1}
        ariaLabel="Playback speed"
        onPreview={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
        reset={
          overrides.onReset != undefined
            ? { label: "Reset to default", onReset: overrides.onReset }
            : undefined
        }
      />
    </ThemeProvider>,
  );

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

  return { track, onPreview, onCommit, onCancel, unmount };
}

function clientXForIndex(index: number): number {
  return TRACK_LEFT + 10 + (index / 25) * (TRACK_WIDTH - 20);
}

describe("<PlaybackSpeedSlider />", () => {
  it("previews while dragging and commits on pointerup", () => {
    const { track, onPreview, onCommit, onCancel } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onPreview).toHaveBeenCalledWith(1.5);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(25), buttons: 1 });
    expect(onPreview).toHaveBeenCalledWith(10);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(25) });
    expect(onCommit).toHaveBeenCalledWith(10);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("invokes onReset from the header reset button", () => {
    const onReset = jest.fn();
    renderSlider({ onReset });

    fireEvent.click(screen.getByTestId(PLAYBACK_SPEED_SLIDER_RESET_TEST_ID));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("stops the active drag before resetting", () => {
    const onReset = jest.fn();
    const { track, onPreview, onCommit, onCancel } = renderSlider({ onReset });
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    fireEvent.click(screen.getByTestId(PLAYBACK_SPEED_SLIDER_RESET_TEST_ID));
    onPreview.mockClear();

    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(8), buttons: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("preserves the preview when the opening transition moves under a stationary pointer", () => {
    const { track, onPreview, onCommit } = renderSlider();
    const rect = track.getBoundingClientRect();
    jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
      bottom: 54,
      height: 14,
      left: 150,
      width: 125,
      right: 275,
      top: 40,
      x: 150,
      y: 40,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 228.6 });
    expect(onPreview).toHaveBeenLastCalledWith(5.5);
    jest.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 228.6, buttons: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 228.6 });
    expect(onPreview).toHaveBeenLastCalledWith(5.5);
    expect(onCommit).toHaveBeenCalledWith(5.5);
  });

  it("uses a new release coordinate even without an intermediate move event", () => {
    const { track, onCommit } = renderSlider();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(16) });
    expect(onCommit).toHaveBeenCalledWith(5.5);
  });

  it.each([0, 25])("keeps endpoint thumb %s stable without movement", (index) => {
    const { track, onPreview, onCommit } = renderSlider();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(index) });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(index) });
    const expected = index === 0 ? 0.01 : 10;
    expect(onPreview).toHaveBeenCalledWith(expected);
    expect(onCommit).toHaveBeenCalledWith(expected);
  });

  it("hides the reset button when no reset handler is provided", () => {
    renderSlider();

    expect(screen.queryByTestId(PLAYBACK_SPEED_SLIDER_RESET_TEST_ID)).toBeNull();
  });

  it("commits and ends the drag when a move reports no buttons pressed (lost pointerup)", () => {
    const { track, onPreview, onCommit, onCancel } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onPreview).toHaveBeenCalledWith(1.5);

    // The pointerup was lost (released outside the window): the next hover move reports
    // buttons 0, so the drag commits there instead of following the cursor forever.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(25), buttons: 0 });
    expect(onCommit).toHaveBeenCalledWith(10);
    expect(onCancel).not.toHaveBeenCalled();

    onPreview.mockClear();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(0), buttons: 0 });
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("ignores a secondary button release while the primary button stays held", () => {
    const { track, onPreview, onCommit } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(16), buttons: 1 });

    // Right button released mid-drag: buttons still reports the held primary button.
    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: clientXForIndex(16),
      button: 2,
      buttons: 1,
    });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(25), buttons: 1 });
    expect(onPreview).toHaveBeenCalledWith(10);

    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(25), buttons: 0 });
    expect(onCommit).toHaveBeenCalledWith(10);
  });

  it.each([2, 4])("ends the drag when only secondary buttons %s remain pressed", (buttons) => {
    const { track, onPreview, onCommit } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: clientXForIndex(16),
      buttons: 1 | buttons,
    });
    // Chorded button releases are pointermove events until the last button is released.
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: clientXForIndex(16),
      button: 0,
      buttons,
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5.5);
    onPreview.mockClear();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(25), buttons });
    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: clientXForIndex(25),
      button: buttons === 2 ? 2 : 1,
    });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("maps pointer positions against the layout size while the popover scales open", () => {
    const { track, onPreview } = renderSlider();

    // Mid Grow transition the rendered rect is half the layout size (offsetWidth stays 250).
    jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
      bottom: 54,
      height: 14,
      left: 150,
      right: 275,
      top: 40,
      width: 125,
      x: 150,
      y: 40,
      toJSON: () => ({}),
    });

    // Layout x for index 16 is 10 + (16 / 25) * (250 - 20) = 157.2, rendered at
    // clientX 150 + 157.2 * 0.5 = 228.6.
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 228.6 });
    expect(onPreview).toHaveBeenCalledWith(5.5);
  });

  it("cancels the preview when unmounted mid-drag", () => {
    const { track, onCommit, onCancel, unmount } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    unmount();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not cancel on unmount when no drag is in progress", () => {
    const { onCancel, unmount } = renderSlider();
    unmount();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels an in-progress drag on pointercancel", () => {
    const { track, onCommit, onCancel } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels an in-progress drag on Escape", () => {
    const { track, onCommit, onCancel } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(25) });
    fireEvent.keyDown(track, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits immediately when arrow keys step the focused slider", () => {
    const { track, onPreview, onCommit } = renderSlider({ value: 1 });

    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(onPreview).toHaveBeenCalledWith(1.5);
    expect(onCommit).toHaveBeenCalledWith(1.5);

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(onPreview).toHaveBeenCalledWith(0.8);
    expect(onCommit).toHaveBeenCalledWith(0.8);
  });

  it("does not bubble arrow keydown to document-level listeners", () => {
    const { track } = renderSlider({ value: 1 });
    const onDocumentKeyDown = jest.fn();
    document.addEventListener("keydown", onDocumentKeyDown);

    try {
      fireEvent.keyDown(track, { key: "ArrowRight" });
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });

  it("ignores pointer events from a different pointer than the one that started the drag", () => {
    const { track, onPreview, onCommit, onCancel } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onPreview).toHaveBeenCalledWith(1.5);

    fireEvent.pointerMove(window, { pointerId: 2, clientX: clientXForIndex(25) });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: clientXForIndex(25) });
    fireEvent.pointerCancel(window, { pointerId: 2 });

    expect(onPreview).not.toHaveBeenCalledWith(10);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onCommit).toHaveBeenCalledWith(1.5);
  });

  it("ends an in-progress drag when a keyboard commit happens", () => {
    const { track, onCommit } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    fireEvent.keyDown(track, { key: "End" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(10);

    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits the first and last presets on Home and End", () => {
    const { track, onPreview, onCommit } = renderSlider({ value: 1 });
    const onDocumentKeyDown = jest.fn();
    document.addEventListener("keydown", onDocumentKeyDown);

    try {
      fireEvent.keyDown(track, { key: "Home" });
      expect(onPreview).toHaveBeenCalledWith(0.01);
      expect(onCommit).toHaveBeenCalledWith(0.01);

      fireEvent.keyDown(track, { key: "End" });
      expect(onPreview).toHaveBeenCalledWith(10);
      expect(onCommit).toHaveBeenCalledWith(10);
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });

  it("does not render particle animation inside the track fill", () => {
    const { track } = renderSlider();
    const fill = track.firstElementChild;

    expect(fill).not.toBeNull();
    expect(fill!.querySelectorAll("span")).toHaveLength(0);
  });
});
