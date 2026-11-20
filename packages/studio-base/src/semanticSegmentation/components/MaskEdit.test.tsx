/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import { editor, fixture, pointer } from "../acceptance/interaction/fixtures";
import { countsFromRuns, runsFromIntervals } from "../maskCodec";
import { maskArea, maskOf, polygonsOf } from "../maskGeometry";
import { frameInstanceKey } from "../service";
import type { SegmentationDocument } from "../types";

afterEach(cleanup);

const key = frameInstanceKey("frame-0", "instance-1");

/** Column-major intervals of rectangles [x0, x1) × [y0, y1), minus optional holes. */
function maskCounts(
  width: number,
  height: number,
  rects: [number, number, number, number][],
  holes: [number, number, number, number][] = [],
): string {
  const bits = new Uint8Array(width * height);
  for (const [value, list] of [
    [1, rects],
    [0, holes],
  ] as const) {
    for (const [x0, x1, y0, y1] of list) {
      for (let x = x0; x < x1; x++) {
        for (let y = y0; y < y1; y++) {
          bits[x * height + y] = value;
        }
      }
    }
  }
  const intervals: number[] = [];
  for (let index = 0; index < bits.length; index++) {
    if (bits[index] === 1 && (index === 0 || bits[index - 1] !== 1)) {
      intervals.push(index);
    }
    if (bits[index] === 1 && (index === bits.length - 1 || bits[index + 1] !== 1)) {
      intervals.push(index + 1);
    }
  }
  return countsFromRuns(runsFromIntervals(Uint32Array.from(intervals), width, height));
}

function withMask(
  rects: [number, number, number, number][],
  holes: [number, number, number, number][] = [],
): { document: SegmentationDocument; counts: string } {
  const document = fixture();
  const width = document.videos[0]!.width!;
  const height = document.videos[0]!.height!;
  const counts = maskCounts(width, height, rects, holes);
  document.annotations[key] = {
    frameId: "frame-0",
    instanceId: "instance-1",
    kind: "mask",
    mask: { counts, width, height },
  };
  document.annotationSummaries[key] = {
    polygonCount: 0,
    pointCount: 0,
    maskArea: maskArea(counts),
  };
  return { document, counts };
}

function canvas() {
  return screen.getByRole("img", { name: "Frame polygons" });
}

it("double-clicking a mask edits it with the brush and keeps it a mask", async () => {
  const { document } = withMask([[100, 400, 100, 300]]);
  const { store } = await editor(document);
  const original = store.getState().document!.annotations[key]!;

  act(() => {
    pointer(canvas(), "dblclick", 200, 200);
  });

  expect(store.getState().editing).toBe(true);
  expect(store.getState().focus).toEqual({ type: "instance", id: "instance-1" });
  // Opening a mask converts nothing: the observation, and the staged history, are untouched.
  expect(store.getState().document!.annotations[key]).toEqual(original);
  expect(store.getState().stagedOperations).toHaveLength(0);
  const tools = screen.getByTestId("edit-tools");
  expect(within(tools).getByRole("button", { name: /Brush/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(within(tools).getByRole("button", { name: /Convert to polygons/ })).toBeDefined();
  expect(canvas().style.cursor).toBe("none");
  // Only the double-clicked instance is affected.
  expect(
    maskOf(store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-2")]),
  ).toBeUndefined();
});

it("paints and erases the mask with brush strokes, one undo step each", async () => {
  const { document, counts } = withMask([[100, 400, 100, 300]]);
  const { store } = await editor(document);
  act(() => {
    pointer(canvas(), "dblclick", 200, 200);
  });
  const area = () => maskArea(maskOf(store.getState().document!.annotations[key])!.counts);
  const before = area();

  pointer(canvas(), "pointerdown", 600, 400);
  pointer(canvas(), "pointermove", 650, 400);
  expect(canvas().querySelector('[data-testid="brush-stroke"]')).not.toBeNull();
  pointer(canvas(), "pointerup", 650, 400);
  const painted = area();
  expect(painted).toBeGreaterThan(before);
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(store.getState().document!.annotations[key]!.kind).toBe("mask");

  fireEvent.keyDown(canvas(), { key: "e" });
  pointer(canvas(), "pointerdown", 200, 200);
  pointer(canvas(), "pointerup", 200, 200);
  expect(area()).toBeLessThan(painted);
  expect(store.getState().stagedOperations).toHaveLength(2);

  act(() => {
    store.getState().undo();
    store.getState().undo();
  });
  expect(maskOf(store.getState().document!.annotations[key])?.counts).toBe(counts);
});

it("converting a mask with a hole shows what is lost, and Undo restores the mask", async () => {
  const { document, counts } = withMask([[100, 400, 100, 300]], [[200, 250, 150, 200]]);
  const { store } = await editor(document);
  act(() => {
    pointer(canvas(), "dblclick", 120, 120);
  });
  fireEvent.click(screen.getByRole("button", { name: /Convert to polygons/ }));
  const loss = screen.getByTestId("mask-conversion-loss");
  expect(loss.textContent).toContain("1 hole(s) will be filled");
  // Nothing changes until the user confirms.
  expect(store.getState().document!.annotations[key]!.kind).toBe("mask");
  fireEvent.click(screen.getByTestId("confirm-mask-conversion"));

  const converted = store.getState().document!.annotations[key]!;
  expect(converted.kind).toBe("polygons");
  expect(polygonsOf(converted).length).toBeGreaterThan(0);
  expect(store.getState().stagedOperations).toHaveLength(1);

  act(() => {
    store.getState().undo();
  });
  expect(maskOf(store.getState().document!.annotations[key])?.counts).toBe(counts);
});

it("keeps editing a converted mask when one of its polygons is picked", async () => {
  // Two separate rectangles: two connected components, so two polygons.
  const { document } = withMask([
    [100, 200, 100, 200],
    [400, 500, 100, 200],
  ]);
  const { store } = await editor(document);
  act(() => {
    pointer(canvas(), "dblclick", 150, 150);
    store.getState().convertToPolygons("instance-1");
  });
  const polygons = polygonsOf(store.getState().document!.annotations[key]);
  expect(polygons).toHaveLength(2);
  act(() => {
    store.getState().setFocus({ type: "polygon", id: polygons[1]!.id });
  });
  expect(store.getState().editing).toBe(true);
  expect(polygonsOf(store.getState().document!.annotations[key])).toHaveLength(2);
  // Polygon observations offer the reverse conversion instead of the brush.
  expect(screen.queryByRole("button", { name: /Brush/ })).toBeNull();
  fireEvent.click(globalThis.document.querySelector('[data-tool="convert-to-mask"]')!);
  expect(store.getState().document!.annotations[key]!.kind).toBe("mask");
});

it("forwards view and history shortcuts from the tree to the canvas", async () => {
  const { store, container } = await editor(fixture());
  const viewportKeys: string[] = [];
  screen
    .getByTestId("segmentation-viewport")
    .addEventListener("keydown", (event) =>
      viewportKeys.push(`${event.shiftKey ? "Shift+" : ""}${event.key}`),
    );
  const row = container.querySelector('[data-node-id="instance-1"]')!;
  act(() => {
    store.getState().renameInstance("instance-1", "renamed");
  });
  expect(store.getState().stagedOperations).toHaveLength(1);
  fireEvent.keyDown(row, { key: "F", shiftKey: true });
  fireEvent.keyDown(row, { key: "z", metaKey: true });
  // Arrows and Enter stay with the tree and the app.
  fireEvent.keyDown(row, { key: "ArrowRight" });
  expect(viewportKeys).toEqual(["Shift+F", "z"]);
  expect(store.getState().stagedOperations).toHaveLength(0);
});
