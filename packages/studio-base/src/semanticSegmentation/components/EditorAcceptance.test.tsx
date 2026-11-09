/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { createMockSemanticSegmentationService, createSeedDocument } from "../mockService";
import { frameInstanceKey } from "../service";
import { createSemanticSegmentationStore } from "../store";
import type { NormalizedPoint, SegmentationDocument } from "../types";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { SpatialTree } from "./SpatialTree";

// Contract: the original Given/When/Then in requirements.csv, not the preaudit wording.
function fixture(frameCount: number, present: (frame: number, instance: number) => boolean) {
  const document = createSeedDocument();
  const firstFrame = document.frames[0]!;
  document.frames = Array.from({ length: frameCount }, (_, index) => ({
    ...firstFrame,
    id: `frame-${index}`,
    index,
    timestampSec: index / 5,
  }));
  document.videos[0]!.durationSec = frameCount / 5;
  document.classes = [{ id: "class-c", name: "C", color: "#55b8de" }];
  document.instances = [0, 1, 2].map((index) => ({
    id: `instance-${index}`,
    classId: "class-c",
    name: `I${index}`,
  }));
  document.annotations = {};
  document.annotationSummaries = {};
  document.versions = {};
  for (const frame of document.frames) {
    for (const [index, instance] of document.instances.entries()) {
      if (!present(frame.index, index)) {
        continue;
      }
      const key = frameInstanceKey(frame.id, instance.id);
      document.annotations[key] = {
        frameId: frame.id,
        instanceId: instance.id,
        version: 1,
        polygons: [
          {
            id: `${instance.id}-polygon-${frame.index}`,
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.4, y: 0.1 },
              { x: 0.25, y: 0.5 },
            ],
          },
        ],
      };
      document.annotationSummaries[key] = { polygonCount: 1, pointCount: 3 };
      document.versions[key] = 1;
    }
  }
  return document;
}

async function setup(document: SegmentationDocument) {
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({ document, controls: { delayMs: 0 } }),
  );
  await store.getState().initialize();
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
  const result = render(
    <>
      <SpatialTree store={store} />
      <SegmentationCanvas store={store} />
    </>,
  );
  return { store, ...result };
}

function pointer(target: Element, x: number, y: number) {
  fireEvent(
    target,
    new MouseEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }),
  );
}

// Deliberately irregular across the full clip, including absent frames beside present ones.
const knownPresence = new Set([
  0, 2, 5, 7, 8, 11, 14, 15, 19, 21, 24, 25, 27, 30, 31, 34, 38, 40, 43, 45, 48, 51, 55, 59,
]);

function expectPresenceStrip(current: number) {
  const strip = screen.getByLabelText("Presence around current frame for I0");
  const cells = Array.from(strip.children) as HTMLElement[];
  expect(cells).toHaveLength(41);
  expect(cells.filter((cell) => cell.title.startsWith("Current frame:"))).toHaveLength(1);
  const presentColor = "rgb(85, 184, 222)";
  for (const [position, cell] of cells.entries()) {
    const offset = position - 20;
    const frame = current + offset;
    const available = frame >= 0 && frame < 60;
    const present = available && knownPresence.has(frame);
    const label = offset === 0 ? "Current frame" : `Frame ${offset > 0 ? "+" : ""}${offset}`;
    expect(cell.title).toBe(
      `${label}: ${!available ? "outside video" : present ? "present" : "absent"}`,
    );
    expect(cell.style.opacity).toBe(available ? "1" : "0.25");
    expect(cell.style.height).toBe(offset === 0 ? "9px" : "6px");
    expect(cell.style.outline).toBe(offset === 0 ? "1px solid #55b8de" : "");
    if (present) {
      expect(cell.style.backgroundColor).toBe(presentColor);
    } else {
      expect(cell.style.backgroundColor).not.toBe(presentColor);
    }
  }
  return cells;
}

describe("editor original GWT acceptance", () => {
  it("SEG-TREE-007 labels current-frame presence 2 and total identities 3", async () => {
    await setup(fixture(2, (_frame, instance) => instance < 2));
    const classRow = screen.getByRole("button", { name: "C 2 present / 3 total" });
    expect(within(classRow).getByText("2 present / 3 total")).toBeDefined();
    expect(screen.getByRole("button", { name: "● I0" })).toBeDefined();
    expect(screen.getByRole("button", { name: "● I1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "○ I2" })).toBeDefined();
  });

  it("SEG-TREE-008 deleting one current-frame polygon decrements presence once and retains identities", async () => {
    const { store } = await setup(fixture(2, (_frame, instance) => instance < 2));
    const identities = store.getState().document!.instances;
    expect(screen.getByRole("button", { name: "C 2 present / 3 total" })).toBeDefined();
    const polygonRow = screen
      .getByRole("tree")
      .querySelector('[data-node-id="instance-0-polygon-0"]')!;
    fireEvent.click(
      within(polygonRow as HTMLElement).getByRole("button", { name: "Delete Polygon 1" }),
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("button", { name: "C 1 present / 3 total" })).toBeDefined();
    expect(screen.getByRole("button", { name: "○ I0" })).toBeDefined();
    expect(screen.getByRole("button", { name: "● I1" })).toBeDefined();
    expect(store.getState().document!.instances).toEqual(identities);
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-0")]?.polygons ??
        [],
    ).toEqual([]);
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-1", "instance-0")]!.polygons,
    ).toHaveLength(1);
    expect(store.getState().stagedOperations).toHaveLength(1);
  });

  it("SEG-DRAW-004 dismissing help preserves two draft vertices and drawing can continue", async () => {
    const { store } = await setup(fixture(2, (_frame, instance) => instance < 2));
    fireEvent.click(screen.getByRole("button", { name: "Add polygon to ○ I2" }));
    const polygonId = store.getState().drawingPolygonId!;
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    pointer(canvas, 96, 54);
    pointer(canvas, 384, 54);
    expect(screen.getByText(/^Drawing: 2 vertices · /)).toBeDefined();
    const draftPoints = canvas.querySelector("polyline")!.getAttribute("points");
    const operations = store.getState().stagedOperations;
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Drawing help" })).toBeDefined();
    expect(screen.getByText(/^Drawing: 2 vertices · /)).toBeDefined();
    expect(canvas.querySelector("polyline")!.getAttribute("points")).toBe(draftPoints);
    expect(store.getState().drawingPolygonId).toBe(polygonId);
    expect(store.getState().stagedOperations).toEqual(operations);
    pointer(canvas, 240, 270);
    expect(screen.getByText(/^Drawing: 3 vertices · /)).toBeDefined();
    fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Enter" });
    expect(store.getState().drawingPolygonId).toBeUndefined();
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-2")]!
        .polygons[0],
    ).toEqual({
      id: polygonId,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.1 },
        { x: 0.25, y: 0.5 },
      ],
      topic: "/camera/front",
    });
  });

  it("SEG-AUX-001 shows lifetime appearance-frame fraction 597/600 rather than loaded-window counts", async () => {
    const { store } = await setup(fixture(600, (frame, instance) => instance === 0 && frame > 2));
    const row = screen.getByRole("button", { name: "○ I0" });
    expect(within(row).getByText("597/600 frames · 0 polygons")).toBeDefined();
    expect(store.getState().document!.frames).toHaveLength(600);
    expect(Object.keys(store.getState().document!.annotations).length).toBeLessThan(597);
    // Current frame is absent, so numerator is lifetime frames with geometry, not presence now.
    expect(row.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(row.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Absent in current frame",
    );
  });

  it("SEG-AUX-003 at frame 25 shows the exact known 60-frame pattern for twenty frames either side", async () => {
    const { store } = await setup(
      fixture(60, (frame, instance) => instance === 0 && knownPresence.has(frame)),
    );
    act(() => {
      store.getState().setCurrentFrame("frame-25");
    });
    const cells = expectPresenceStrip(25);
    expect(cells.slice(0, 20)).toHaveLength(20);
    expect(cells[20]!.title).toBe("Current frame: present");
    expect(cells.slice(21)).toHaveLength(20);
    expect(cells[0]!.title).toBe("Frame -20: present"); // Absolute frame 5.
    expect(cells[40]!.title).toBe("Frame +20: present"); // Absolute frame 45.
  });

  it("SEG-AUX-004 at frame 0 then 59 marks out-of-range cells unavailable and preserves available indices", async () => {
    const { store } = await setup(
      fixture(60, (frame, instance) => instance === 0 && knownPresence.has(frame)),
    );
    const start = expectPresenceStrip(0);
    expect(start.filter((cell) => cell.title.endsWith("outside video"))).toHaveLength(20);
    expect(start.slice(0, 20).every((cell) => !cell.title.endsWith(": absent"))).toBe(true);
    await act(async () => {
      store.getState().setCurrentFrame("frame-59");
      await store.getState().loadFrameWindow("video-1", 10, 12);
    });
    const end = expectPresenceStrip(59);
    expect(end.filter((cell) => cell.title.endsWith("outside video"))).toHaveLength(20);
    expect(end.slice(21).every((cell) => !cell.title.endsWith(": absent"))).toBe(true);
  });

  it("SEG-AUX-005 shows 69 stored vertices then exact add/remove counts without a duplicate closure", async () => {
    const document = fixture(2, (_frame, instance) => instance === 0);
    const points: NormalizedPoint[] = Array.from({ length: 69 }, (_, index) => ({
      x: 0.5 + 0.3 * Math.cos((2 * Math.PI * index) / 69),
      y: 0.5 + 0.3 * Math.sin((2 * Math.PI * index) / 69),
    }));
    const key = frameInstanceKey("frame-0", "instance-0");
    document.annotations[key]!.polygons[0]!.points = points;
    document.annotationSummaries[key] = { polygonCount: 1, pointCount: 69 };
    const { store } = await setup(document);
    const polygonId = "instance-0-polygon-0";
    fireEvent.click(screen.getByRole("button", { name: "Polygon 1 69 vertices" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    expect(
      within(canvas).getAllByRole("button", { name: /^Vertex .*instance-0-polygon-0$/ }),
    ).toHaveLength(69);
    const midpoint = {
      x: (points[17]!.x + points[18]!.x) / 2,
      y: (points[17]!.y + points[18]!.y) / 2,
    };
    // Use an edge midpoint outside the neighboring vertices' forgiving hit areas.
    const added = [...points.slice(0, 18), midpoint, ...points.slice(18)];
    pointer(canvas.querySelector("path[stroke]")!, midpoint.x * 960, midpoint.y * 540);
    expect(screen.getByRole("button", { name: "Polygon 1 70 vertices" })).toBeDefined();
    expect(
      within(canvas).getAllByRole("button", { name: /^Vertex .*instance-0-polygon-0$/ }),
    ).toHaveLength(70);
    const removed = added.filter((_point, index) => index !== 10);
    fireEvent(
      screen.getByRole("button", { name: `Vertex 11 of polygon ${polygonId}` }),
      new MouseEvent("pointerdown", { bubbles: true, button: 0, altKey: true }),
    );
    expect(screen.getByRole("button", { name: "Polygon 1 69 vertices" })).toBeDefined();
    expect(
      within(canvas).getAllByRole("button", { name: /^Vertex .*instance-0-polygon-0$/ }),
    ).toHaveLength(69);
    const stored = store.getState().document!.annotations[key]!.polygons[0]!.points;
    expect(stored).toEqual(removed);
    expect(stored[stored.length - 1]).not.toEqual(stored[0]);
    expect(
      canvas.querySelector('[data-testid="instance-union-fill"] path')!.getAttribute("d"),
    ).toMatch(/[zZ]/);
  });
});
