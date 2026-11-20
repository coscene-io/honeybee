/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import Slider, { type HoverOverEvent } from "./Slider";
import { type TimelineViewport, makeTimelineViewport } from "./timelineViewport";

function renderSlider({
  onHoverOver,
  onHoverOut,
  viewport,
}: {
  onHoverOver?: (event: HoverOverEvent) => void;
  onHoverOut?: () => void;
  viewport: TimelineViewport;
}): void {
  render(
    <ThemeProvider isDark>
      <MockMessagePipelineProvider
        startTime={{ sec: 100, nsec: 0 }}
        currentTime={{ sec: 105, nsec: 0 }}
        endTime={{ sec: 110, nsec: 0 }}
      >
        <Slider
          cursor="pointer"
          onChange={jest.fn()}
          onHoverOver={onHoverOver}
          onHoverOut={onHoverOut}
          viewport={viewport}
        />
      </MockMessagePipelineProvider>
    </ThemeProvider>,
  );
}

describe("Slider", () => {
  let frameCallbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  function flushAnimationFrames(): void {
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    for (const callback of callbacks) {
      callback(performance.now());
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
    frameCallbacks = new Map();
    nextFrameId = 0;

    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frameId = ++nextFrameId;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });

    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
      frameCallbacks.delete(frameId);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function mockSliderRect(slider: HTMLElement): void {
    jest.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      bottom: 140,
      height: 120,
      left: 0,
      right: 1000,
      top: 20,
      width: 1000,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    });
  }

  function firePointerEvent(target: Element | Window, type: string, clientX: number): void {
    fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));
  }

  it("renders the current time indicator using the Figma time locator shape", () => {
    renderSlider({ viewport: makeTimelineViewport(0, 10) });

    const indicator = screen.getByTestId("playback-current-time-indicator");
    const svg = indicator.querySelector("svg");

    expect(indicator.style.left).toBe("50%");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 9 129");
  });

  it("anchors hover events to the top flag handle", () => {
    const onHoverOver = jest.fn();
    renderSlider({ onHoverOver, viewport: makeTimelineViewport(0, 10) });

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);

    fireEvent(
      slider,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 500,
        clientY: 80,
      }),
    );
    act(flushAnimationFrames);

    expect(onHoverOver).toHaveBeenCalledWith({
      playbackSeconds: 5,
      clientX: 500,
      clientY: 25,
    });
  });

  it("coalesces hover pointer moves to the latest event once per animation frame", () => {
    const onHoverOver = jest.fn();
    renderSlider({ onHoverOver, viewport: makeTimelineViewport(0, 10) });

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);

    firePointerEvent(slider, "pointermove", 120);
    firePointerEvent(slider, "pointermove", 200);
    firePointerEvent(slider, "pointermove", 300);

    expect(onHoverOver).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

    act(flushAnimationFrames);

    expect(onHoverOver).toHaveBeenCalledTimes(1);
    expect(onHoverOver).toHaveBeenLastCalledWith({
      playbackSeconds: 3,
      clientX: 300,
      clientY: 25,
    });
  });

  it("cancels pending hover updates when the pointer leaves", () => {
    const onHoverOver = jest.fn();
    const onHoverOut = jest.fn();
    render(
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider
            cursor="pointer"
            onChange={jest.fn()}
            onHoverOut={onHoverOut}
            onHoverOver={onHoverOver}
            viewport={makeTimelineViewport(0, 10)}
          />
        </MockMessagePipelineProvider>
      </ThemeProvider>,
    );

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);

    fireEvent.mouseEnter(slider);
    firePointerEvent(slider, "pointermove", 200);
    fireEvent.mouseLeave(slider, { relatedTarget: document.body });
    act(flushAnimationFrames);

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onHoverOver).not.toHaveBeenCalled();
    expect(onHoverOut).toHaveBeenCalledTimes(1);
  });

  it("cancels pending hover updates when unmounted", () => {
    const onHoverOver = jest.fn();
    const onHoverOut = jest.fn();
    const { unmount } = render(
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider
            cursor="pointer"
            onChange={jest.fn()}
            onHoverOver={onHoverOver}
            onHoverOut={onHoverOut}
            viewport={makeTimelineViewport(0, 10)}
          />
        </MockMessagePipelineProvider>
      </ThemeProvider>,
    );

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);

    firePointerEvent(slider, "pointermove", 200);
    unmount();
    fireEvent(window, new Event("blur"));
    fireEvent(document, new MouseEvent("pointerout", { bubbles: true }));
    act(flushAnimationFrames);

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onHoverOver).not.toHaveBeenCalled();
    expect(onHoverOut).not.toHaveBeenCalled();
  });

  it.each(["pointerout", "mouseout", "blur", "visibilitychange"])(
    "cancels the slider's pending hover on %s without an element leave event",
    (eventType) => {
      const onHoverOver = jest.fn();
      const onHoverOut = jest.fn();
      const visibility = jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      renderSlider({ onHoverOver, onHoverOut, viewport: makeTimelineViewport(0, 10) });
      const slider = screen.getByTestId("scrubber-slider");
      mockSliderRect(slider);

      firePointerEvent(slider, "pointermove", 200);
      if (eventType === "blur") {
        fireEvent(window, new Event(eventType));
      } else if (eventType === "visibilitychange") {
        fireEvent(document, new Event(eventType));
      } else {
        fireEvent(document, new MouseEvent(eventType, { bubbles: true }));
      }
      act(flushAnimationFrames);

      expect(onHoverOver).not.toHaveBeenCalled();
      expect(onHoverOut).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue("visible");
      firePointerEvent(slider, "pointermove", 300);
      act(flushAnimationFrames);
      expect(onHoverOver).toHaveBeenLastCalledWith({
        playbackSeconds: 3,
        clientX: 300,
        clientY: 25,
      });
    },
  );

  function advance(ms: number): void {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
  }

  type Availability = "ready" | "blocked" | "disabled";

  function renderScrub(availability: Availability = "ready") {
    const onChange = jest.fn<void, [number]>();
    const onHoverOver = jest.fn();
    const viewport = makeTimelineViewport(0, 10);
    const element = (state: Availability) => (
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider
            cursor="pointer"
            disabled={state === "disabled"}
            seekBlocked={state === "blocked"}
            onChange={onChange}
            onHoverOver={onHoverOver}
            viewport={viewport}
          />
        </MockMessagePipelineProvider>
      </ThemeProvider>
    );
    const { rerender, unmount } = render(element(availability));
    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);
    return {
      onChange,
      onHoverOver,
      down(x: number) {
        firePointerEvent(slider, "pointerdown", x);
      },
      move(x: number) {
        firePointerEvent(window, "pointermove", x);
      },
      up(x: number) {
        firePointerEvent(window, "pointerup", x);
      },
      setAvailability(state: Availability) {
        rerender(element(state));
      },
      unmount,
    };
  }

  it("previews every frame, seeks to the latest target every 500 ms and flushes on release", () => {
    const scrub = renderScrub();
    const indicator = screen.getByTestId("playback-current-time-indicator");
    scrub.down(100);
    expect(scrub.onChange.mock.calls).toEqual([[1]]);

    scrub.move(300);
    scrub.move(600);
    act(flushAnimationFrames);
    expect(indicator.style.left).toBe("60%");
    expect(scrub.onHoverOver).toHaveBeenLastCalledWith({
      playbackSeconds: 6,
      clientX: 600,
      clientY: 25,
    });

    advance(499);
    expect(scrub.onChange.mock.calls).toEqual([[1]]);
    scrub.move(700);
    advance(1);
    expect(scrub.onChange.mock.calls).toEqual([[1], [7]]);

    scrub.move(800);
    advance(500);
    scrub.move(400);
    scrub.up(900);
    advance(1000);
    expect(scrub.onChange.mock.calls).toEqual([[1], [7], [8], [9]]);
  });

  it("keeps tracking while recovery starts and respects the remaining cooldown on unlock", () => {
    const scrub = renderScrub();
    scrub.down(100);
    scrub.setAvailability("blocked");
    scrub.move(400);
    act(flushAnimationFrames);
    expect(screen.getByTestId("playback-current-time-indicator").style.left).toBe("40%");
    advance(300);
    scrub.setAvailability("ready");
    scrub.move(800);
    advance(199);
    expect(scrub.onChange.mock.calls).toEqual([[1]]);
    advance(1);
    scrub.up(800);
    expect(scrub.onChange.mock.calls).toEqual([[1], [8]]);
  });

  it("replaces a locked release with the newest gesture and clamps release outside the slider", () => {
    const scrub = renderScrub("blocked");
    scrub.down(100);
    scrub.up(900);
    scrub.down(600);
    scrub.move(800);
    advance(750);
    scrub.up(-100);
    expect(screen.getByTestId("playback-current-time-indicator").style.left).toBe("0%");
    expect(scrub.onChange).not.toHaveBeenCalled();
    scrub.setAvailability("ready");
    expect(scrub.onChange.mock.calls).toEqual([[0]]);
  });

  it.each(["pointercancel", "blur", "disabled", "unmount"])(
    "discards a pending target on %s",
    (reason) => {
      const scrub = renderScrub();
      scrub.down(100);
      scrub.move(600);
      if (reason === "disabled") {
        scrub.setAvailability("blocked");
        scrub.up(900);
        scrub.setAvailability("disabled");
        scrub.setAvailability("ready");
      } else if (reason === "unmount") {
        scrub.unmount();
      } else {
        firePointerEvent(window, reason, 700);
        scrub.up(900);
      }
      advance(1000);
      expect(scrub.onChange.mock.calls).toEqual([[1]]);
    },
  );

  it("seeks once per click and discards a move when released back at the last sent position", () => {
    const scrub = renderScrub();
    scrub.down(100);
    scrub.up(100);
    scrub.down(100);
    scrub.move(500);
    scrub.up(100);
    advance(500);
    expect(scrub.onChange.mock.calls).toEqual([[1], [1]]);
  });

  it("does not render the current time indicator outside the visible viewport", () => {
    renderSlider({
      viewport: {
        totalStartSec: 0,
        totalEndSec: 10,
        visibleStartSec: 6,
        visibleEndSec: 10,
      },
    });

    expect(screen.queryByTestId("playback-current-time-indicator")).toBeNull();
  });
});
