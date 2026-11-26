/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen } from "@testing-library/react";

import { SegmentationCanvas } from "../components/SegmentationCanvas/SegmentationCanvas";
import { SegmentationTree } from "../components/SegmentationTree/SegmentationTree";
import { createSegmentationStore } from "../store";
import { render, testHost, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationService, createSeedDocument } from "../testing/mockService";
import { TEST_DECODED_FRAME } from "../testing/nativeFrame";
import { allowSlowRunner } from "../testing/slowRunner";

allowSlowRunner();

installSegmentationTestHost();

async function storeWithSeed() {
  const document = createSeedDocument();
  const store = createSegmentationStore(
    createMockSegmentationService({ document, controls: { delayMs: 0 } }),
  );
  await store.getState().initialize();
  // These tests draw polygons; the default tool is quick annotation.
  store.getState().setCreationTool("polygon");
  store.getState().setCurrentFrame("frame-0");
  await store.getState().loadFrameWindow("video-side", 0, 0.8);
  return store;
}

afterEach(() => {
  testHost().session.setState({
    open: false,
    panelId: undefined,
    surfaces: {},
    previewFrames: {},
    runtime: undefined,
    strokeFrameId: undefined,
  });
});

describe("cross canvas", () => {
  it("lists polygons from every open camera in the same instance tree", async () => {
    const store = await storeWithSeed();
    testHost().session.setState({
      open: true,
      surfaces: {
        left: { frameId: "frame-0", sourceReady: true },
        right: { frameId: "side-0", sourceReady: true },
      },
    });
    render(<SegmentationTree store={store} />);
    expect(screen.getByRole("treeitem", { name: "side · Polygon 1" })).toBeDefined();
    expect(screen.getAllByRole("treeitem", { name: "front · Polygon 1" }).length).toBeGreaterThan(
      0,
    );
    store.getState().dispose();
  });

  it("claims the polygon's camera and frame before editing with Enter", async () => {
    const store = await storeWithSeed();
    testHost().session.setState({
      open: true,
      panelId: "left",
      surfaces: {
        left: { frameId: "frame-0", sourceReady: true },
        right: { frameId: "side-0", sourceReady: true },
      },
    });
    render(<SegmentationTree store={store} />);
    const polygon = screen
      .getByRole("treeitem", { name: "side · Polygon 1" })
      .querySelector("[data-tree-primary]")!;
    fireEvent.keyDown(polygon, { key: "Enter" });
    expect(store.getState().currentFrameId).toBe("side-0");
    expect(store.getState().editing).toBe(true);
    expect(testHost().session.getState().panelId).toBe("right");
    store.getState().dispose();
  });

  it("still switches camera and frame while the edited image is pending, with edits held back", async () => {
    const store = await storeWithSeed();
    testHost().session.setState({
      open: true,
      panelId: "left",
      surfaces: {
        left: { frameId: "frame-0", sourceReady: false },
        right: { frameId: "side-0", sourceReady: true },
      },
    });
    render(<SegmentationTree store={store} editLocked />);
    expect(screen.getByRole("button", { name: "New" }).hasAttribute("disabled")).toBe(true);
    const polygon = screen
      .getByRole("treeitem", { name: "side · Polygon 1" })
      .querySelector<HTMLButtonElement>("[data-tree-primary]")!;
    expect(polygon.disabled).toBe(false);
    fireEvent.click(polygon);
    expect(store.getState().currentFrameId).toBe("side-0");
    expect(testHost().session.getState().panelId).toBe("right");
    store.getState().dispose();
  });

  it("uses current preview frames outside editing and clears unknown images instead of showing the old edit frame", async () => {
    const store = await storeWithSeed();
    testHost().session.setState({
      open: false,
      previewFrames: { front: "frame-0", side: "side-0" },
    });
    render(<SegmentationTree store={store} />);
    expect(screen.getByRole("treeitem", { name: "side · Polygon 1" })).toBeDefined();
    expect(screen.getAllByText("1 visible cameras · 1 polygons")).toHaveLength(3);
    act(() => {
      testHost().session.setState({ previewFrames: { front: undefined, side: undefined } });
    });
    expect(screen.queryByRole("treeitem", { name: /Polygon 1/ })).toBeNull();
    expect(screen.getByText("Person 1")).toBeDefined();
    store.getState().dispose();
  });

  it("lets the first vertex choose either canvas, then keeps the stroke there", async () => {
    const store = await storeWithSeed();
    store.getState().startDrawing("instance-1");
    const staged = store.getState().stagedOperations;
    testHost().session.setState({
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
    const imageUrl = store
      .getState()
      .document!.frames.find((item) => item.id === "side-0")?.imageUrl;
    render(
      <SegmentationCanvas
        decodedFrame={TEST_DECODED_FRAME}
        store={store}
        frameId="side-0"
        imageUrl={imageUrl}
      />,
    );
    expect(screen.queryByText(/other canvas/)).toBeNull();
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    fireEvent(
      canvas,
      new MouseEvent("pointerdown", { clientX: 20, clientY: 20, button: 0, bubbles: true }),
    );
    // Retargeting moves only the canvas-local session; nothing is staged for it.
    expect(store.getState().drawing).toEqual({ instanceId: "instance-1", frameId: "side-0" });
    expect(store.getState().stagedOperations).toEqual(staged);
    expect(store.getState().currentFrameId).toBe("side-0");
    expect(testHost().session.getState().strokeFrameId).toBe("side-0");
    store.getState().dispose();
  });

  it("does not leave the canvas after the first vertex is placed", async () => {
    const store = await storeWithSeed();
    store.getState().startDrawing("instance-1");
    testHost().session.setState({
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
        <SegmentationTree store={store} />
        <SegmentationCanvas
          decodedFrame={TEST_DECODED_FRAME}
          store={store}
          frameId="side-0"
          imageUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
        />
      </>,
    );
    expect(screen.getByTitle(/other canvas/)).toBeDefined();
    fireEvent.pointerDown(screen.getByRole("img", { name: "Frame polygons" }), {
      clientX: 20,
      clientY: 20,
      button: 0,
    });
    const sideRow = screen.getByRole("treeitem", { name: "side · Polygon 1" });
    fireEvent.click(sideRow.querySelector("[data-tree-primary]")!);
    expect(store.getState().currentFrameId).toBe("frame-0");
    expect(store.getState().drawing).toEqual({ instanceId: "instance-1", frameId: "frame-0" });
    store.getState().dispose();
  });
});
