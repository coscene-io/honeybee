/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import TimelineScrollbar from "./TimelineScrollbar";
import { makeTimelineViewport, type TimelineViewport } from "./timelineViewport";

describe("<TimelineScrollbar />", () => {
  // Visible window 20-40 of a 0-100 recording: thumb covers 20% of the track starting at 20%.
  const zoomedViewport: TimelineViewport = {
    ...makeTimelineViewport(0, 100),
    visibleStartSec: 20,
    visibleEndSec: 40,
  };

  function mockTrackRect(track: HTMLElement): void {
    jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
      bottom: 12,
      height: 8,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  function firePointerEvent(target: Element | Window, type: string, clientX: number): void {
    fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("positions the thumb to mirror the visible window", () => {
    render(<TimelineScrollbar viewport={zoomedViewport} onScroll={jest.fn()} />);

    const thumb = screen.getByTestId("timeline-scrollbar-thumb");
    expect(thumb.style.left).toBe("20%");
    expect(thumb.style.width).toBe("20%");
    expect(thumb.getAttribute("role")).toBe("scrollbar");
    // Progress through the scrollable range: 0.2 / (1 - 0.2) = 25%.
    expect(thumb.getAttribute("aria-valuenow")).toBe("25");
  });

  it("centers the visible window under a track click", () => {
    const onScroll = jest.fn();
    render(<TimelineScrollbar viewport={zoomedViewport} onScroll={onScroll} />);

    const track = screen.getByTestId("timeline-scrollbar");
    mockTrackRect(track);

    // Click at 75% of the track: the 20s window should recenter there → starts at 65s.
    firePointerEvent(track, "pointerdown", 150);

    expect(onScroll).toHaveBeenLastCalledWith(65);
  });

  it("pans the visible window while dragging the thumb", () => {
    const onScroll = jest.fn();
    render(<TimelineScrollbar viewport={zoomedViewport} onScroll={onScroll} />);

    const track = screen.getByTestId("timeline-scrollbar");
    mockTrackRect(track);

    // Grab the thumb (its left edge sits at 40px) and drag right by 40px (= 20s of a 100s range).
    firePointerEvent(track, "pointerdown", 50);
    firePointerEvent(window, "pointermove", 90);

    expect(onScroll).toHaveBeenLastCalledWith(40);

    // Releasing detaches the window listeners so later moves are ignored.
    firePointerEvent(window, "pointerup", 90);
    onScroll.mockClear();
    firePointerEvent(window, "pointermove", 10);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it("clamps the visible window to the recording bounds", () => {
    const onScroll = jest.fn();
    render(<TimelineScrollbar viewport={zoomedViewport} onScroll={onScroll} />);

    const track = screen.getByTestId("timeline-scrollbar");
    mockTrackRect(track);

    // Click far past the right edge: the window can start no later than 80s (100s - 20s window).
    firePointerEvent(track, "pointerdown", 400);

    expect(onScroll).toHaveBeenLastCalledWith(80);
  });

  it("can pan to the end when the thumb is clamped to its minimum width", () => {
    // Visible window 95-100 of 100: proportional thumb is 5% (10px on a 200px track), so the 24px
    // minimum kicks in and the thumb travel is 200 - 24 = 176px (not the full track).
    const onScroll = jest.fn();
    const endViewport: TimelineViewport = {
      ...makeTimelineViewport(0, 100),
      visibleStartSec: 95,
      visibleEndSec: 100,
    };
    render(<TimelineScrollbar viewport={endViewport} onScroll={onScroll} />);

    const track = screen.getByTestId("timeline-scrollbar");
    mockTrackRect(track);

    // Thumb sits at its rightmost (left 176px); grabbing its center (188px) must keep it at the end
    // rather than snapping backward (the bug was emitting ~88 because it divided by full width).
    fireEvent(track, new MouseEvent("pointerdown", { bubbles: true, clientX: 188 }));

    expect(onScroll).toHaveBeenLastCalledWith(95);
  });

  it("pans with the keyboard when the thumb is focused", () => {
    const onScroll = jest.fn();
    render(<TimelineScrollbar viewport={zoomedViewport} onScroll={onScroll} />);

    const thumb = screen.getByTestId("timeline-scrollbar-thumb");
    expect(thumb.getAttribute("tabindex")).toBe("0");

    // Window is 20-40 (duration 20); ArrowRight nudges by 10% of the window = 2s → starts at 22.
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onScroll).toHaveBeenLastCalledWith(22);

    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    expect(onScroll).toHaveBeenLastCalledWith(18);

    // PageDown advances a full window width.
    fireEvent.keyDown(thumb, { key: "PageDown" });
    expect(onScroll).toHaveBeenLastCalledWith(40);

    fireEvent.keyDown(thumb, { key: "Home" });
    expect(onScroll).toHaveBeenLastCalledWith(0);

    fireEvent.keyDown(thumb, { key: "End" });
    expect(onScroll).toHaveBeenLastCalledWith(100);
  });

  it("ignores interaction when disabled", () => {
    const onScroll = jest.fn();
    render(<TimelineScrollbar viewport={zoomedViewport} onScroll={onScroll} disabled />);

    const track = screen.getByTestId("timeline-scrollbar");
    mockTrackRect(track);

    firePointerEvent(track, "pointerdown", 150);
    fireEvent.keyDown(screen.getByTestId("timeline-scrollbar-thumb"), { key: "End" });

    expect(onScroll).not.toHaveBeenCalled();
    // Disabled scrollbar drops out of the tab order.
    expect(screen.getByTestId("timeline-scrollbar-thumb").getAttribute("tabindex")).toBe("-1");
  });
});
