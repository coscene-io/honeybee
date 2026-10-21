/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import EventEmitter from "eventemitter3";
import { deserialize, serialize } from "v8";

import { fromNanoSec } from "@foxglove/rostime";
import { BuiltinPanelExtensionContext } from "@foxglove/studio-base/components/PanelExtensionAdapter";

import { IRenderer } from "../IRenderer";
import { SpatialAnnotationEditor } from "./SpatialAnnotationEditor";
import { clampAnnotationFrame } from "./model";

Object.defineProperty(globalThis, "structuredClone", {
  configurable: true,
  value: (value: unknown) => deserialize(serialize(value)) as unknown,
});

function fixture() {
  let playing = false;
  const viewport = {
    topic: "/camera",
    displayedTimeNs: 100_000_000n,
    imageWidth: 1280,
    imageHeight: 720,
    project: (point: { x: number; y: number }) => point,
    unproject: (point: { x: number; y: number }) => point,
  };
  const renderer = Object.assign(new EventEmitter(), {
    currentTime: 100_000_000n,
    startTime: 0n,
    endTime: 5_033_333_333n,
    getImageAnnotationViewport: () => viewport,
    measurementTool: { stopMeasuring: jest.fn() },
    publishClickTool: { stop: jest.fn() },
  });
  const seekPlayback = jest.fn();
  const context = {
    seekPlayback,
    unstable_getPlaybackIsPlaying: () => playing,
    unstable_pausePlayback: jest.fn(() => {
      playing = false;
    }),
  } as unknown as BuiltinPanelExtensionContext;
  const props = {
    renderer: renderer as unknown as IRenderer,
    context,
    canvas: document.createElement("canvas"),
    scope: crypto.randomUUID(),
    topic: "/camera",
    isPlaying: false,
    onActiveChange: jest.fn(),
  };
  return {
    renderer,
    viewport,
    props,
    seekPlayback,
    setPlaying: (value: "playing" | "paused") => {
      playing = value === "playing";
    },
  };
}

it("snaps after playback stops off-grid even when stopping emits no further renderer frame", async () => {
  const { renderer, viewport, props, seekPlayback, setPlaying } = fixture();
  const { rerender } = render(<SpatialAnnotationEditor {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByText("Annotate · mock"));
  });
  seekPlayback.mockClear();
  setPlaying("playing");
  rerender(<SpatialAnnotationEditor {...props} isPlaying />);
  act(() => {
    renderer.currentTime = 5_033_333_333n;
    viewport.displayedTimeNs = 4_966_666_667n;
    renderer.emit("endFrame");
  });
  expect(seekPlayback).not.toHaveBeenCalled();
  setPlaying("paused");
  rerender(<SpatialAnnotationEditor {...props} isPlaying={false} />);
  expect(seekPlayback).toHaveBeenCalledWith(fromNanoSec(4_900_000_000n));
  act(() => {
    renderer.currentTime = 4_900_000_000n;
    viewport.displayedTimeNs = 4_900_000_000n;
    renderer.emit("endFrame");
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("application").style.cursor).not.toBe("wait");
});

it("stops waiting on an uncompleted seek and provides an explicit retry", async () => {
  jest.useFakeTimers();
  try {
    const { renderer, props, seekPlayback } = fixture();
    render(<SpatialAnnotationEditor {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Annotate · mock"));
    });
    seekPlayback.mockClear();
    act(() => {
      renderer.currentTime = 233_333_333n;
      renderer.emit("endFrame");
    });
    expect(seekPlayback).toHaveBeenCalledWith(fromNanoSec(200_000_000n));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("alert").textContent).toContain("did not finish loading");
    expect(seekPlayback).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Retry frame"));
    expect(seekPlayback).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("application").style.cursor).not.toBe("wait");
  } finally {
    jest.useRealTimers();
  }
});

it("bounds annotation navigation at a source ending between grid ticks", () => {
  expect(clampAnnotationFrame(50, 0n, 4_966_666_667n)).toBe(49);
  expect(clampAnnotationFrame(51, 0n, 5_033_333_333n)).toBe(50);
  expect(clampAnnotationFrame(-1, 10_000_000_000n)).toBe(0);
});
