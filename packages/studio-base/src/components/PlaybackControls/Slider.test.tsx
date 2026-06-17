/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import Slider from "./Slider";
import { makeTimelineViewport } from "./timelineViewport";

const viewport = makeTimelineViewport(0, 10);

function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <MockMessagePipelineProvider
        startTime={{ sec: 0, nsec: 0 }}
        currentTime={{ sec: 1, nsec: 0 }}
      >
        {children}
      </MockMessagePipelineProvider>
    </ThemeProvider>
  );
}

function renderSlider(props: Partial<React.ComponentProps<typeof Slider>> = {}): HTMLElement {
  render(
    <Wrapper>
      <Slider cursor="pointer" onChange={jest.fn()} viewport={viewport} {...props} />
    </Wrapper>,
  );

  const slider = screen.getByTestId("scrubber-slider");
  jest.spyOn(slider, "getBoundingClientRect").mockReturnValue({
    bottom: 80,
    height: 40,
    left: 100,
    right: 300,
    top: 40,
    width: 200,
    x: 100,
    y: 40,
    toJSON: () => ({}),
  });
  return slider;
}

describe("<Slider />", () => {
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

  function firePointerEvent(target: EventTarget, type: string, clientX: number): void {
    fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));
  }

  it("coalesces hover pointer moves to the latest event once per animation frame", () => {
    const onHoverOver = jest.fn();
    const slider = renderSlider({ onHoverOver });

    firePointerEvent(slider, "pointermove", 120);
    firePointerEvent(slider, "pointermove", 200);
    firePointerEvent(slider, "pointermove", 300);

    expect(onHoverOver).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

    act(flushAnimationFrames);

    expect(onHoverOver).toHaveBeenCalledTimes(1);
    expect(onHoverOver).toHaveBeenLastCalledWith({
      playbackSeconds: 10,
      clientX: 300,
      clientY: 45,
    });

    firePointerEvent(slider, "pointermove", 150);
    act(flushAnimationFrames);

    expect(onHoverOver).toHaveBeenCalledTimes(2);
    expect(onHoverOver).toHaveBeenLastCalledWith({
      playbackSeconds: 2.5,
      clientX: 150,
      clientY: 45,
    });
  });

  it("cancels pending hover updates when the pointer leaves", () => {
    const onHoverOver = jest.fn();
    const onHoverOut = jest.fn();
    const slider = renderSlider({ onHoverOver, onHoverOut });

    fireEvent.mouseEnter(slider);
    firePointerEvent(slider, "pointermove", 200);
    fireEvent.mouseLeave(slider);
    act(flushAnimationFrames);

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onHoverOver).not.toHaveBeenCalled();
    expect(onHoverOut).toHaveBeenCalledTimes(1);
  });

  it("cancels pending hover updates when unmounted", () => {
    const onHoverOver = jest.fn();
    const { unmount } = render(
      <Wrapper>
        <Slider
          cursor="pointer"
          onChange={jest.fn()}
          onHoverOver={onHoverOver}
          viewport={viewport}
        />
      </Wrapper>,
    );
    const slider = screen.getByTestId("scrubber-slider");
    jest.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      bottom: 80,
      height: 40,
      left: 100,
      right: 300,
      top: 40,
      width: 200,
      x: 100,
      y: 40,
      toJSON: () => ({}),
    });

    firePointerEvent(slider, "pointermove", 200);
    unmount();
    act(flushAnimationFrames);

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onHoverOver).not.toHaveBeenCalled();
  });

  it("keeps drag seek changes immediate while hover updates are frame-coalesced", () => {
    const onChange = jest.fn();
    const onHoverOver = jest.fn();
    const slider = renderSlider({ onChange, onHoverOver });

    firePointerEvent(slider, "pointerdown", 120);
    firePointerEvent(window, "pointermove", 160);
    firePointerEvent(window, "pointermove", 220);

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, 1);
    expect(onChange).toHaveBeenNthCalledWith(2, 3);
    expect(onChange).toHaveBeenNthCalledWith(3, 6);
    expect(onHoverOver).not.toHaveBeenCalled();

    act(flushAnimationFrames);

    expect(onHoverOver).toHaveBeenCalledTimes(1);
    expect(onHoverOver).toHaveBeenLastCalledWith({
      playbackSeconds: 6,
      clientX: 220,
      clientY: 45,
    });
  });
});
