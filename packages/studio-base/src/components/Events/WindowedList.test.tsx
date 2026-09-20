/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";

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
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-900" }} />);
  expect(screen.getByText("row-900:0")).toBeDefined();
  expect(screen.getByText("row-0:1")).toBeDefined();
  expect(screen.getAllByRole("button").length).toBeLessThan(16);
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-0" }} />);
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
  rerender(<WindowedList items={items.slice(500)} horizontal scrollRequest={{ key: "row-999" }} />);
  expect(screen.queryByText("row-0:0")).toBeNull();
  expect(screen.getByText("row-999:0")).toBeDefined();
});

it("excludes retained controls from Tab and restores their original tabindex when visible", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: (
      <div>
        <button>row-{index}</button>
        <a href="#" target="_self" tabIndex={2}>
          link-{index}
        </a>
        <button tabIndex={-1}>excluded-{index}</button>
      </div>
    ),
  }));
  const { rerender } = render(<WindowedList items={items} />);
  const button = screen.getByText("row-0");
  fireEvent.pointerDown(button);
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-900" }} />);
  expect(button.tabIndex).toBe(-1);
  expect(screen.getByText("link-0").tabIndex).toBe(-1);
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-0" }} />);
  expect(button.hasAttribute("tabindex")).toBe(false);
  expect(screen.getByText("link-0").tabIndex).toBe(2);
  expect(screen.getByText("excluded-0").tabIndex).toBe(-1);
});

it("preserves focused controls and reveals a retained row when focus is restored", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} />);
  const button = screen.getByText("row-0:0");
  act(() => {
    button.focus();
  });
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-900" }} />);
  expect(document.activeElement).toBe(button);
  expect(button.tabIndex).toBe(-1);
  act(() => {
    button.blur();
    button.focus();
  });
  expect(document.activeElement).toBe(button);
  expect(button.tabIndex).toBe(0);
  expect(screen.queryByText("row-900:0")).toBeNull();
});

it("leaves portalled controls usable without revealing their retained row", () => {
  function PortalRow() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setOpen(true);
          }}
        >
          open portal
        </button>
        {open && createPortal(<button>portal control</button>, document.body)}
      </>
    );
  }
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: index === 0 ? <PortalRow /> : <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} />);
  fireEvent.pointerDown(screen.getByText("open portal"));
  fireEvent.click(screen.getByText("open portal"));
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-900" }} />);
  const portal = screen.getByText("portal control");
  act(() => {
    portal.focus();
  });
  expect(portal.tabIndex).toBe(0);
  expect(document.activeElement).toBe(portal);
  expect(screen.getByText("row-900:0")).toBeDefined();
  expect(screen.getByText("open portal").tabIndex).toBe(-1);
});

it("tracks dynamic controls and tabindex changes only while a row is retained", async () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender, unmount } = render(<WindowedList items={items} />);
  const button = screen.getByText("row-0:0");
  fireEvent.pointerDown(button);
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-900" }} />);
  const dynamic = document.createElement("button");
  await act(async () => {
    button.parentElement!.append(dynamic);
  });
  expect(dynamic.tabIndex).toBe(-1);
  await act(async () => {
    dynamic.tabIndex = 3;
  });
  expect(dynamic.tabIndex).toBe(-1);
  await act(async () => {
    document.body.append(dynamic);
  });
  expect(dynamic.tabIndex).toBe(3);
  dynamic.remove();

  // A pending application write must not be overwritten by layout-effect cleanup.
  button.setAttribute("tabindex", "-1");
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-0" }} />);
  expect(button.tabIndex).toBe(-1);
  await act(async () => {
    button.tabIndex = 4;
  });
  expect(button.tabIndex).toBe(4);
  fireEvent.pointerDown(button);
  rerender(<WindowedList items={items} scrollRequest={{ key: "row-900" }} />);
  unmount();
  expect(button.tabIndex).toBe(4);
});

it("preserves the visible item when estimates change with the display mode", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} scrollRequest={{ key: "row-800" }} />);
  rerender(<WindowedList items={items} />);
  const visibleBefore = screen.getAllByRole("button").map((button) => button.textContent);
  const compact = items.map((item) => ({ ...item, estimatedSize: 50 }));
  rerender(<WindowedList items={compact} resetKey="compact" />);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(
    expect.arrayContaining(visibleBefore),
  );
});

it("keeps an automatic target visible when mounted rows are much taller than estimated", () => {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({
      width: 300,
      height: this.firstElementChild?.tagName === "BUTTON" ? 1000 : 0,
    });
  });
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { container } = render(<WindowedList items={items} scrollRequest={{ key: "row-800" }} />);
  const target = screen.getByText("row-800:0").parentElement!.parentElement!;
  const viewport = container.firstElementChild!.firstElementChild as HTMLElement;
  expect(parseFloat(target.style.top)).toBeLessThan(viewport.scrollTop + 600);
  expect(parseFloat(target.style.top) + 1000).toBeGreaterThan(viewport.scrollTop);
  expect(screen.getAllByRole("button").length).toBeLessThan(15);
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

  it.each([6, 15])("reserves a %i px native horizontal scrollbar below the cards", (size) => {
    let scrollbarSize = size;
    jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      const height = parseFloat(this.style.height);
      return Number.isNaN(height) ? 0 : height;
    });
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.offsetHeight - (this.style.overflow === "auto" ? scrollbarSize : 0);
    });
    const { container, unmount } = render(<WindowedList items={items} horizontal />);
    const root = container.firstElementChild as HTMLElement;
    const viewport = root.firstElementChild as HTMLElement;
    expect(viewport.clientHeight).toBe(50);
    expect(root.style.height).toBe(`${50 + size}px`);

    // Overlay scrollbars and disappearance of overflow must release the extra space.
    act(() => {
      scrollbarSize = 0;
      notifications.get(viewport)!();
    });
    flushFrame();
    expect(viewport.style.height).toBe("50px");
    expect(root.style.height).toBe("50px");
    act(() => {
      notifications.get(viewport)!();
    });
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

  it("keeps restored focus visible when a later resize follows an old automatic target", () => {
    const { container, rerender } = render(<WindowedList items={items} />);
    const button = screen.getByText("row-0:0");
    act(() => {
      button.focus();
    });
    rerender(<WindowedList items={items} scrollRequest={{ key: "row-10" }} />);
    act(() => {
      button.blur();
      button.focus();
    });
    const viewport = container.firstElementChild!.firstElementChild as HTMLElement;
    expect(viewport.scrollTop).toBe(0);
    const measuredRow = button.parentElement!;
    act(() => {
      rectangles.set(measuredRow, { width: 300, height: 180 });
      notifications.get(measuredRow)!();
    });
    flushFrame();
    expect(viewport.scrollTop).toBe(0);
    expect(document.activeElement).toBe(button);
    expect(screen.queryByText("row-10:0")).toBeNull();
  });

  it.each(["manual scroll", "cleared target"])(
    "stops measurement-driven automatic positioning after %s",
    (cancellation) => {
      const { container, rerender } = render(
        <WindowedList items={items} scrollRequest={{ key: "row-10" }} />,
      );
      const viewport = container.firstElementChild!.firstElementChild as HTMLElement;
      if (cancellation === "manual scroll") {
        Object.defineProperties(viewport, {
          clientHeight: { value: 600 },
          scrollHeight: { value: 2000 },
        });
        fireEvent.scroll(viewport, { target: { scrollTop: 400 } });
      } else {
        rerender(<WindowedList items={items} />);
      }
      const offset = viewport.scrollTop;
      const measuredRow = screen.getByText(
        cancellation === "manual scroll" ? "row-4:0" : "row-10:0",
      ).parentElement!;
      act(() => {
        rectangles.set(measuredRow, { width: 300, height: 400 });
        notifications.get(measuredRow)!();
      });
      flushFrame();
      expect(viewport.scrollTop).toBe(offset);
    },
  );
});
