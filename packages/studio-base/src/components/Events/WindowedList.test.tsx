/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { WindowedList } from "./WindowedList";

function StatefulRow({ name }: { name: string }): React.JSX.Element {
  const [value, setValue] = useState(0);
  return (
    <button
      onClick={() => {
        setValue(value + 1);
      }}
    >
      {name}:{value}
    </button>
  );
}

it("windows rows, locates unmounted IDs and retains the active row's state", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} />);
  expect(screen.getAllByRole("button").length).toBeLessThan(15);
  fireEvent.pointerDown(screen.getByText("row-0:0"));
  fireEvent.click(screen.getByText("row-0:0"));
  rerender(<WindowedList items={items} scrollToKey="row-900" />);
  expect(screen.getByText("row-900:0")).toBeDefined();
  expect(screen.getByText("row-0:1")).toBeDefined();
  expect(screen.getAllByRole("button").length).toBeLessThan(16);
  rerender(<WindowedList items={items} scrollToKey="row-0" />);
  expect(screen.getByText("row-0:1")).toBeDefined();
});

it("windows horizontal cards and removes stale pinned rows when the data changes", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 168,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} horizontal />);
  expect(screen.getAllByRole("button").length).toBeLessThan(10);
  fireEvent.pointerDown(screen.getByText("row-0:0"));
  rerender(<WindowedList items={items.slice(500)} horizontal scrollToKey="row-999" />);
  expect(screen.queryByText("row-0:0")).toBeNull();
  expect(screen.getByText("row-999:0")).toBeDefined();
});

it("preserves the visible item when estimates change with the display mode", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} scrollToKey="row-800" />);
  rerender(<WindowedList items={items} />);
  const visibleBefore = screen.getAllByRole("button").map((button) => button.textContent);
  const compact = items.map((item) => ({ ...item, estimatedSize: 50 }));
  rerender(<WindowedList items={compact} resetKey="compact" />);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(
    expect.arrayContaining(visibleBefore),
  );
});

describe("resize delivery", () => {
  let notifications: Map<Element, () => void>;
  let frames: Map<number, FrameRequestCallback>;
  let rectangles: Map<Element, { width: number; height: number }>;
  const items = Array.from({ length: 20 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));

  beforeEach(() => {
    notifications = new Map();
    frames = new Map();
    rectangles = new Map();
    let nextFrame = 0;
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    jest.spyOn(window, "ResizeObserver").mockImplementation((callback) => {
      const observed = new Set<Element>();
      const observer: ResizeObserver = {
        observe(element) {
          observed.add(element);
          notifications.set(element, () => {
            callback([], observer);
          });
        },
        unobserve(element) {
          observed.delete(element);
          notifications.delete(element);
        },
        disconnect() {
          for (const element of observed) {
            notifications.delete(element);
          }
        },
      };
      return observer;
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const { width = 0, height = 0 } = rectangles.get(this) ?? {};
      return DOMRect.fromRect({ width, height });
    });
  });

  function flushFrame() {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => {
      callbacks.forEach((callback) => {
        callback(0);
      });
    });
  }

  it("coalesces row resizes outside observer delivery and uses the latest height", () => {
    render(<WindowedList items={items} />);
    const measuredRow = screen.getByText("row-0:0").parentElement!;
    const nextRow = screen.getByText("row-1:0").parentElement!.parentElement!;
    act(() => {
      rectangles.set(measuredRow, { width: 300, height: 140 });
      notifications.get(measuredRow)!();
      rectangles.set(measuredRow, { width: 300, height: 180 });
      notifications.get(measuredRow)!();
    });
    expect(nextRow.style.top).toBe("100px");
    expect(frames.size).toBe(1);
    flushFrame();
    expect(nextRow.style.top).toBe("180px");

    // Focusing/pinning a row must not reconnect unchanged observers.
    const observeCount = jest.mocked(window.ResizeObserver).mock.calls.length;
    fireEvent.pointerDown(screen.getByText("row-0:0"));
    expect(jest.mocked(window.ResizeObserver).mock.calls).toHaveLength(observeCount);
  });

  it("defers container resizes and cancels pending row/container work on unmount", () => {
    const { container, unmount } = render(<WindowedList items={items} />);
    const root = container.firstElementChild!;
    const viewport = root.firstElementChild as HTMLElement;
    const measuredRow = screen.getByText("row-0:0").parentElement!;
    act(() => {
      rectangles.set(root, { width: 420, height: 720 });
      notifications.get(root)!();
      notifications.get(root)!();
    });
    expect(viewport.style.width).toBe("300px");
    expect(frames.size).toBe(1);
    flushFrame();
    expect(viewport.style.width).toBe("420px");
    expect(viewport.style.height).toBe("720px");

    act(() => {
      notifications.get(root)!();
      notifications.get(measuredRow)!();
    });
    expect(frames.size).toBe(2);
    unmount();
    expect(frames.size).toBe(0);
    expect(notifications.size).toBe(0);
  });

  it("cancels measurements for rows replaced by a new dataset", () => {
    const { rerender } = render(<WindowedList items={items} />);
    const measuredRow = screen.getByText("row-0:0").parentElement!;
    act(() => {
      rectangles.set(measuredRow, { width: 300, height: 200 });
      notifications.get(measuredRow)!();
    });
    rerender(<WindowedList items={items.slice(10)} />);
    expect(frames.size).toBe(0);
    expect(notifications.has(measuredRow)).toBe(false);
    flushFrame();
    expect(screen.getByText("row-11:0").parentElement!.parentElement!.style.top).toBe("100px");
  });
});
