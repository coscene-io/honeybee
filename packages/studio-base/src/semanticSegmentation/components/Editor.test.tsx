/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";

import { createMockSemanticSegmentationService, createSeedDocument } from "../mockService";
import { frameInstanceKey } from "../service";
import { createSemanticSegmentationStore } from "../store";
import type { SegmentationDocument } from "../types";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { SpatialTree } from "./SpatialTree";

async function setup(configure?: (document: SegmentationDocument) => void) {
  const document = createSeedDocument();
  document.frames = document.frames.slice(0, 2);
  document.annotations = Object.fromEntries(
    Object.entries(document.annotations).filter(([, value]) =>
      document.frames.some((frame) => frame.id === value.frameId),
    ),
  );
  configure?.(document);
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({ document, controls: { delayMs: 0 } }),
  );
  await store.getState().initialize();
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", {
    configurable: true,
    value: jest.fn(),
  });
  const viewportRef = createRef<HTMLDivElement>();
  const result = render(
    <>
      <SpatialTree
        store={store}
        onPointerActivate={() => viewportRef.current?.focus({ preventScroll: true })}
      />
      <SegmentationCanvas store={store} viewportRef={viewportRef} />
    </>,
  );
  return { store, ...result };
}
function pointer(target: Element, type: string, x: number, y: number): void {
  fireEvent(target, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
}

describe("segmentation editor", () => {
  it("creates empty nodes and commits a normalized polygon only after three vertices and Enter", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "  Bicycle  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const category = store.getState().document!.classes.find((item) => item.name === "Bicycle")!;
    expect(category).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Add instance to Bicycle" }));
    const instance = store
      .getState()
      .document!.instances.find((item) => item.classId === category.id)!;
    fireEvent.click(screen.getByRole("button", { name: /Add polygon to.*#1$/ }));
    const polygonId = store.getState().drawingPolygonId!;
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    pointer(canvas, "pointerdown", 96, 54);
    pointer(canvas, "pointerdown", 384, 54);
    fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Enter" });
    expect(screen.getByText("Add at least 3 vertices before pressing Enter.")).toBeDefined();
    expect(store.getState().drawingPolygonId).toBe(polygonId);
    pointer(canvas, "pointerdown", 240, 270);
    fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Enter" });
    const polygon = Object.values(store.getState().document!.annotations).find(
      (annotation) => annotation.instanceId === instance.id,
    )!.polygons[0]!;
    expect(polygon).toEqual({
      id: polygonId,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.1 },
        { x: 0.25, y: 0.5 },
      ],
      topic: "/camera/front",
    });
    expect(store.getState().drawingPolygonId).toBeUndefined();
  });

  it("cancels draft vertices without deleting the stable empty polygon", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /Add polygon to.*Empty instance/ }));
    const id = store.getState().drawingPolygonId;
    pointer(screen.getByRole("img", { name: "Frame polygons" }), "pointerdown", 100, 100);
    fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Escape" });
    expect(store.getState().drawingPolygonId).toBeUndefined();
    expect(
      Object.values(store.getState().document!.annotations)
        .flatMap((annotation) => annotation.polygons)
        .find((polygon) => polygon.id === id)?.points,
    ).toEqual([]);
  });

  it("completes editing on focus switch and keeps display mode across frame switches", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(store.getState().editing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^● Object 1/ }));
    expect(store.getState().editing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(store.getState().editing).toBe(true);
    expect(store.getState().focus).toEqual({ type: "instance", id: "instance-2" });
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    act(() => {
      store.getState().setCurrentFrame("frame-1");
    });
    expect(store.getState().viewMode).toBe("original");
    expect(store.getState().editing).toBe(true);
    expect(
      screen.getByRole("img", { name: "Frame polygons" }).querySelectorAll("path"),
    ).toHaveLength(0);
  });

  describe("entering and leaving polygon edit mode", () => {
    const polygonRow = (container: HTMLElement, id: string) =>
      container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
    const polygonButton = (container: HTMLElement, id: string) =>
      within(polygonRow(container, id)).getByRole("button", { name: /^Polygon 1/ });

    it("Enter on a tree polygon row starts editing and Enter again finishes", async () => {
      const { store, container } = await setup();
      fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
      fireEvent.click(screen.getByRole("button", { name: "Instance" }));
      const button = polygonButton(container, "instance-1-polygon-0");
      fireEvent.click(button);
      expect(store.getState().editing).toBe(false);
      fireEvent.keyDown(button, { key: "Enter" });
      expect(store.getState().editing).toBe(true);
      expect(screen.queryAllByRole("button", { name: /^Vertex/ }).length).toBeGreaterThan(0);
      fireEvent.keyDown(button, { key: "Enter" });
      expect(store.getState().editing).toBe(false);
      expect(screen.queryAllByRole("button", { name: /^Vertex/ })).toHaveLength(0);
    });

    it("double-clicking a polygon row edits it", async () => {
      const { store, container } = await setup();
      fireEvent.doubleClick(polygonButton(container, "instance-1-polygon-0"));
      expect(store.getState().editing).toBe(true);
      expect(store.getState().selection).toEqual([{ type: "polygon", id: "instance-1-polygon-0" }]);
    });

    it("double-clicking a polygon on the canvas edits it, also from the original view", async () => {
      const { store, container } = await setup();
      const canvas = screen.getByRole("img", { name: "Frame polygons" });
      fireEvent.click(screen.getByRole("button", { name: "Original" }));
      act(() => {
        store.getState().setViewMode("all");
      });
      const path = canvas.querySelector<SVGPathElement>('[data-instance-id="instance-1"] path')!;
      expect(store.getState().editing).toBe(false);
      fireEvent.doubleClick(path);
      expect(store.getState().editing).toBe(true);
      expect(store.getState().selection).toEqual([{ type: "polygon", id: "instance-1-polygon-0" }]);
      expect(polygonRow(container, "instance-1-polygon-0")).toBeTruthy();
    });

    it("switching to another polygon completes the edit of the first", async () => {
      const { store } = await setup();
      const canvas = screen.getByRole("img", { name: "Frame polygons" });
      const first = canvas.querySelector<SVGPathElement>('[data-instance-id="instance-1"] path')!;
      const second = canvas.querySelector<SVGPathElement>('[data-instance-id="instance-2"] path')!;
      fireEvent.doubleClick(first);
      expect(store.getState().editing).toBe(true);
      pointer(second, "pointerdown", 100, 100);
      pointer(canvas, "pointerup", 100, 100);
      expect(store.getState().focus).toEqual({ type: "instance", id: "instance-2" });
      expect(store.getState().editing).toBe(false);
    });
  });

  it("deletes only the current frame when requested, keeping the instance and other frame", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      store.getState().document!.instances.some((instance) => instance.id === "instance-1"),
    ).toBe(true);
    expect(
      Object.values(store.getState().document!.annotations).some(
        (annotation) => annotation.frameId === "frame-0" && annotation.instanceId === "instance-1",
      ),
    ).toBe(false);
    expect(
      Object.values(store.getState().document!.annotations).some(
        (annotation) => annotation.frameId === "frame-1" && annotation.instanceId === "instance-1",
      ),
    ).toBe(true);
  });

  it("merges selected instances through a target dialog and retains polygon IDs", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select.*Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Target instance" }));
    fireEvent.click(screen.getByRole("option", { name: /Object 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      store.getState().document!.instances.some((instance) => instance.id === "instance-1"),
    ).toBe(false);
    expect(
      Object.values(store.getState().document!.annotations)
        .find(
          (annotation) =>
            annotation.instanceId === "instance-2" && annotation.frameId === "frame-0",
        )
        ?.polygons.map((polygon) => polygon.id),
    ).toContain("instance-1-polygon-0");
  });

  it("edits only focused geometry and translates a whole polygon without distorting it", async () => {
    const { store } = await setup();
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-1" });
      store.getState().setEditing(true);
    });
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    expect(canvas.querySelectorAll("circle[aria-label]")).toHaveLength(4);
    const path = canvas.querySelector(
      '[data-instance-id="instance-1"] [data-testid="instance-union-fill"] path',
    )!;
    pointer(path, "pointerdown", 200, 200);
    pointer(canvas, "pointermove", 248, 227);
    pointer(canvas, "pointerup", 248, 227);
    const polygon = Object.values(store.getState().document!.annotations).find(
      (annotation) => annotation.frameId === "frame-0" && annotation.instanceId === "instance-1",
    )!.polygons[0]!;
    expect(polygon.points[0]!.x).toBeCloseTo(0.22);
    expect(polygon.points[0]!.y).toBeCloseTo(0.35);
    expect(polygon.points[1]!.x - polygon.points[0]!.x).toBeCloseTo(0.15);
    expect(canvas.querySelectorAll('[data-testid="instance-union-fill"]')).toHaveLength(4);
    expect(
      canvas.querySelector('[data-testid="instance-union-fill"]')?.getAttribute("opacity"),
    ).toBe("0.35");
  });

  it("SEG-RFX-024 inserts on an edge, Alt-deletes a vertex, undoes each gesture and persists submission", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const key = frameInstanceKey("frame-0", "instance-1");
    const polygonId = "instance-1-polygon-0";
    const points = () => store.getState().document!.annotations[key]!.polygons[0]!.points;
    const original = points();
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const edge = () => canvas.querySelector('[data-instance-id="instance-1"] path[stroke]')!;
    const midpoint = {
      x: (original[0]!.x + original[1]!.x) / 2,
      y: (original[0]!.y + original[1]!.y) / 2,
    };
    pointer(edge(), "pointerdown", midpoint.x * 960, midpoint.y * 540);
    pointer(canvas, "pointerup", midpoint.x * 960, midpoint.y * 540);
    const inserted = [original[0]!, midpoint, ...original.slice(1)];
    expect(points()).toEqual(inserted);
    expect(store.getState().stagedOperations).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Polygon 1 5 vertices" })).toBeDefined();
    fireEvent(
      screen.getByRole("button", { name: `Vertex 2 of polygon ${polygonId}` }),
      new MouseEvent("pointerdown", { bubbles: true, button: 0, altKey: true }),
    );
    pointer(canvas, "pointerup", 0, 0);
    expect(points()).toEqual(original);
    expect(store.getState().stagedOperations).toHaveLength(2);
    act(() => {
      store.getState().undo();
    });
    expect(points()).toEqual(inserted);
    act(() => {
      store.getState().undo();
    });
    expect(points()).toEqual(original);
    expect(store.getState().stagedOperations).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    pointer(edge(), "pointerdown", midpoint.x * 960, midpoint.y * 540);
    pointer(canvas, "pointerup", midpoint.x * 960, midpoint.y * 540);
    act(() => {
      store.getState().submit();
    });
    await act(async () => {
      await store.getState().waitForSubmissions();
    });
    expect(store.getState().submissionQueue.at(-1)?.status).toBe("succeeded");
    await act(async () => {
      await store.getState().initialize();
    });
    expect(points()).toEqual(inserted);
    expect(store.getState().stagedOperations).toHaveLength(0);
  });

  it("projects an inserted vertex after zoom and pan, ignores the interior and keeps three vertices", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 2, b: 0, c: 0, d: 2, e: 110, f: 95 }),
    });
    const key = frameInstanceKey("frame-0", "instance-1");
    const points = () => store.getState().document!.annotations[key]!.polygons[0]!.points;
    const original = points();
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const fill = () => canvas.querySelector('[data-instance-id="instance-1"] path')!;
    pointer(
      fill(),
      "pointerdown",
      (original[0]!.x + original[1]!.x) * 960 + 110,
      original[0]!.y * 540 * 2 + 95 + 4,
    );
    expect(points()[1]!.x).toBeCloseTo((original[0]!.x + original[1]!.x) / 2);
    expect(points()[1]!.y).toBe(original[0]!.y);
    const count = points().length;
    pointer(fill(), "pointerdown", 550, 500);
    pointer(canvas, "pointerup", 550, 500);
    expect(points()).toHaveLength(count);
    const removeFirst = () =>
      fireEvent(
        screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" }),
        new MouseEvent("pointerdown", { bubbles: true, button: 0, altKey: true }),
      );
    removeFirst();
    removeFirst();
    expect(points()).toHaveLength(3);
    const before = points();
    const operations = store.getState().stagedOperations.length;
    removeFirst();
    expect(points()).toEqual(before);
    expect(store.getState().stagedOperations).toHaveLength(operations);
    expect(screen.getByText("A polygon must keep at least 3 vertices.")).toBeDefined();
  });

  it.each([
    "view",
    "unfocused",
    "readonly",
    "running",
    "stopping",
    "pan",
    "drawing",
    "disabled",
    "original",
  ])("blocks vertex gestures in %s mode", async (mode) => {
    const { store, rerender } = await setup();
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-1" });
      store.getState().setEditing(true);
    });
    const key = frameInstanceKey("frame-0", "instance-1");
    const before = store.getState().document;
    const oldHandle = screen.getByRole("button", {
      name: "Vertex 1 of polygon instance-1-polygon-0",
    });
    act(() => {
      if (mode === "view") {
        store.getState().setEditing(false);
      }
      if (mode === "unfocused") {
        store.getState().setFocus({ type: "instance", id: "instance-2" });
      }
      if (mode === "readonly") {
        store.setState({ readonly: true });
      }
      if (mode === "running" || mode === "stopping") {
        store.setState({ propagation: { status: mode, processedFrames: 0 } });
      }
      if (mode === "drawing") {
        store.getState().setDrawingPolygonId("instance-1-polygon-0");
      }
      if (mode === "original") {
        store.getState().setViewMode("original");
      }
    });
    if (mode === "pan") {
      fireEvent.click(screen.getByRole("button", { name: "Pan" }));
    }
    if (mode === "disabled") {
      rerender(<SegmentationCanvas store={store} disabled />);
    }
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const path = canvas.querySelector('[data-instance-id="instance-1"] path[stroke]');
    if (path) {
      const points = before!.annotations[key]!.polygons[0]!.points;
      pointer(path, "pointerdown", (points[0]!.x + points[1]!.x) * 480, points[0]!.y * 540);
      pointer(canvas, "pointerup", (points[0]!.x + points[1]!.x) * 480, points[0]!.y * 540);
    }
    fireEvent(oldHandle, new MouseEvent("pointerdown", { bubbles: true, button: 0, altKey: true }));
    expect(store.getState().document).toEqual(before);
    expect(store.getState().stagedOperations).toHaveLength(0);
  });

  it("previews edge insertion, highlights vertices and clears feedback without staging geometry", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const points =
      store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!
        .polygons[0]!.points;
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const x = (points[0]!.x + points[1]!.x) * 480;
    const y = points[0]!.y * 540;
    pointer(canvas, "pointermove", x, y);
    expect(screen.getByTestId("edge-insert-indicator").getAttribute("transform")).toBe(
      `translate(${x} ${y})`,
    );
    expect(canvas.style.cursor).toBe("copy");
    pointer(canvas, "pointermove", points[0]!.x * 960, y);
    expect(screen.queryByTestId("edge-insert-indicator")).toBeNull();
    expect(
      screen.getAllByTestId("vertex-handle-visible")[0]!.getAttribute("data-highlighted"),
    ).toBe("true");
    fireEvent.pointerLeave(canvas);
    expect(
      screen
        .getAllByTestId("vertex-handle-visible")
        .every((handle) => handle.getAttribute("data-highlighted") === "false"),
    ).toBe(true);
    pointer(canvas, "pointermove", x, y);
    fireEvent.click(screen.getByRole("button", { name: "Pan" }));
    expect(screen.queryByTestId("edge-insert-indicator")).toBeNull();
    expect(store.getState().stagedOperations).toHaveLength(0);
  });

  it("uses screen-sized visible handles and forgiving hit areas after fitted scaling and zoom", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const expectOutlineWidths = () => {
      for (const [instanceId, width] of [
        ["instance-1", 2],
        ["instance-2", 1],
      ] as const) {
        const outlines = canvas.querySelectorAll(
          `[data-instance-id="${instanceId}"] path[fill="none"]`,
        );
        expect(outlines.length).toBeGreaterThan(0);
        for (const outline of outlines) {
          expect(Number(outline.getAttribute("stroke-width"))).toBe(width);
          expect(outline.getAttribute("vector-effect")).toBe("non-scaling-stroke");
        }
      }
    };
    expectOutlineWidths();
    Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 3, b: 0, c: 0, d: 3, e: 100, f: 60 }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const visible = screen.getAllByTestId("vertex-handle-visible")[0]!;
    expect(Number(visible.getAttribute("r")) * 3).toBeCloseTo(4.5);
    expect(Number(visible.getAttribute("stroke-width")) * 3).toBeCloseTo(1.5);
    const expectDotDiameter = () => {
      expect(
        (Number(visible.getAttribute("r")) * 2 + Number(visible.getAttribute("stroke-width"))) * 3,
      ).toBeCloseTo(10.5);
    };
    expectDotDiameter();
    expectOutlineWidths();
    const hit = screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" });
    expect(Number(hit.getAttribute("r")) * 3).toBeCloseTo(8);
    fireEvent.pointerEnter(hit);
    expectDotDiameter();
    expect(visible.getAttribute("data-highlighted")).toBe("true");
    fireEvent.pointerLeave(hit);
    expect(visible.getAttribute("data-highlighted")).toBe("false");
    pointer(hit, "pointerdown", 100, 100);
    expect(visible.getAttribute("data-selected")).toBe("true");
    expect(visible.getAttribute("data-highlighted")).toBe("true");
    expectDotDiameter();
    fireEvent.pointerCancel(canvas);
  });

  it("accepts the indicated edge just outside the filled polygon and prioritizes nearby vertices", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const key = frameInstanceKey("frame-0", "instance-1");
    const points = store.getState().document!.annotations[key]!.polygons[0]!.points;
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    pointer(canvas, "pointerdown", points[0]!.x * 960 + 2, points[0]!.y * 540);
    pointer(canvas, "pointerup", points[0]!.x * 960 + 2, points[0]!.y * 540);
    expect(store.getState().stagedOperations).toHaveLength(0);
    pointer(canvas, "pointerdown", (points[0]!.x + points[1]!.x) * 480, points[0]!.y * 540 - 4);
    pointer(canvas, "pointerup", (points[0]!.x + points[1]!.x) * 480, points[0]!.y * 540 - 4);
    const edited = store.getState().document!.annotations[key]!.polygons[0]!.points;
    expect(edited).toHaveLength(5);
    expect(edited[1]!.y).toBe(points[0]!.y);
  });

  it("deletes the selected vertex with Delete and keeps at least three points", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /^● Person 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const key = frameInstanceKey("frame-0", "instance-1");
    const points = () => store.getState().document!.annotations[key]!.polygons[0]!.points;
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const edge = () => canvas.querySelector('[data-instance-id="instance-1"] path[stroke]')!;
    const original = points();
    const midpoint = {
      x: (original[0]!.x + original[1]!.x) / 2,
      y: (original[0]!.y + original[1]!.y) / 2,
    };
    pointer(edge(), "pointerdown", midpoint.x * 960, midpoint.y * 540);
    pointer(canvas, "pointerup", midpoint.x * 960, midpoint.y * 540);
    expect(points()).toHaveLength(5);
    const viewport = screen.getByLabelText("Segmentation canvas");
    fireEvent.keyDown(viewport, { key: "Delete" });
    expect(points()).toEqual(original);
    fireEvent.keyDown(viewport, { key: "Backspace" });
    fireEvent.keyDown(viewport, { key: "Backspace" });
    expect(points()).toHaveLength(3);
    const before = points();
    const operations = store.getState().stagedOperations.length;
    fireEvent.keyDown(viewport, { key: "Delete" });
    expect(points()).toEqual(before);
    expect(store.getState().stagedOperations).toHaveLength(operations);
    expect(screen.getByText("A polygon must keep at least 3 vertices.")).toBeDefined();
  });

  it("keeps drawing guidance and validation inside the viewport overlay", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Add polygon to.*Empty instance/ }));
    const viewport = screen.getByTestId("segmentation-viewport");
    pointer(screen.getByRole("img", { name: "Frame polygons" }), "pointerdown", 100, 100);
    fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Enter" });
    expect(
      viewport.contains(screen.getByText("Add at least 3 vertices before pressing Enter.")),
    ).toBe(true);
    const notices = screen.getByTestId("canvas-notices");
    expect(getComputedStyle(notices).position).toBe("absolute");
    expect(within(notices).getAllByRole("alert")).toHaveLength(2);
    fireEvent.click(
      within(within(notices).getAllByRole("alert")[0]!).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByText("Add at least 3 vertices before pressing Enter.")).toBeNull();
    expect(screen.getByText(/Click to add vertices. Enter finishes/)).toBeDefined();
  });

  it("nests polygons under their instance and class, with independent collapse controls", async () => {
    const { container } = await setup();
    const category = container.querySelector('[data-node-id="class-1"]')!;
    const instance = container.querySelector('[data-node-id="instance-1"]')!;
    const polygon = container.querySelector('[data-node-id="instance-1-polygon-0"]')!;
    expect(instance.parentElement?.getAttribute("role")).toBe("group");
    expect(instance.parentElement?.parentElement).toBe(category);
    expect(polygon.parentElement?.getAttribute("role")).toBe("group");
    expect(polygon.parentElement?.parentElement).toBe(instance);
    expect([category, instance, polygon].map((node) => node.getAttribute("aria-level"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse ● Person 1" }));
    expect(container.querySelector('[data-node-id="instance-1-polygon-0"]')).toBeNull();
    expect(container.querySelector('[data-node-id="instance-2-polygon-0"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand ● Person 1" }));
    expect(container.querySelector('[data-node-id="instance-1-polygon-0"]')).not.toBeNull();
  });
  it.each([
    ["class", "class"],
    ["class", "instance"],
    ["class", "polygon"],
    ["instance", "class"],
    ["instance", "instance"],
    ["instance", "polygon"],
    ["polygon", "class"],
    ["polygon", "instance"],
    ["polygon", "polygon"],
  ] as const)(
    "supports %s to %s drag without losing stable destination IDs",
    async (sourceType, targetType) => {
      const { store, container } = await setup();
      const sourceId =
        sourceType === "class"
          ? "class-1"
          : sourceType === "instance"
            ? "instance-1"
            : "instance-1-polygon-0";
      const targetId =
        targetType === "class"
          ? "class-2"
          : targetType === "instance"
            ? "instance-2"
            : "instance-2-polygon-0";
      const before = store.getState().document;
      const source = container.querySelector(`[data-node-id="${sourceId}"]`)!;
      const targetRow = container.querySelector(`[data-node-id="${targetId}"]`)!;
      const dataTransfer = { setData: jest.fn(), effectAllowed: "", dropEffect: "" };
      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(targetRow, { dataTransfer });
      expect(screen.getByRole("status").textContent).toMatch(/Drop onto/);
      fireEvent.drop(targetRow, { dataTransfer });
      if (sourceType !== "polygon") {
        expect(store.getState().document).toEqual(before);
        const dialog = screen.getByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
      }
      const document = store.getState().document!;
      expect(document.classes.some((item) => item.id === "class-1")).toBe(true);
      expect(
        document.instances.some((item) => item.id === "instance-2" && item.classId === "class-2"),
      ).toBe(true);
      if (targetType === "class" && sourceType !== "polygon") {
        expect(document.instances.find((item) => item.id === "instance-1")?.classId).toBe(
          "class-2",
        );
      } else {
        const owner = Object.values(document.annotations).find(
          (annotation) =>
            annotation.frameId === "frame-0" &&
            annotation.polygons.some((polygon) => polygon.id === "instance-1-polygon-0"),
        )!;
        expect(document.instances.find((item) => item.id === owner.instanceId)?.classId).toBe(
          "class-2",
        );
        if (targetType !== "class") {
          expect(owner.instanceId).toBe("instance-2");
        }
        expect(owner.polygons.some((polygon) => polygon.id === "instance-1-polygon-0")).toBe(true);
      }
      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document).toEqual(before);
    },
  );

  it("rejects a drag after frame context changes", async () => {
    const { store, container } = await setup();
    const dataTransfer = { setData: jest.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(container.querySelector('[data-node-id="instance-1"]')!, { dataTransfer });
    act(() => {
      store.getState().setCurrentFrame("frame-1");
    });
    fireEvent.drop(container.querySelector('[data-node-id="class-2"]')!, { dataTransfer });
    expect(store.getState().stagedOperations).toHaveLength(0);
    expect(screen.getByText(/The frame or view changed/)).toBeDefined();
  });

  it("shows tri-state parent selection and can deselect a child of a selected class", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Person" }));
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /Select.*Person 1/ }).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Select.*Person 1/ }));
    expect(
      screen.getByRole("checkbox", { name: "Select Person" }).getAttribute("data-indeterminate"),
    ).toBe("true");
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /Select.*Empty instance/ }).checked,
    ).toBe(true);
  });

  it("moves a focused vertex by keyboard while retaining subpixel coordinates", async () => {
    const { store } = await setup();
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-1" });
      store.getState().setEditing(true);
    });
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Vertex 1 of polygon instance-1-polygon-0" }),
      { key: "ArrowRight" },
    );
    const point = Object.values(store.getState().document!.annotations).find(
      (item) => item.frameId === "frame-0" && item.instanceId === "instance-1",
    )!.polygons[0]!.points[0]!;
    expect(point.x).toBeCloseTo(0.171);
    expect(point.y).toBe(0.3);
  });
  it("offers no fullscreen control in the view popover", async () => {
    await setup();
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "全屏" })).toBeNull();
  });

  it("switches the independent green presence marker and accessible description from frame 10 to 11", async () => {
    const { store, container } = await setup((document) => {
      const full = createSeedDocument();
      document.frames = full.frames;
      document.annotations = full.annotations;
      const absent = frameInstanceKey("frame-11", "instance-1");
      delete document.annotations[absent];
      delete document.annotationSummaries[absent];
    });
    act(() => {
      store.getState().setCurrentFrame("frame-10");
    });
    const instanceRow = container.querySelector('[data-node-id="instance-1"]');
    const glyph = screen.getByTestId("instance-presence-instance-1");
    expect(glyph.textContent).toBe("●");
    expect(glyph.style.color).toBe("rgb(46, 125, 50)");
    const present = screen.getByRole("button", { name: "● Person 1" });
    expect(document.getElementById(present.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Present in current frame",
    );
    act(() => {
      store.getState().setCurrentFrame("frame-11");
    });
    expect(glyph.textContent).toBe("○");
    const absent = screen.getByRole("button", { name: "○ Person 1" });
    expect(document.getElementById(absent.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Absent in current frame",
    );
    expect(container.querySelector('[data-node-id="instance-1"]')).toBe(instanceRow);
    expect(store.getState().document!.classes.find((item) => item.id === "class-1")?.color).toBe(
      "#55b8de",
    );
  });

  it("cancels a geometry drag if the focused object changes before release", async () => {
    const { store } = await setup();
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-1" });
      store.getState().setEditing(true);
    });
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const path = canvas.querySelector(
      '[data-instance-id="instance-1"] [data-testid="instance-union-fill"] path',
    )!;
    pointer(path, "pointerdown", 200, 200);
    pointer(canvas, "pointermove", 248, 227);
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-2" });
    });
    pointer(canvas, "pointerup", 248, 227);
    expect(store.getState().stagedOperations).toHaveLength(0);
  });

  it("renames a class through its context menu without changing entity IDs", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Person" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename class" }));
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Operator" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(store.getState().document!.classes.find((item) => item.id === "class-1")?.name).toBe(
      "Operator",
    );
    expect(
      store.getState().document!.instances.find((item) => item.id === "instance-1")?.classId,
    ).toBe("class-1");
  });

  it("exposes explicit instance deletion scopes and retires all frames only after confirmation", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Actions for ● Person 1" }));
    expect(
      screen.getByRole("menuitem", { name: "Delete instance in current frame…" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete instance in all frames…" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "All frames" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      store.getState().document!.instances.some((instance) => instance.id === "instance-1"),
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      store.getState().document!.instances.some((instance) => instance.id === "instance-1"),
    ).toBe(false);
    expect(
      Object.values(store.getState().document!.annotations).some(
        (annotation) => annotation.instanceId === "instance-1",
      ),
    ).toBe(false);
  });
  it("rejects a drop outside the active focus without staging any change", async () => {
    const { store, container } = await setup();
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-1" });
    });
    const dataTransfer = { setData: jest.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(container.querySelector('[data-node-id="instance-2"]')!, { dataTransfer });
    fireEvent.drop(container.querySelector('[data-node-id="class-1"]')!, { dataTransfer });
    expect(store.getState().stagedOperations).toHaveLength(0);
    expect(screen.getByText("Select this object to focus it before dragging.")).toBeDefined();
  });

  it("rejects a frame-scoped delete confirmation after an external timeline frame switch", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Actions for ● Person 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete instance in current frame…" }));
    act(() => {
      store.getState().setCurrentFrame("frame-1");
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(store.getState().stagedOperations).toHaveLength(0);
    expect(screen.getByText("Error: The frame or view changed. Reopen this action.")).toBeDefined();
  });

  it("confirms deletion of a class and every instance instead of applying from the menu", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Person" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete class and all instances" }));
    expect(store.getState().stagedOperations).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(store.getState().document!.classes.some((category) => category.id === "class-1")).toBe(
      false,
    );
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().document!.classes.some((category) => category.id === "class-1")).toBe(
      true,
    );
  });
  it("rejects a focused instance drag into an excluded destination", async () => {
    const { store, container } = await setup();
    act(() => {
      store.getState().setFocus({ type: "instance", id: "instance-1" });
    });
    const dataTransfer = { setData: jest.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(container.querySelector('[data-node-id="instance-1"]')!, { dataTransfer });
    fireEvent.dragOver(container.querySelector('[data-node-id="instance-2"]')!, { dataTransfer });
    expect(screen.getByRole("status").textContent).toContain("outside the active focus");
    fireEvent.drop(container.querySelector('[data-node-id="instance-2"]')!, { dataTransfer });
    expect(store.getState().stagedOperations).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("outside the active focus");
  });

  it("shows expanded stable source IDs before a destructive class action", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Person" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete class and all instances" }));
    expect(screen.getByLabelText("Affected class IDs").textContent).toBe("class-1");
    expect(screen.getByLabelText("Affected instance IDs").textContent).toContain("instance-1");
    expect(screen.getByLabelText("Affected instance IDs").textContent).toContain("instance-empty");
  });
  it("opens an autofocus creation row below the class list and validates without staging", async () => {
    const { store } = await setup();
    const before = store.getState().document;
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const row = screen.getByRole("group", { name: "New class row" });
    expect(screen.getByRole("tree").lastElementChild).toBe(row);
    expect(screen.queryByRole("dialog")).toBeNull();
    const input = within(row).getByLabelText("Class name");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(row).getByText("Enter a class name of 1–100 characters.")).toBeDefined();
    expect(store.getState().document).toEqual(before);
    expect(store.getState().stagedOperations).toHaveLength(0);
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "New class row" })).toBeNull();
    expect(store.getState().document).toEqual(before);
  });

  it("commits a trimmed inline name with Enter and discards a later row on Cancel", async () => {
    const { store } = await setup();
    const existing = store.getState().document!;
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const input = screen.getByLabelText("Class name");
    fireEvent.change(input, { target: { value: "  Bicycle  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store.getState().document!.classes.some((category) => category.name === "Bicycle")).toBe(
      true,
    );
    expect(store.getState().document!.instances).toEqual(existing.instances);
    expect(store.getState().document!.classes).toHaveLength(existing.classes.length + 1);
    const committed = store.getState().document;
    const stagedCount = store.getState().stagedOperations.length;
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.getState().document).toEqual(committed);
    expect(store.getState().stagedOperations).toHaveLength(stagedCount);
  });
  it("explains disabled Instance view when no target is selected", async () => {
    const { store } = await setup();
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Instance" });
    expect(button.disabled).toBe(true);
    const hint = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe("Select or create an instance before using Instance view.");
    fireEvent.click(button);
    expect(store.getState().focus).toBeUndefined();
    expect(store.getState().viewMode).toBe("all");
  });

  it("rejects an inline creation draft after switching stores for the same record", async () => {
    const { store, rerender } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Old user draft" } });
    const otherStore = createSemanticSegmentationStore(
      createMockSemanticSegmentationService({ controls: { delayMs: 0 } }),
    );
    await otherStore.getState().initialize();
    const oldClasses = store.getState().document!.classes;
    const otherClasses = otherStore.getState().document!.classes;
    expect(otherStore.getState().document!.record.id).toBe(store.getState().document!.record.id);
    rerender(
      <>
        <SpatialTree store={otherStore} />
        <SegmentationCanvas store={otherStore} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      screen.getByText("Error: The annotation session changed. Cancel and start again."),
    ).toBeDefined();
    expect(store.getState().document!.classes).toEqual(oldClasses);
    expect(otherStore.getState().document!.classes).toEqual(otherClasses);
    expect(store.getState().stagedOperations).toHaveLength(0);
    expect(otherStore.getState().stagedOperations).toHaveLength(0);
  });

  it("places an outside drawing click on the nearest image point without staging it", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: /Add polygon to.*Empty instance/ }));
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    const before = store.getState().stagedOperations.length;
    pointer(canvas, "pointermove", -20, 50);
    expect(canvas.querySelector("polyline")?.getAttribute("points") ?? "").toBe("");
    pointer(canvas, "pointerdown", -20, 50);
    expect(canvas.querySelector("polyline")?.getAttribute("points")).toBe("0,50");
    pointer(canvas, "pointerdown", 2000, -10);
    expect(canvas.querySelector("polyline")?.getAttribute("points")).toBe("0,50 960,0");
    expect(store.getState().stagedOperations).toHaveLength(before);
    Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }),
    });
    pointer(canvas, "pointerdown", 100, 100);
    expect(
      screen.getByText("The pointer cannot be mapped to this frame. Use Fit and try again."),
    ).toBeDefined();
    expect(canvas.querySelector("polyline")?.getAttribute("points")).toBe("0,50 960,0");
    expect(store.getState().stagedOperations).toHaveLength(before);
  });

  it("disables bulk actions after their selected draft is reverted", async () => {
    const { store } = await setup();
    act(() => {
      const id = store.getState().addPolygon("instance-empty");
      store.getState().setSelection([{ type: "polygon", id }]);
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete" }).disabled).toBe(false);
    act(() => {
      store.getState().revertStaging();
    });
    expect(store.getState().selection).toEqual([]);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Merge" }).disabled).toBe(true);
  });
});

it("returns pointer-selected objects and Edit to the viewport while keeping keyboard tool focus", async () => {
  await setup();
  jest.useFakeTimers();
  const viewport = screen.getByRole("group", { name: "Annotation viewport" });
  const person = screen.getByRole("button", { name: /^● Person 1/ });
  fireEvent.click(person, { detail: 1 });
  expect(document.activeElement).toBe(viewport);
  const edit = screen.getByRole("button", { name: "Edit" });
  fireEvent.click(edit, { detail: 1 });
  expect(document.activeElement).toBe(viewport);
  await act(async () => {
    edit.focus();
    await Promise.resolve();
  });
  fireEvent.click(edit, { detail: 0 });
  expect(document.activeElement).toBe(edit);
  const pan = screen.getByRole("button", { name: "Pan" });
  await act(async () => {
    pan.focus();
    await Promise.resolve();
  });
  fireEvent.click(pan, { detail: 0 });
  expect(document.activeElement).toBe(pan);
  fireEvent.click(pan, { detail: 1 });
  expect(document.activeElement).toBe(viewport);
  await act(async () => {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
  });
  jest.useRealTimers();
});
