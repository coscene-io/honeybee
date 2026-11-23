/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, within } from "@testing-library/react";

import { polygonsOf } from "../maskGeometry";
import { frameInstanceKey } from "../service";
import { createSemanticSegmentationStore } from "../store";
import { createMockSemanticSegmentationService, createSeedDocument } from "../testing/mockService";
import type { NormalizedPoint, SegmentationDocument } from "../types";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { SpatialTree } from "./SpatialTree";
import { TEST_DECODED_FRAME } from "../testing/nativeFrame";

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
  for (const frame of document.frames) {
    for (const [index, instance] of document.instances.entries()) {
      if (!present(frame.index, index)) {
        continue;
      }
      const key = frameInstanceKey(frame.id, instance.id);
      document.annotations[key] = {
        frameId: frame.id,
        instanceId: instance.id,
        kind: "polygons",
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
      <SegmentationCanvas decodedFrame={TEST_DECODED_FRAME} store={store} />
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

describe("editor acceptance", () => {
  it("dismissing help preserves two draft vertices and drawing can continue", async () => {
    const { store } = await setup(fixture(2, (_frame, instance) => instance < 2));
    fireEvent.click(screen.getByRole("button", { name: "Annotate ○ I2" }));
    const drawing = store.getState().drawing;
    expect(drawing?.instanceId).toBe("instance-2");
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    pointer(canvas, 96, 54);
    pointer(canvas, 384, 54);
    const draftPoints = canvas.querySelector("polyline")!.getAttribute("points");
    const operations = store.getState().stagedOperations;
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Drawing help" })).toBeDefined();
    expect(canvas.querySelector("polyline")!.getAttribute("points")).toBe(draftPoints);
    expect(store.getState().drawing).toEqual(drawing);
    expect(store.getState().stagedOperations).toEqual(operations);
    pointer(canvas, 240, 270);
    expect(canvas.querySelector("polyline")!.getAttribute("points")!.split(" ")).toHaveLength(3);
    fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Enter" });
    expect(store.getState().drawing).toBeUndefined();
    expect(
      polygonsOf(
        store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-2")],
      )[0],
    ).toEqual({
      id: expect.any(String),
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.1 },
        { x: 0.25, y: 0.5 },
      ],
      topic: "/camera/front",
    });
  });

  it("shows lifetime appearance-frame fraction 597/600 rather than loaded-window counts", async () => {
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

  it("shows 69 stored vertices then exact add/remove counts without a duplicate closure", async () => {
    const document = fixture(2, (_frame, instance) => instance === 0);
    const points: NormalizedPoint[] = Array.from({ length: 69 }, (_, index) => ({
      x: 0.5 + 0.3 * Math.cos((2 * Math.PI * index) / 69),
      y: 0.5 + 0.3 * Math.sin((2 * Math.PI * index) / 69),
    }));
    const key = frameInstanceKey("frame-0", "instance-0");
    polygonsOf(document.annotations[key])[0]!.points = points;
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
    const stored = polygonsOf(store.getState().document!.annotations[key])[0]!.points;
    expect(stored).toEqual(removed);
    expect(stored[stored.length - 1]).not.toEqual(stored[0]);
    expect(
      canvas.querySelector('[data-testid="instance-union-fill"] path')!.getAttribute("d"),
    ).toMatch(/[zZ]/);
  });
});
