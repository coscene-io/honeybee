/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen } from "@testing-library/react";

import { editor, fixture, pointer, polygon, triangle } from "./fixtures";
import { frameInstanceKey } from "../../service";

function frameImage(width: number, height: number) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="gray" /></svg>`)}`;
}
function canvas() {
  return screen.getByRole("img", { name: "Frame polygons" });
}
function key(value: string) {
  fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: value });
}
function loadSize(container: HTMLElement, width: number, height: number) {
  const image = container.querySelector("img")!;
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}

it("SEG-DRAW-001/002/003/005 inserts at missing I, renders ordered draft segments, and Escape retains empty Q and saved P", async () => {
  const document = fixture(2);
  document.frames[0]!.imageUrl = frameImage(100, 100);
  delete document.annotations[frameInstanceKey("frame-0", "instance-1")];
  delete document.annotationSummaries[frameInstanceKey("frame-0", "instance-1")];
  const { store, container } = await editor(document);
  const otherFrame = polygon(store, "instance-1", "frame-1");
  fireEvent.click(screen.getByRole("button", { name: "Add polygon to ○ Person 1" }));
  const p = store.getState().drawingPolygonId!;
  expect(store.getState().currentFrameId).toBe("frame-0");
  expect(polygon(store)).toEqual({ id: p, points: [], topic: "/camera/front" });
  expect(canvas().style.cursor).toBe("crosshair");
  expect(screen.getByRole("alert").textContent).toContain(
    "Click to add vertices. Enter finishes with at least 3 points. Esc cancels",
  );
  expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  loadSize(container, 100, 100);
  for (const [x, y] of [
    [10, 10],
    [30, 10],
    [30, 30],
  ]) {
    pointer(canvas(), "pointerdown", x!, y!);
  }
  expect(canvas().querySelector("polyline")!.getAttribute("points")).toBe("10,10 30,10 30,30");
  expect(canvas().querySelectorAll('g[pointer-events="none"] circle')).toHaveLength(3);
  key("Enter");
  expect(polygon(store).points).toEqual(triangle);
  const saved = polygon(store);
  fireEvent.click(screen.getByRole("button", { name: "Add polygon to ● Person 1" }));
  const q = store.getState().drawingPolygonId!;
  pointer(canvas(), "pointerdown", 50, 50);
  pointer(canvas(), "pointerdown", 60, 60);
  key("Escape");
  expect(store.getState().drawingPolygonId).toBeUndefined();
  expect(
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons,
  ).toEqual([saved, { id: q, points: [], topic: "/camera/front" }]);
  expect(polygon(store, "instance-1", "frame-1")).toEqual(otherFrame);
  store.getState().dispose();
});

it.each(
  [
    [],
    [[10, 10]],
    [
      [10, 10],
      [10, 10],
      [10, 10],
    ],
    [
      [10, 10],
      [20, 20],
      [30, 30],
    ],
  ].map((points) => ({ points })),
)("SEG-DRAW-006/009 invalid draft $points remains open without staged area", async ({ points }) => {
  const { store } = await editor();
  fireEvent.click(screen.getByRole("button", { name: "Add polygon to ○ Empty instance" }));
  const id = store.getState().drawingPolygonId;
  const staged = store.getState().stagedOperations;
  for (const [x, y] of points) {
    pointer(canvas(), "pointerdown", x!, y!);
  }
  key("Enter");
  expect(
    screen.getByText(
      points.length < 3
        ? "Add at least 3 vertices before pressing Enter."
        : "Vertices must enclose a nonzero area.",
    ),
  ).toBeDefined();
  expect(store.getState().drawingPolygonId).toBe(id);
  expect(polygon(store, "instance-empty").points).toEqual([]);
  expect(store.getState().stagedOperations).toEqual(staged);
  expect(screen.getByText(new RegExp(`^Drawing: ${points.length} vertices · `))).toBeDefined();
  store.getState().dispose();
});

it("SEG-DRAW-010 text-field Enter does not finish a simultaneous valid polygon draft", async () => {
  const { store } = await editor();
  fireEvent.click(screen.getByRole("button", { name: "Add polygon to ○ Empty instance" }));
  const id = store.getState().drawingPolygonId;
  for (const [x, y] of [
    [96, 54],
    [288, 54],
    [288, 162],
  ]) {
    pointer(canvas(), "pointerdown", x!, y!);
  }
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  const input = screen.getByLabelText("Class name");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("Enter a class name of 1–100 characters.")).toBeDefined();
  expect(store.getState().drawingPolygonId).toBe(id);
  expect(screen.getByText(/^Drawing: 3 vertices · /)).toBeDefined();
  expect(polygon(store, "instance-empty").points).toEqual([]);
  store.getState().dispose();
});

it("SEG-DRAW-011/019 fractional image vertex drag survives durable mock submit and reload within 0.01 pixel", async () => {
  const document = fixture(2);
  document.frames[0]!.imageUrl = frameImage(100, 100);
  document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons[0]!.points = triangle;
  const { store, service, container } = await editor(document);
  loadSize(container, 100, 100);
  fireEvent.click(screen.getByRole("button", { name: "● Person 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const before = polygon(store).points;
  const j = polygon(store, "instance-2");
  pointer(
    screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" }),
    "pointerdown",
    10,
    10,
  );
  pointer(canvas(), "pointermove", 12.5, 13.25);
  pointer(canvas(), "pointerup", 12.5, 13.25);
  expect(polygon(store).points[0]).toEqual({ x: 0.125, y: 0.1325 });
  expect(polygon(store).points.slice(1)).toEqual(before.slice(1));
  expect(polygon(store, "instance-2")).toEqual(j);
  act(() => {
    store.getState().submit();
  });
  await act(async () => {
    await store.getState().waitForSubmissions();
  });
  const loaded = await service.loadFrameWindow("video-1", 0, 0.4);
  const point =
    loaded.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons[0]!.points[0]!;
  expect(Math.abs(point.x * 100 - 12.5)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(point.y * 100 - 13.25)).toBeLessThanOrEqual(0.01);
  expect(store.getState().submissionQueue[0]!.status).toBe("succeeded");
  store.getState().dispose();
});

it("SEG-DRAW-013 retains two disjoint selectable components in one instance across reload", async () => {
  const document = fixture(2);
  const p = document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons[0]!;
  p.points = triangle;
  const q = {
    id: "disjoint-Q",
    points: triangle.map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 })),
  };
  document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons.push(q);
  const { store, service } = await editor(document);
  const union = canvas().querySelector(
    '[data-instance-id="instance-1"] [data-testid="instance-union-fill"]',
  )!;
  expect(union.querySelectorAll("path")).toHaveLength(2);
  expect(
    [...union.querySelectorAll("path")].every((path) => path.getAttribute("d")!.length > 0),
  ).toBe(true);
  for (const [index, id] of [p.id, q.id].entries()) {
    pointer(union.querySelectorAll("path")[index]!, "pointerdown", 100, 100);
    expect(store.getState().selection).toEqual([{ type: "polygon", id }]);
  }
  expect(
    (await service.loadFrameWindow("video-1", 0, 1)).annotations[
      frameInstanceKey("frame-0", "instance-1")
    ]!.polygons,
  ).toEqual([p, q]);
  await act(async () => {
    await store.getState().initialize();
  });
  const reloadedUnion = canvas().querySelector(
    '[data-instance-id="instance-1"] [data-testid="instance-union-fill"]',
  )!;
  expect(reloadedUnion.querySelectorAll("path")).toHaveLength(2);
  expect(
    [...reloadedUnion.querySelectorAll("path")].every((path) => path.getAttribute("d")!.length > 0),
  ).toBe(true);
  expect(
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons,
  ).toEqual([p, q]);
  for (const [index, id] of [p.id, q.id].entries()) {
    pointer(reloadedUnion.querySelectorAll("path")[index]!, "pointerdown", 100, 100);
    expect(store.getState().selection).toEqual([{ type: "polygon", id }]);
  }
  store.getState().dispose();
});

it.each([
  [640, 480],
  [1920, 1080],
])(
  "SEG-DRAW-018 uses decoded %ix%i frame dimensions for pointer coordinates",
  async (width, height) => {
    const document = fixture(2);
    document.frames[0]!.imageUrl = frameImage(100, 100);
    document.frames[1]!.imageUrl = frameImage(width, height);
    const { store, container } = await editor(document);
    // First decode a different size to expose stale-size reuse at the browser event boundary.
    loadSize(container, 100, 100);
    act(() => {
      store.getState().setCurrentFrame("frame-1");
    });
    loadSize(container, width, height);
    fireEvent.click(screen.getByRole("button", { name: "Add polygon to ○ Empty instance" }));
    pointer(canvas(), "pointerdown", width / 2, height / 2);
    pointer(canvas(), "pointerdown", width * 0.75, height / 2);
    pointer(canvas(), "pointerdown", width / 2, height * 0.75);
    key("Enter");
    expect(polygon(store, "instance-empty", "frame-1").points).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.5, y: 0.75 },
    ]);
    expect(canvas().getAttribute("viewBox")).toBe(`0 0 ${width} ${height}`);
    store.getState().dispose();
  },
);

it("SEG-DRAW-017 exact2x SVG layout maps an actual drawing pointer to fractional original-image coordinates", async () => {
  const document = fixture(2);
  document.frames[0]!.imageUrl = frameImage(100, 100);
  const { store, container } = await editor(document);
  loadSize(container, 100, 100);
  // Browser layout boundary: exact 2x image magnification and translated viewport.
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 2, b: 0, c: 0, d: 2, e: 110, f: 95 }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Add polygon to ○ Empty instance" }));
  for (const [x, y] of [
    [131, 135.5],
    [171, 135.5],
    [131, 175.5],
  ]) {
    pointer(canvas(), "pointerdown", x!, y!);
  }
  key("Enter");
  const points = polygon(store, "instance-empty").points;
  expect(points).toHaveLength(3);
  expect(points[0]!.x * 100).toBeCloseTo(10.5, 8);
  expect(points[0]!.y * 100).toBeCloseTo(20.25, 8);
  expect(points[1]!.x * 100).toBeCloseTo(30.5, 8);
  expect(points[2]!.y * 100).toBeCloseTo(40.25, 8);
  expect(store.getState().drawingPolygonId).toBeUndefined();
  store.getState().dispose();
});
