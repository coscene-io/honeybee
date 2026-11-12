/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import { createMockSemanticSegmentationService, createSeedDocument } from "../mockService";
import { segmentationSession } from "../runtime";
import { createSemanticSegmentationStore } from "../store";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { SpatialTree } from "./SpatialTree";

async function storeWithSeed() {
  const document = createSeedDocument();
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({ document, controls: { delayMs: 0 } }),
  );
  await store.getState().initialize();
  store.getState().setCurrentFrame("frame-0");
  await store.getState().loadFrameWindow("video-side", 0, 0.8);
  return store;
}

afterEach(() => {
  segmentationSession.setState({
    open: false,
    panelId: undefined,
    surfaces: {},
    runtime: undefined,
    strokeFrameId: undefined,
  });
});

it("lists only the editing camera polygons even when other surfaces exist", async () => {
  const store = await storeWithSeed();
  segmentationSession.setState({
    open: true,
    surfaces: {
      left: { frameId: "frame-0", sourceReady: true },
      right: { frameId: "side-0", sourceReady: true },
    },
  });
  render(<SpatialTree store={store} />);
  expect(screen.queryByRole("treeitem", { name: "side · Polygon 1" })).toBeNull();
  expect(screen.getAllByRole("treeitem", { name: "Polygon 1" }).length).toBeGreaterThan(0);
  store.getState().dispose();
});

it("rejects a first vertex on another camera during an editing session", async () => {
  const store = await storeWithSeed();
  const polygonId = store.getState().addPolygon("instance-1");
  store.getState().setDrawingPolygonId(polygonId);
  segmentationSession.setState({
    open: true,
    panelId: "left",
    surfaces: {
      left: { frameId: "frame-0", sourceReady: true },
      right: { frameId: "side-0", sourceReady: true },
    },
  });
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
  const imageUrl = store.getState().document!.frames.find((item) => item.id === "side-0")?.imageUrl;
  render(<SegmentationCanvas store={store} frameId="side-0" imageUrl={imageUrl} />);
  expect(screen.queryByText(/other canvas/)).toBeNull();
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  fireEvent(
    canvas,
    new MouseEvent("pointerdown", { clientX: 20, clientY: 20, button: 0, bubbles: true }),
  );
  const owner = Object.values(store.getState().document!.annotations).find((item) =>
    item.polygons.some((polygon) => polygon.id === polygonId),
  );
  expect(owner?.frameId).toBe("frame-0");
  expect(store.getState().currentFrameId).toBe("frame-0");
  expect(store.getState().drawingPolygonId).toBe(polygonId);
  expect(segmentationSession.getState().strokeFrameId).toBeUndefined();
  store.getState().dispose();
});

it("does not leave the canvas after the first vertex is placed", async () => {
  const store = await storeWithSeed();
  const polygonId = store.getState().addPolygon("instance-1");
  store.getState().setDrawingPolygonId(polygonId);
  segmentationSession.setState({
    open: true,
    panelId: "left",
    strokeFrameId: "frame-0",
    surfaces: {
      left: { frameId: "frame-0", sourceReady: true },
      right: { frameId: "side-0", sourceReady: true },
    },
  });
  render(
    <>
      <SpatialTree store={store} />
      <SegmentationCanvas
        store={store}
        frameId="side-0"
        imageUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
      />
    </>,
  );
  expect(screen.getByText(/other canvas/)).toBeDefined();
  fireEvent.pointerDown(screen.getByRole("img", { name: "Frame polygons" }), {
    clientX: 20,
    clientY: 20,
    button: 0,
  });
  expect(screen.queryByRole("treeitem", { name: "side · Polygon 1" })).toBeNull();
  expect(store.getState().currentFrameId).toBe("frame-0");
  expect(store.getState().drawingPolygonId).toBe(polygonId);
  store.getState().dispose();
});
