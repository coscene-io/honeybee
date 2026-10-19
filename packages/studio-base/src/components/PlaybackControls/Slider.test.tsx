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

  it("coalesces drag seek changes and flushes the final pointer-up position", () => {
    const onChange = jest.fn();
    const onHoverOver = jest.fn();
    render(
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider
            cursor="pointer"
            onChange={onChange}
            onHoverOver={onHoverOver}
            viewport={makeTimelineViewport(0, 10)}
          />
        </MockMessagePipelineProvider>
      </ThemeProvider>,
    );

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);

    firePointerEvent(slider, "pointerdown", 100);
    firePointerEvent(window, "pointermove", 300);
    firePointerEvent(window, "pointermove", 600);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onHoverOver).not.toHaveBeenCalled();

    act(flushAnimationFrames);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(6);
    expect(onHoverOver).toHaveBeenCalledTimes(1);
    expect(onHoverOver).toHaveBeenLastCalledWith({
      playbackSeconds: 6,
      clientX: 600,
      clientY: 25,
    });
    firePointerEvent(window, "pointermove", 700);
    firePointerEvent(window, "pointerup", 900);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(9);
    act(flushAnimationFrames);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("cancels pending seeks on pointer cancellation", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider cursor="pointer" onChange={onChange} viewport={makeTimelineViewport(0, 10)} />
        </MockMessagePipelineProvider>
      </ThemeProvider>,
    );

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);
    firePointerEvent(slider, "pointerdown", 100);
    firePointerEvent(window, "pointermove", 600);
    firePointerEvent(window, "pointercancel", 700);
    act(flushAnimationFrames);
    firePointerEvent(window, "pointerup", 900);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("seeks once per click and does not repeat an already applied drag position on release", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider cursor="pointer" onChange={onChange} viewport={makeTimelineViewport(0, 10)} />
        </MockMessagePipelineProvider>
      </ThemeProvider>,
    );

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);
    firePointerEvent(slider, "pointerdown", 100);
    firePointerEvent(window, "pointerup", 100);
    expect(onChange).toHaveBeenCalledTimes(1);

    firePointerEvent(slider, "pointerdown", 100);
    expect(onChange).toHaveBeenCalledTimes(2);
    firePointerEvent(window, "pointermove", 500);
    act(flushAnimationFrames);
    expect(onChange).toHaveBeenCalledTimes(3);
    firePointerEvent(window, "pointerup", 500);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("discards a pending move when release returns to the last applied position", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider isDark>
        <MockMessagePipelineProvider
          startTime={{ sec: 100, nsec: 0 }}
          currentTime={{ sec: 105, nsec: 0 }}
          endTime={{ sec: 110, nsec: 0 }}
        >
          <Slider cursor="pointer" onChange={onChange} viewport={makeTimelineViewport(0, 10)} />
        </MockMessagePipelineProvider>
      </ThemeProvider>,
    );

    const slider = screen.getByTestId("scrubber-slider");
    mockSliderRect(slider);
    firePointerEvent(slider, "pointerdown", 100);
    firePointerEvent(window, "pointermove", 500);
    firePointerEvent(window, "pointerup", 100);
    act(flushAnimationFrames);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(1);
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
