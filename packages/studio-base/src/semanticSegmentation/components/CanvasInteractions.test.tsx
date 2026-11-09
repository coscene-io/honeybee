/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import KeyListener from "@foxglove/studio-base/components/KeyListener";

import { createMockSemanticSegmentationService, createSeedDocument } from "../mockService";
import { frameInstanceKey } from "../service";
import { createSemanticSegmentationStore } from "../store";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { SubmissionControls } from "./WorkflowControls";

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  button = 0,
  modifiers: MouseEventInit = {},
): void {
  fireEvent(
    target,
    new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, ...modifiers }),
  );
}
/** Click (press + release without moving) on a vertex handle. */
function clickVertex(
  canvas: Element,
  handle: Element,
  x: number,
  y: number,
  modifiers: MouseEventInit = {},
): void {
  pointer(handle, "pointerdown", x, y, 0, modifiers);
  pointer(canvas, "pointerup", x, y, 0, modifiers);
}

async function setup(fitScale = 0.5) {
  localStorage.clear();
  const document = createSeedDocument();
  document.frames = document.frames.slice(0, 2);
  document.annotations = Object.fromEntries(
    Object.entries(document.annotations).filter(([, a]) =>
      document.frames.some((f) => f.id === a.frameId),
    ),
  );
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({ document, controls: { delayMs: 0 } }),
  );
  await store.getState().initialize();
  store.getState().setFocus({ type: "instance", id: "instance-1" });
  store.getState().setEditing(true);
  // Model the real SVG viewBox's fit matrix, including letterbox offset and the current content transform.
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value(this: SVGElement) {
      const transform = this.getAttribute("transform")?.match(
        /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/,
      );
      const zoom = Number(transform?.[3] ?? 1);
      return {
        a: fitScale * zoom,
        b: 0,
        c: 0,
        d: fitScale * zoom,
        e: 100 + Number(transform?.[1] ?? 0) * fitScale,
        f: 50 + Number(transform?.[2] ?? 0) * fitScale,
      };
    },
  });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(SVGElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(SVGElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: jest.fn(function (this: SVGElement) {
      this.dispatchEvent(new Event("lostpointercapture", { bubbles: true }));
    }),
  });
  const result = render(<SegmentationCanvas store={store} />);
  const viewport = screen.getByRole("group", { name: "Annotation viewport" });
  Object.defineProperty(viewport, "getBoundingClientRect", {
    value: () => ({ x: 100, y: 50, width: 480, height: 270 }),
  });
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  const content = () => canvas.querySelector("g[transform]")!;
  const transform = () => content().getAttribute("transform");
  const points = () =>
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons[0]!
      .points;
  const handle = () =>
    screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" });
  return { ...result, store, viewport, canvas, content, transform, points, handle };
}

it("anchors normalized wheel zoom under the cursor with bounds and creates no history", async () => {
  const { canvas, content, store } = await setup();
  const before = store.getState().document;
  const anchor = { x: 0.25 * 960, y: 0.4 * 540 };
  const client = { clientX: 100 + anchor.x * 0.5, clientY: 50 + anchor.y * 0.5 };
  fireEvent.wheel(canvas, { ...client, deltaY: -3, deltaMode: 1, cancelable: true });
  let matrix = (content() as SVGGraphicsElement).getScreenCTM()!;
  expect(matrix.a * anchor.x + matrix.e).toBeCloseTo(client.clientX);
  expect(matrix.d * anchor.y + matrix.f).toBeCloseTo(client.clientY);
  expect(matrix.a).toBeGreaterThan(0.5);
  for (let i = 0; i < 10; i++) {
    fireEvent.wheel(canvas, { ...client, deltaY: -10000 });
  }
  matrix = (content() as SVGGraphicsElement).getScreenCTM()!;
  expect(matrix.a).toBe(16);
  expect(store.getState().document).toBe(before);
  expect(store.getState().stagedOperations).toHaveLength(0);
});

it.each(["space", "middle", "right"])(
  "pans over a vertex with %s without geometry edits or history",
  async (gesture) => {
    const { viewport, canvas, transform, handle, store } = await setup();
    const before = store.getState().document;
    if (gesture === "space") {
      fireEvent.keyDown(viewport, { key: " " });
      pointer(canvas, "pointermove", 175, 125);
      fireEvent.pointerEnter(handle());
      expect(canvas.style.cursor).toBe("grab");
    }
    const button = gesture === "middle" ? 1 : gesture === "right" ? 2 : 0;
    pointer(handle(), "pointerdown", 180, 130, button);
    pointer(canvas, "pointermove", 230, 160, button);
    pointer(canvas, "pointerup", 230, 160, button);
    expect(transform()).toBe("translate(100 60) scale(1)");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(store.getState().document).toBe(before);
    expect(store.getState().stagedOperations).toHaveLength(0);
    fireEvent.keyUp(window, { key: " " });
  },
);

it("opens a contextual vertex menu for a right click and never for a right drag returning to origin", async () => {
  const { canvas, handle, points, store } = await setup();
  const x = points()[0]!.x * 480 + 100,
    y = points()[0]!.y * 270 + 50;
  pointer(handle(), "pointerdown", x, y, 2);
  pointer(canvas, "pointerup", x + 1, y, 2);
  expect(screen.getByRole("menuitem", { name: "Delete vertex" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  pointer(handle(), "pointerdown", x, y, 2);
  pointer(canvas, "pointermove", x + 10, y, 2);
  pointer(canvas, "pointermove", x, y, 2);
  pointer(canvas, "pointerup", x, y, 2);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(store.getState().stagedOperations).toHaveLength(0);
});

it.each(["pointercancel", "blur", "visibility"])(
  "discards geometry preview after %s and accepts the next gesture",
  async (cancel) => {
    const { canvas, handle, points, store } = await setup();
    const original = points();
    pointer(handle(), "pointerdown", 180, 130);
    pointer(canvas, "pointermove", 230, 160);
    if (cancel === "blur") {
      fireEvent.blur(window);
    } else if (cancel === "visibility") {
      const hidden = jest.spyOn(document, "hidden", "get").mockReturnValue(true);
      fireEvent(document, new Event("visibilitychange"));
      hidden.mockRestore();
    } else {
      fireEvent(canvas, new Event(cancel, { bubbles: true }));
    }
    pointer(canvas, "pointerup", 230, 160);
    expect(points()).toEqual(original);
    expect(store.getState().stagedOperations).toHaveLength(0);
    pointer(handle(), "pointerdown", 180, 130);
    pointer(canvas, "pointermove", 230, 160);
    pointer(canvas, "pointerup", 230, 160);
    expect(store.getState().stagedOperations).toHaveLength(1);
  },
);

it("clears a stale preview when a drag returns inside the click threshold", async () => {
  const { canvas, handle, points, store } = await setup();
  const original = points();
  pointer(handle(), "pointerdown", 180, 130);
  pointer(canvas, "pointermove", 230, 160);
  pointer(canvas, "pointermove", 181, 130);
  pointer(canvas, "pointerup", 181, 130);
  expect(points()).toEqual(original);
  expect(store.getState().stagedOperations).toHaveLength(0);
});

it("keeps a fast vertex drag when image size discovery interrupts before release", async () => {
  const { container, canvas, handle, points, store } = await setup();
  const original = points();
  pointer(handle(), "pointerdown", 180, 130);
  pointer(canvas, "pointermove", 230, 160);
  const image = container.querySelector('img[alt=""]')!;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1920 });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: 1080 });
  await act(async () => {
    fireEvent.load(image);
  });
  pointer(canvas, "pointerup", 230, 160);
  expect(points()).not.toEqual(original);
  expect(store.getState().stagedOperations).toHaveLength(1);
});

it("commits a vertex drag when pointer capture is lost before pointerup", async () => {
  const { canvas, handle, points, store } = await setup();
  const original = points();
  pointer(handle(), "pointerdown", 180, 130);
  pointer(canvas, "pointermove", 230, 160);
  await act(async () => {
    handle().dispatchEvent(new Event("lostpointercapture", { bubbles: true }));
  });
  expect(points()).not.toEqual(original);
  expect(store.getState().stagedOperations).toHaveLength(1);
  pointer(canvas, "pointerup", 230, 160);
  expect(store.getState().stagedOperations).toHaveLength(1);
});

it("preserves a drawing draft through temporary pan, peek, cancellation and contextual navigation", async () => {
  const { store, viewport, canvas, content } = await setup();
  act(() => {
    store.getState().addPolygon("instance-1");
  });
  pointer(canvas, "pointerdown", 150, 100);
  pointer(canvas, "pointerdown", 250, 100);
  pointer(canvas, "pointerdown", 200, 200);
  const expectDraftStyle = () => {
    const scale = (content() as SVGGraphicsElement).getScreenCTM()!.a;
    const outline = canvas.querySelector("polyline")!;
    expect(Number(outline.getAttribute("stroke-width")) * scale).toBeCloseTo(4 / 3);
    const dots = outline.parentElement!.querySelectorAll("circle");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(Number(dot.getAttribute("r")) * 2 * scale).toBeCloseTo(10.5);
    }
  };
  expectDraftStyle();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expectDraftStyle();
  const count = store.getState().stagedOperations.length;
  fireEvent.keyDown(viewport, { key: " " });
  pointer(canvas, "pointerdown", 150, 100);
  pointer(canvas, "pointermove", 170, 120);
  fireEvent.blur(window);
  fireEvent.keyDown(viewport, { key: "o" });
  pointer(canvas, "pointerdown", 220, 220);
  fireEvent.keyUp(window, { key: "o" });
  pointer(canvas, "pointerdown", 150, 100, 2);
  pointer(canvas, "pointerup", 150, 100, 2);
  expect(screen.queryByRole("menuitem", { name: "Delete vertex" })).toBeNull();
  expect(
    screen.getByRole("menuitem", { name: "Finish polygon" }).getAttribute("aria-disabled"),
  ).not.toBe("true");
  expect(store.getState().stagedOperations).toHaveLength(count);
  fireEvent.click(screen.getByRole("menuitem", { name: "Finish polygon" }));
  const polygons =
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons;
  expect(polygons.at(-1)!.points).toHaveLength(3);
});

it("uses a single composite Tab entry, constant 10.5px dots, no keyboard ring and 1/10 image pixel nudges", async () => {
  const { viewport, canvas, content, handle, points, store } = await setup();
  const original = points()[0]!;
  expect(viewport.tabIndex).toBe(0);
  expect(canvas.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
  expect(handle().getAttribute("tabindex")).toBe("-1");
  const core = screen.getAllByTestId("vertex-handle-visible")[0]!;
  const scale = () => (content() as SVGGraphicsElement).getScreenCTM()!.a;
  const visualDiameter = () =>
    (Number(core.getAttribute("r")) * 2 + Number(core.getAttribute("stroke-width"))) * scale();
  expect(core.getAttribute("data-selected")).toBe("false");
  expect(visualDiameter()).toBeCloseTo(10.5);
  // Arrow keys never select a point; a click does.
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  expect(core.getAttribute("data-selected")).toBe("false");
  expect(points()[0]).toEqual(original);
  clickVertex(canvas, handle(), 180, 130);
  expect(core.getAttribute("data-selected")).toBe("true");
  expect(visualDiameter()).toBeCloseTo(10.5);
  fireEvent.pointerEnter(handle());
  expect(core.getAttribute("data-highlighted")).toBe("true");
  expect(visualDiameter()).toBeCloseTo(10.5);
  expect(screen.queryByTestId("vertex-focus-ring")).toBeNull();
  const expectHitArea = () => {
    expect(visualDiameter()).toBeCloseTo(10.5);
    expect(Number(handle().getAttribute("r")) * scale() * 2).toBeCloseTo(16);
  };
  expectHitArea();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expectHitArea();
  // The selected point moves directly, with no Enter / point-editing step.
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  fireEvent.keyDown(viewport, { key: "ArrowDown", shiftKey: true });
  expect(points()[0]!.x).toBeCloseTo(original.x + 2 / 960);
  expect(points()[0]!.y).toBeCloseTo(original.y + 10 / 540);
  expect(screen.getByText(/Point 1 \(/)).toBeTruthy();
  fireEvent.keyDown(viewport, { key: "Escape" });
  const history = store.getState().stagedOperations.length;
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  expect(store.getState().stagedOperations).toHaveLength(history);
  expect(fireEvent.keyDown(viewport, { key: "Tab" })).toBe(true);
});

it.each([
  { key: "F10", shiftKey: true, direction: "ArrowRight", removed: 0, next: 0 },
  { key: "ContextMenu", shiftKey: false, direction: "ArrowLeft", removed: 3, next: 2 },
])(
  "deletes the selected vertex via the $key menu key and keeps the neighbouring point selected",
  async (keys) => {
    const { viewport, points, store } = await setup();
    const square = [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.4, y: 0.4 },
      { x: 0.1, y: 0.4 },
    ];
    act(() => {
      store.getState().setPolygonPoints("instance-1-polygon-0", square);
      viewport.focus();
    });
    const history = store.getState().stagedOperations.length;
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    clickVertex(
      canvas,
      screen.getByRole("button", {
        name: `Vertex ${keys.removed + 1} of polygon instance-1-polygon-0`,
      }),
      148,
      keys.removed === 0 ? 77 : 158,
    );
    expect(screen.getByText(new RegExp(`^Point ${keys.removed + 1} \\(`))).toBeTruthy();
    fireEvent.keyDown(viewport, { key: keys.key, shiftKey: keys.shiftKey });
    const focus = screen.getByRole("menuitem", { name: "Focus polygon" });
    await waitFor(() => {
      expect(document.activeElement).toBe(focus);
    });
    fireEvent.keyDown(focus, { key: "ArrowDown" });
    const remove = screen.getByRole("menuitem", { name: "Delete vertex" });
    expect(document.activeElement).toBe(remove);
    fireEvent.keyDown(remove, { key: "Enter" });
    await waitFor(() => {
      expect(document.activeElement).toBe(viewport);
    });
    expect(points()).toEqual(square.filter((_point, i) => i !== keys.removed));
    expect(store.getState().stagedOperations).toHaveLength(history + 1);
    expect(screen.getByText(new RegExp(`^Point ${keys.next + 1} \\(`))).toBeTruthy();
    // Arrows move the selected point instead of selecting another one.
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(screen.getByText(new RegExp(`^Point ${keys.next + 1} \\(`))).toBeTruthy();
    expect(store.getState().stagedOperations).toHaveLength(history + 2);
  },
);

it.each(["minimum", "readonly", "draft", "running", "stopping"] as const)(
  "keeps the keyboard vertex menu safe during %s",
  async (mode) => {
    const { viewport, points, store } = await setup();
    act(() => {
      store.getState().setPolygonPoints("instance-1-polygon-0", [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.1 },
        { x: 0.4, y: 0.4 },
      ]);
      viewport.focus();
    });
    clickVertex(
      screen.getByRole("img", { name: "Frame polygons" }),
      screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" }),
      148,
      77,
    );
    act(() => {
      if (mode === "readonly") {
        store.setState({ readonly: true });
      } else if (mode === "draft") {
        store.getState().addPolygon("instance-1");
      } else if (mode === "running" || mode === "stopping") {
        store.setState({ propagation: { status: mode, processedFrames: 0 } });
      }
    });
    const before = points();
    const history = store.getState().stagedOperations;
    fireEvent.keyDown(viewport, { key: "F10", shiftKey: true });
    if (mode === "minimum") {
      expect(
        screen.getByRole("menuitem", { name: "Delete vertex" }).getAttribute("aria-disabled"),
      ).toBe("true");
    } else {
      expect(screen.queryByRole("menuitem", { name: "Delete vertex" })).toBeNull();
    }
    if (mode === "running" || mode === "stopping") {
      expect(screen.queryByRole("menu")).toBeNull();
    }
    expect(points()).toEqual(before);
    expect(store.getState().stagedOperations).toBe(history);
  },
);

it("retains the view across same-video frame/image changes and resets for a new video or record", async () => {
  const { store, canvas, transform, rerender } = await setup();
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 200, clientY: 150 });
  const zoomed = transform();
  act(() => {
    store.getState().setCurrentFrame("frame-1");
  });
  rerender(<SegmentationCanvas store={store} imageUrl="decoded-next-frame" />);
  expect(transform()).toBe(zoomed);
  act(() => {
    const doc = store.getState().document!;
    store.setState({
      document: { ...doc, frames: doc.frames.map((f) => ({ ...f, videoId: "different-video" })) },
    });
  });
  expect(transform()).toBe("translate(0 0) scale(1)");
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 200, clientY: 150 });
  act(() => {
    const doc = store.getState().document!;
    store.setState({ document: { ...doc, record: { ...doc.record, id: "different-record" } } });
  });
  expect(transform()).toBe("translate(0 0) scale(1)");
});

it("offers trackpad pan/pinch, actual pixel 100%, Fit and Fit selection in readonly without writes", async () => {
  const { store, canvas, transform, content } = await setup();
  act(() => {
    store.setState({ readonly: true });
  });
  fireEvent.change(screen.getByLabelText("Navigation profile"), { target: { value: "trackpad" } });
  fireEvent.wheel(canvas, { deltaX: 20, deltaY: 10 });
  expect(transform()).toBe("translate(-40 -20) scale(1)");
  fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 150 });
  expect(transform()).not.toBe("translate(-40 -20) scale(1)");
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  expect((content() as SVGGraphicsElement).getScreenCTM()!.a).toBeCloseTo(1);
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(transform()).toBe("translate(0 0) scale(1)");
  fireEvent.click(screen.getByRole("button", { name: "Fit selection" }));
  expect((content() as SVGGraphicsElement).getScreenCTM()!.a).toBeGreaterThan(0.5);
  expect(store.getState().stagedOperations).toHaveLength(0);
});

it("routes canvas undo/redo and the visible Redo button while leaving inputs and toolbar keys alone", async () => {
  const { store, viewport, points, handle } = await setup();
  const original = points();
  render(<SubmissionControls store={store} />);
  expect(screen.getByRole("button", { name: "重做" })).toHaveProperty("disabled", true);
  clickVertex(screen.getByRole("img", { name: "Frame polygons" }), handle(), 180, 130);
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  const edited = points();
  fireEvent.keyDown(viewport, { key: "z", metaKey: true });
  expect(points()).toEqual(original);
  expect(screen.getByRole("button", { name: "重做" })).toHaveProperty("disabled", false);
  fireEvent.keyDown(screen.getByLabelText("Overlay opacity"), {
    key: "z",
    metaKey: true,
    shiftKey: true,
  });
  expect(points()).toEqual(original);
  fireEvent.keyDown(viewport, { key: "z", metaKey: true, shiftKey: true });
  expect(points()).toEqual(edited);
  fireEvent.keyDown(viewport, { key: "z", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "重做" }));
  expect(points()).toEqual(edited);
  expect(fireEvent.keyDown(screen.getByRole("button", { name: "Pan" }), { key: " " })).toBe(true);
});

it("keeps pixel nudges precise after image dimensions and display zoom change", async () => {
  const { container, viewport, points, handle, canvas } = await setup();
  const image = container.querySelector('img[alt=""]')!;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1920 });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: 1080 });
  fireEvent.load(image);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  const original = points()[0]!;
  clickVertex(canvas, handle(), 180, 130);
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  fireEvent.keyDown(viewport, { key: "ArrowUp", shiftKey: true });
  expect(points()[0]!.x).toBeCloseTo(original.x + 1 / 1920);
  expect(points()[0]!.y).toBeCloseTo(original.y - 10 / 1080);
});

it("contains canvas key events while native controls retain normal event ownership", async () => {
  const { viewport } = await setup();
  const native = jest.fn();
  document.addEventListener("keydown", native);
  try {
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(native).not.toHaveBeenCalled();
    fireEvent.keyUp(viewport, { key: " " });
    fireEvent.keyDown(screen.getByRole("button", { name: "Pan" }), { key: " " });
    fireEvent.keyDown(screen.getByLabelText("Overlay opacity"), { key: "ArrowRight" });
    expect(native).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener("keydown", native);
  }
});

it.each(["fill", "edge", "background"])(
  "temporary Space pans over %s without selecting or editing",
  async (region) => {
    const { canvas, viewport, store, transform } = await setup();
    const target =
      region === "fill"
        ? canvas.querySelector('[data-instance-id="instance-2"] path')!
        : region === "edge"
          ? canvas.querySelector('[data-instance-id="instance-1"] path[stroke]')!
          : canvas;
    const focus = store.getState().focus,
      selection = store.getState().selection;
    fireEvent.keyDown(viewport, { key: " " });
    pointer(target, "pointerdown", 250, 150);
    pointer(canvas, "pointermove", 290, 170);
    pointer(canvas, "pointerup", 290, 170);
    expect(transform()).toBe("translate(80 40) scale(1)");
    expect(store.getState().focus).toEqual(focus);
    expect(store.getState().selection).toEqual(selection);
    expect(store.getState().stagedOperations).toHaveLength(0);
    fireEvent.keyUp(window, { key: " " });
  },
);

it("keeps annotation Help and context menu portal events out of global playback", async () => {
  const { canvas, handle, points, store } = await setup();
  const playback = jest.fn();
  render(
    <KeyListener
      global
      keyDownHandlers={{ " ": playback, ArrowDown: playback }}
      keyUpHandlers={{ " ": playback }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }), { detail: 1 });
  const dialog = screen.getByRole("dialog");
  const close = screen.getByRole("button", { name: "Close" });
  await act(async () => {
    close.focus();
    await Promise.resolve();
  });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: " " });
  fireEvent.keyUp(close, { key: " " });
  expect(playback).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  const x = points()[0]!.x * 480 + 100,
    y = points()[0]!.y * 270 + 50;
  pointer(handle(), "pointerdown", x, y, 2);
  pointer(canvas, "pointerup", x, y, 2);
  const menu = screen.getByRole("menu");
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(playback).not.toHaveBeenCalled();
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
  expect(store.getState().stagedOperations).toHaveLength(0);
});

it.each([
  { fitScale: 0.01, width: 48000, height: 27000 },
  { fitScale: 30, width: 16, height: 9 },
])(
  "reaches actual 100 percent outside fit-relative zoom bounds at $width x $height",
  async ({ fitScale, width, height }) => {
    const { container, content } = await setup(fitScale);
    const image = container.querySelector('img[alt=""]')!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
    fireEvent.load(image);
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect((content() as SVGGraphicsElement).getScreenCTM()!.a).toBeCloseTo(1);
  },
);

it("closes annotation portals and disables navigation when propagation locks the editor", async () => {
  const { store, canvas, transform } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => {
    store.setState({ propagation: { status: "running", processedFrames: 0 } });
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(screen.getByRole("button", { name: "Pan" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Navigation profile")).toHaveProperty("disabled", true);
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 200, clientY: 150 });
  expect(transform()).toBe("translate(0 0) scale(1)");
  expect(store.getState().stagedOperations).toHaveLength(0);
});

describe("polygon editing keys and multi-point selection", () => {
  // Five points in the empty top band of the frame. Screen = (100 + 480x, 50 + 270y).
  const outline = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.2 },
    { x: 0.25, y: 0.22 },
    { x: 0.1, y: 0.2 },
  ];
  const screenOf = (p: { x: number; y: number }) => ({ x: 100 + 480 * p.x, y: 50 + 270 * p.y });
  async function outlined() {
    const result = await setup();
    act(() => {
      result.store.getState().setPolygonPoints("instance-1-polygon-0", outline);
    });
    const vertex = (index: number) =>
      screen.getByRole("button", {
        name: `Vertex ${index + 1} of polygon instance-1-polygon-0`,
      });
    const click = (index: number, modifiers: MouseEventInit = {}) => {
      const at = screenOf(outline[index]!);
      clickVertex(result.canvas, vertex(index), at.x, at.y, modifiers);
    };
    const selected = () =>
      screen
        .getAllByTestId("vertex-handle-visible")
        .map((el, index) => [index, el.getAttribute("data-selected")] as const)
        .filter(([, value]) => value === "true")
        .map(([index]) => index);
    return { ...result, vertex, click, selected };
  }

  it("Enter starts editing a selected polygon and Enter again finishes without losing edits", async () => {
    const { store, viewport, points } = await setup();
    act(() => {
      store.getState().setSelection([{ type: "polygon", id: "instance-1-polygon-0" }]);
      store.getState().setEditing(false);
    });
    expect(screen.queryAllByRole("button", { name: /^Vertex/ })).toHaveLength(0);
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(store.getState().editing).toBe(true);
    expect(screen.queryAllByRole("button", { name: /^Vertex/ }).length).toBeGreaterThan(0);
    clickVertex(
      screen.getByRole("img", { name: "Frame polygons" }),
      screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" }),
      180,
      130,
    );
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    const edited = points();
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(store.getState().editing).toBe(false);
    expect(screen.queryAllByRole("button", { name: /^Vertex/ })).toHaveLength(0);
    expect(points()).toEqual(edited);
    // The point selection does not survive leaving edit mode.
    fireEvent.keyDown(viewport, { key: "Enter" });
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(points()).toEqual(edited);
  });

  it("Enter does nothing without a selected polygon, and focuses the owner of a selected polygon", async () => {
    const { store, viewport } = await setup();
    act(() => {
      store.getState().setEditing(false);
    });
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(store.getState().editing).toBe(false);
    act(() => {
      store.getState().setFocus(undefined);
      store.getState().setSelection([{ type: "polygon", id: "instance-2-polygon-0" }]);
    });
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(store.getState().editing).toBe(true);
    expect(store.getState().focus).toEqual({ type: "instance", id: "instance-2" });
  });

  it("Enter on a selected polygon without vertices starts drawing it", async () => {
    const { store, viewport } = await setup();
    let id = "";
    act(() => {
      id = store.getState().addPolygon("instance-1");
      store.getState().setSelection([{ type: "polygon", id }]);
      store.getState().setEditing(false);
    });
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(store.getState().drawingPolygonId).toBe(id);
  });

  it("Shift+click builds a multi-selection and arrows move every selected point together", async () => {
    const { viewport, click, selected, points, store } = await outlined();
    click(0);
    expect(selected()).toEqual([0]);
    click(1, { shiftKey: true });
    click(3, { shiftKey: true });
    expect(selected()).toEqual([0, 1, 3]);
    click(1, { shiftKey: true });
    expect(selected()).toEqual([0, 3]);
    expect(screen.getByText(/2 points selected/)).toBeTruthy();
    const history = store.getState().stagedOperations.length;
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    fireEvent.keyDown(viewport, { key: "ArrowDown", shiftKey: true });
    const moved = points();
    for (const index of [0, 3]) {
      expect(moved[index]!.x).toBeCloseTo(outline[index]!.x + 1 / 960);
      expect(moved[index]!.y).toBeCloseTo(outline[index]!.y + 10 / 540);
    }
    for (const index of [1, 2, 4]) {
      expect(moved[index]).toEqual(outline[index]);
    }
    expect(store.getState().stagedOperations).toHaveLength(history + 2);
    // Selection stays after moving; a plain click collapses it to one point.
    expect(selected()).toEqual([0, 3]);
    click(2);
    expect(selected()).toEqual([2]);
  });

  it("stops a group nudge at the image edge without distorting the shape", async () => {
    const { viewport, click, points } = await outlined();
    click(0);
    click(1, { shiftKey: true });
    // Push left: point 0 is at x=0.1 (96px), so 10 presses of Shift+Left would exceed it.
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(viewport, { key: "ArrowLeft", shiftKey: true });
    }
    const moved = points();
    expect(moved[0]!.x).toBeCloseTo(0);
    expect(moved[1]!.x - moved[0]!.x).toBeCloseTo(outline[1]!.x - outline[0]!.x);
  });

  it("drag-selects points with a rectangle over empty canvas, then moves and deletes them together", async () => {
    const { canvas, viewport, selected, points, store } = await outlined();
    const history = store.getState().stagedOperations.length;
    pointer(canvas, "pointerdown", 110, 56);
    expect(screen.queryByTestId("selection-rectangle")).toBeNull();
    pointer(canvas, "pointermove", 300, 90);
    expect(screen.getByTestId("selection-rectangle")).toBeTruthy();
    pointer(canvas, "pointerup", 300, 90);
    expect(screen.queryByTestId("selection-rectangle")).toBeNull();
    // Rectangle covers x 0.02–0.42 and y 0.02–0.15: the two top points.
    expect(selected()).toEqual([0, 1]);
    expect(store.getState().stagedOperations).toHaveLength(history);
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(points()[0]!.x).toBeCloseTo(outline[0]!.x + 1 / 960);
    expect(points()[1]!.x).toBeCloseTo(outline[1]!.x + 1 / 960);
    fireEvent.keyDown(viewport, { key: "Delete" });
    expect(points()).toHaveLength(3);
    expect(points().map((p) => p.y)).toEqual([0.2, 0.22, 0.2]);
  });

  it("Shift+rectangle adds to the selection and a plain click on empty canvas clears it", async () => {
    const { canvas, click, selected } = await outlined();
    click(4);
    pointer(canvas, "pointerdown", 110, 56, 0, { shiftKey: true });
    pointer(canvas, "pointermove", 300, 90, 0, { shiftKey: true });
    pointer(canvas, "pointerup", 300, 90, 0, { shiftKey: true });
    expect(selected()).toEqual([0, 1, 4]);
    pointer(canvas, "pointerdown", 110, 56);
    pointer(canvas, "pointerup", 110, 56);
    expect(selected()).toEqual([]);
  });

  it("dragging one selected point moves every selected point by the same delta in one undo step", async () => {
    const { canvas, click, vertex, points, store } = await outlined();
    click(0);
    click(1, { shiftKey: true });
    const history = store.getState().stagedOperations.length;
    const start = screenOf(outline[0]!);
    pointer(vertex(0), "pointerdown", start.x, start.y);
    pointer(canvas, "pointermove", start.x + 24, start.y + 27);
    pointer(canvas, "pointerup", start.x + 24, start.y + 27);
    const moved = points();
    for (const index of [0, 1]) {
      expect(moved[index]!.x).toBeCloseTo(outline[index]!.x + 24 / 480);
      expect(moved[index]!.y).toBeCloseTo(outline[index]!.y + 27 / 270);
    }
    for (const index of [2, 3, 4]) {
      expect(moved[index]).toEqual(outline[index]);
    }
    expect(store.getState().stagedOperations).toHaveLength(history + 1);
  });

  it("refuses to delete selected points when fewer than three would remain", async () => {
    const { canvas, viewport, points, store } = await outlined();
    const history = store.getState().stagedOperations.length;
    pointer(canvas, "pointerdown", 110, 56);
    pointer(canvas, "pointermove", 320, 120);
    pointer(canvas, "pointerup", 320, 120);
    fireEvent.keyDown(viewport, { key: "Delete" });
    expect(points()).toEqual(outline);
    expect(store.getState().stagedOperations).toHaveLength(history);
    expect(screen.getByText(/at least 3 vertices/)).toBeTruthy();
  });
});
