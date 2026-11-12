/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen, within } from "@testing-library/react";

import { editor, fixture, pointer, polygon } from "./fixtures";
import { frameInstanceKey } from "../../service";

function paths(instanceId: string) {
  return screen
    .getByRole("img", { name: "Frame polygons" })
    .querySelectorAll(
      `[data-instance-id="${instanceId}"] [data-testid="instance-union-fill"] path`,
    );
}
function selected(mode: string) {
  for (const name of ["Original", "Instance", "All"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe(
      String(name === mode),
    );
  }
}

it("SEG-FOC-001/002/003/004/007/008/015/016 switches rendered focus across frames without changing hidden geometry", async () => {
  const document = fixture(3);
  delete document.annotations[frameInstanceKey("frame-1", "instance-1")];
  delete document.annotationSummaries[frameInstanceKey("frame-1", "instance-1")];
  const { store } = await editor(document);
  selected("All");
  fireEvent.click(screen.getByRole("button", { name: "● Person 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const before = store.getState().document;
  const staged = store.getState().stagedOperations;
  fireEvent.click(screen.getByRole("button", { name: "Original" }));
  selected("Original");
  for (const frame of ["frame-0", "frame-1", "frame-2"]) {
    act(() => {
      store.getState().setCurrentFrame(frame);
    });
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    expect(canvas.querySelector("image")?.getAttribute("href")).toBe(
      document.frames.find((item) => item.id === frame)!.imageUrl,
    );
    expect(canvas.querySelectorAll("path, circle[aria-label]")).toHaveLength(0);
    pointer(canvas, "pointerdown", 163.2, 162);
    pointer(canvas, "pointermove", 180, 180);
    pointer(canvas, "pointerup", 180, 180);
    expect(store.getState().document).toEqual(before);
    expect(store.getState().stagedOperations).toEqual(staged);
    expect(store.getState().editing).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "Instance" }));
  selected("Instance");
  for (const frame of ["frame-0", "frame-1", "frame-2"]) {
    act(() => {
      store.getState().setCurrentFrame(frame);
    });
    expect(paths("instance-1")).toHaveLength(frame === "frame-1" ? 0 : 1);
    expect(paths("instance-2")).toHaveLength(0);
    expect(store.getState().focus).toEqual({ type: "instance", id: "instance-1" });
    expect(
      screen.getByRole("img", { name: "Frame polygons" }).querySelector("image"),
    ).not.toBeNull();
    expect(store.getState().editing).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  selected("All");
  expect(paths("instance-1")).toHaveLength(1);
  expect(paths("instance-2")).toHaveLength(1);
  expect(
    screen
      .getAllByRole("button", { name: /^Vertex/ })
      .every((node) => node.getAttribute("aria-label")!.includes("instance-1")),
  ).toBe(true);
  expect(store.getState().editing).toBe(true);
  store.getState().dispose();
});

it("SEG-FOC-006/018 isolates P from sibling Q for visibility and pointer editing", async () => {
  const document = fixture(2);
  document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons.push({
    id: "sibling-Q",
    points: [
      { x: 0.6, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.7, y: 0.3 },
    ],
  });
  const { store, container } = await editor(document);
  fireEvent.click(screen.getByRole("button", { name: "● Person 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Instance" }));
  const row = container.querySelector('[data-node-id="instance-1-polygon-0"]')!;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^Polygon 1/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(paths("instance-1")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Vertex 1 of polygon sibling-Q" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  const before =
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons;
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  const q = paths("instance-1")[1]!;
  pointer(q, "pointerdown", 650, 100);
  pointer(canvas, "pointermove", 700, 140);
  pointer(canvas, "pointerup", 700, 140);
  expect(
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons,
  ).toEqual(before);
  // Clicking a noneditable shape changes focus and completes the edit; select P and edit it again.
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^Polygon 1/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const vertex = screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" });
  pointer(vertex, "pointerdown", 163.2, 162);
  pointer(canvas, "pointermove", 200.5, 180.25);
  pointer(canvas, "pointerup", 200.5, 180.25);
  const after =
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons;
  expect(after[1]).toEqual(before[1]);
  expect(after[0]!.points[0]).toEqual({ x: 200.5 / 960, y: 180.25 / 540 });
  expect(after[0]!.points.slice(1)).toEqual(before[0]!.points.slice(1));
  store.getState().dispose();
});

it("SEG-FOC-010/011 edits I without J and toggles handles off while retaining staged geometry", async () => {
  const { store } = await editor();
  fireEvent.click(screen.getByRole("button", { name: "● Person 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const j = polygon(store, "instance-2");
  expect(
    screen.queryByRole("button", { name: "Vertex 1 of polygon instance-2-polygon-0" }),
  ).toBeNull();
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  pointer(
    screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" }),
    "pointerdown",
    163.2,
    162,
  );
  pointer(canvas, "pointermove", 180.5, 190.25);
  pointer(canvas, "pointerup", 180.5, 190.25);
  expect(polygon(store).points[0]).toEqual({ x: 180.5 / 960, y: 190.25 / 540 });
  expect(polygon(store, "instance-2")).toEqual(j);
  const edited = store.getState().document;
  const staged = store.getState().stagedOperations;
  expect(staged).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(screen.queryAllByRole("button", { name: /^Vertex/ })).toHaveLength(0);
  expect(store.getState().editing).toBe(false);
  expect(store.getState().document).toEqual(edited);
  expect(store.getState().stagedOperations).toEqual(staged);
  store.getState().dispose();
});

it("SEG-FOC-017 class focus edits I/J but not K", async () => {
  const { store } = await editor();
  act(() => {
    store.getState().moveInstance("instance-2", "class-1");
    store.getState().addPolygon("instance-empty", [
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.5 },
      { x: 0.6, y: 0.7 },
    ]);
    store.getState().moveInstance("instance-empty", "class-2");
    store.getState().setFocus({ type: "class", id: "class-1" });
    store.getState().setEditing(true);
  });
  const k = polygon(store, "instance-empty");
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  for (const instance of ["instance-1", "instance-2"]) {
    const original = polygon(store, instance);
    pointer(
      screen.getByRole("button", { name: `Vertex 1 of polygon ${original.id}` }),
      "pointerdown",
      170,
      160,
    );
    pointer(canvas, "pointermove", 200.5, 190.25);
    pointer(canvas, "pointerup", 200.5, 190.25);
    expect(polygon(store, instance).points[0]).toEqual({ x: 200.5 / 960, y: 190.25 / 540 });
  }
  expect(screen.queryByRole("button", { name: `Vertex 1 of polygon ${k.id}` })).toBeNull();
  pointer(paths("instance-empty")[0]!, "pointerdown", 550, 300);
  pointer(canvas, "pointermove", 600, 350);
  pointer(canvas, "pointerup", 600, 350);
  expect(polygon(store, "instance-empty")).toEqual(k);
  store.getState().dispose();
});

it("shows Draw instead of Edit for a focused empty polygon, then toggles Done editing", async () => {
  const { store } = await editor();
  let id = "";
  act(() => {
    id = store.getState().addPolygon("instance-1");
    store.getState().setFocus({ type: "polygon", id });
    store.getState().setEditing(false);
  });
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Draw" }));
  expect(store.getState().editing).toBe(true);
  expect(store.getState().drawingPolygonId).toBe(id);
  fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
  expect(store.getState().editing).toBe(false);
  expect(store.getState().drawingPolygonId).toBeUndefined();
  expect(screen.getByRole("button", { name: "Draw" })).toBeTruthy();
  store.getState().dispose();
});
