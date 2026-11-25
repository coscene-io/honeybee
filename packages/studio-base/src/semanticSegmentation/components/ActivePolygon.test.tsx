/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen } from "@testing-library/react";

import { createSemanticSegmentationStore } from "../store";
import { SegmentationCanvas } from "./SegmentationCanvas/SegmentationCanvas";
import { render, installSegmentationTestHost } from "../testing/host";
import { createMockSemanticSegmentationService, createSeedDocument } from "../testing/mockService";
import { TEST_DECODED_FRAME } from "../testing/nativeFrame";

installSegmentationTestHost();

/** jsdom has no PointerEvent: dispatch a MouseEvent of the pointer type, as the other canvas tests do. */
function pointer(target: Element, type: string, x: number, y: number): void {
  fireEvent(target, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
}

const second = [
  { x: 0.05, y: 0.05 },
  { x: 0.15, y: 0.05 },
  { x: 0.15, y: 0.15 },
];

async function setup() {
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
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 100, f: 50 }),
  });
  for (const name of ["setPointerCapture", "releasePointerCapture"]) {
    Object.defineProperty(SVGElement.prototype, name, { configurable: true, value: jest.fn() });
  }
  Object.defineProperty(SVGElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  // Two polygons of instance-1 on the frame, so the edit scope holds more than one.
  let secondId = "";
  act(() => {
    secondId = store.getState().addPolygon("instance-1", second);
    store.getState().setFocus({ type: "instance", id: "instance-1" });
    store.getState().setSelection([{ type: "instance", id: "instance-1" }]);
    store.getState().setEditing(true);
  });
  render(<SegmentationCanvas decodedFrame={TEST_DECODED_FRAME} store={store} />);
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  const outline = (id: string) => canvas.querySelector(`[data-polygon-id="${id}"]`)!;
  const handlesOf = (id: string) =>
    screen.queryAllByRole("button", { name: new RegExp(`^Vertex \\d+ of polygon ${id}$`) });
  return { store, canvas, outline, handlesOf, firstId: "instance-1-polygon-0", secondId };
}

it("shows vertices only for the active polygon and highlights the rest of the edit scope", async () => {
  const { store, canvas, outline, handlesOf, firstId, secondId } = await setup();
  // No single polygon is chosen yet: nothing shows handles, both are highlighted as the scope.
  expect(handlesOf(firstId)).toHaveLength(0);
  expect(handlesOf(secondId)).toHaveLength(0);
  expect(outline(firstId).getAttribute("data-polygon-emphasis")).toBe("scope");
  expect(outline(secondId).getAttribute("data-polygon-emphasis")).toBe("scope");
  expect(screen.getByTestId("choose-polygon-hint").textContent).toContain("2 polygons");

  // Pressing a polygon in scope makes it the active one; it does not start a drag.
  pointer(outline(secondId), "pointerdown", 150, 70);
  pointer(canvas, "pointerup", 150, 70);
  expect(store.getState().editing).toBe(true);
  expect(handlesOf(secondId)).toHaveLength(3);
  expect(handlesOf(firstId)).toHaveLength(0);
  expect(outline(secondId).getAttribute("data-polygon-emphasis")).toBe("active");
  expect(outline(firstId).getAttribute("data-polygon-emphasis")).toBe("scope");
  expect(screen.queryByTestId("choose-polygon-hint")).toBeNull();

  // Double-clicking the other polygon moves the vertex handles to it.
  pointer(outline(firstId), "pointerdown", 300, 150);
  pointer(canvas, "pointerup", 300, 150);
  fireEvent.doubleClick(outline(firstId), { button: 0 });
  expect(handlesOf(firstId).length).toBeGreaterThanOrEqual(3);
  expect(handlesOf(secondId)).toHaveLength(0);
  expect(outline(firstId).getAttribute("data-polygon-emphasis")).toBe("active");
});
