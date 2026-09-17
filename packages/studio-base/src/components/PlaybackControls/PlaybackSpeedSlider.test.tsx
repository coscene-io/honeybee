/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import PlaybackSpeedSlider, { PLAYBACK_SPEED_SLIDER_TRACK_TEST_ID } from "./PlaybackSpeedSlider";

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
  } = {},
) {
  const onPreview = overrides.onPreview ?? jest.fn();
  const onCommit = overrides.onCommit ?? jest.fn();
  const onCancel = overrides.onCancel ?? jest.fn();

  render(
    <ThemeProvider isDark>
      <PlaybackSpeedSlider
        value={overrides.value ?? 1}
        ariaLabel="Playback speed"
        onPreview={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
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

  return { track, onPreview, onCommit, onCancel };
}

function clientXForIndex(index: number): number {
  return TRACK_LEFT + (index / 25) * TRACK_WIDTH;
}

describe("<PlaybackSpeedSlider />", () => {
  it("previews while dragging and commits on pointerup", () => {
    const { track, onPreview, onCommit, onCancel } = renderSlider();

    fireEvent.pointerDown(track, { pointerId: 1, clientX: clientXForIndex(8) });
    expect(onPreview).toHaveBeenCalledWith(1.5);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { pointerId: 1, clientX: clientXForIndex(25) });
    expect(onPreview).toHaveBeenCalledWith(10);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 1, clientX: clientXForIndex(25) });
    expect(onCommit).toHaveBeenCalledWith(10);
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
});
