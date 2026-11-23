/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessageInitShape } from "@bufbuild/protobuf";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { SegmentFrameRequestSchema } from "@foxglove/studio-base/services/api/spatial-annotation";

import { editor, fixture, pointer } from "../acceptance/interaction/fixtures";
import { countsFromRuns, runsFromIntervals } from "../maskCodec";
import { maskOf, polygonsOf } from "../maskGeometry";
import { quickSegment } from "../quickSegment";
import { frameInstanceKey } from "../service";

/** A column-major rectangle mask, columns [x0, x1) and rows [y0, y1). */
function rect(width: number, height: number, x0: number, x1: number, y0: number, y1: number) {
  const intervals: number[] = [];
  for (let x = x0; x < x1; x++) {
    intervals.push(x * height + y0, x * height + y1);
  }
  return countsFromRuns(runsFromIntervals(Uint32Array.from(intervals), width, height));
}

type SegmentFrameRequestInit = MessageInitShape<typeof SegmentFrameRequestSchema>;

const RECORD = "warehouses/w/projects/p/records/r";

/** SegmentFrame requests as sent on the wire: source pixels, negative flags. */
let requests: {
  record: string;
  topic: string;
  points: { x: number; y: number; negative: boolean }[];
  imageBytes: number;
}[] = [];

/** The editor with a live-like service: real quickSegment over a recording AnnotationService. */
async function quickEditor(document = fixture()) {
  const result = await editor(document);
  const client = {
    segmentFrame: jest.fn(async (request: SegmentFrameRequestInit) => {
      requests.push({
        record: request.record!,
        topic: request.topic!,
        points: request.points!.map((p) => ({ x: p.x!, y: p.y!, negative: p.negative ?? false })),
        imageBytes: request.image!.length,
      });
      return {
        mask: { counts: rect(960, 540, 100, 300, 50, 150) },
        score: 0.9,
        width: 960,
        height: 540,
      };
    }),
  } as unknown as Parameters<typeof quickSegment>[0];
  result.service.segmentFrame = async (request, signal) =>
    await quickSegment(client, RECORD, request, signal);
  return result;
}

beforeEach(() => {
  requests = [];
  window.localStorage.removeItem("coStudio.semanticSegmentation.creationTool");
  // jsdom has no 2D canvas; the preview image is cosmetic.
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => "data:,",
  });
  // jsdom cannot decode or encode images: the frame upload sees a 960×540 frame and a JPEG blob.
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 960, height: 540, close: () => {} }),
  });
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: class {
      public getContext() {
        return { drawImage: () => {} };
      }
      public async convertToBlob() {
        // jsdom Blobs have no arrayBuffer(); browsers do.
        return { arrayBuffer: async () => new TextEncoder().encode("jpeg").buffer };
      }
    },
  });
  // Reading the displayed frame is the only fetch left: quick annotation itself is a gRPC call.
  globalThis.fetch = jest.fn(async () => ({
    blob: async () => new Blob(["frame"]),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("coStudio.semanticSegmentation.creationTool");
});

it("clicks positive and negative points, then Enter saves one mask observation", async () => {
  const document = fixture();
  const width = document.videos[0]!.width!;
  const height = document.videos[0]!.height!;
  const { store } = await quickEditor(document);
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  let instanceId = "";
  act(() => {
    instanceId = store.getState().addInstance(document.classes[0]!.id, "fresh");
    store.getState().startDrawing(instanceId, "quick");
  });

  pointer(canvas, "pointerdown", 200, 100);
  // Right click without dragging is a negative point.
  fireEvent(
    canvas,
    new MouseEvent("pointerdown", { clientX: 250, clientY: 120, button: 2, bubbles: true }),
  );
  fireEvent(
    canvas,
    new MouseEvent("pointerup", { clientX: 250, clientY: 120, button: 2, bubbles: true }),
  );
  // Shift+click is a negative point too; Backspace removes it again.
  fireEvent(
    canvas,
    new MouseEvent("pointerdown", {
      clientX: 260,
      clientY: 130,
      button: 0,
      shiftKey: true,
      bubbles: true,
    }),
  );
  await waitFor(() => {
    expect(requests).toHaveLength(3);
  });
  fireEvent.keyDown(canvas, { key: "Backspace" });
  await waitFor(() => {
    expect(requests).toHaveLength(4);
  });

  expect(requests[0]!.topic).toBe("/camera/front");
  expect(requests[0]!.record).toBe(RECORD);
  // The server keeps no session: every click uploads the displayed frame with all its points.
  expect(requests.every((request) => request.imageBytes > 0)).toBe(true);
  expect(requests[3]!.points.map((p) => [Math.round(p.x), Math.round(p.y), p.negative])).toEqual([
    [200, 100, false],
    [250, 120, true],
  ]);
  expect(canvas.querySelectorAll('[data-quick-point="negative"]')).toHaveLength(1);

  fireEvent.keyDown(canvas, { key: "Enter" });
  await waitFor(() => {
    expect(store.getState().drawing).toBeUndefined();
  });
  const saved = store.getState().document!.annotations[frameInstanceKey("frame-0", instanceId)]!;
  expect(saved.kind).toBe("mask");
  expect(maskOf(saved)).toMatchObject({
    width,
    height,
    counts: rect(960, 540, 100, 300, 50, 150),
    source: "quick",
  });
  // A fresh instance gets the mask as is: no representation change to report.
  expect(screen.queryByTestId("geometry-notice")).toBeNull();
});

it("merges the clicked mask with the instance's existing polygons on that frame", async () => {
  const { store } = await quickEditor(fixture());
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  const key = frameInstanceKey("frame-0", "instance-1");
  expect(polygonsOf(store.getState().document!.annotations[key]).length).toBeGreaterThan(0);
  act(() => {
    store.getState().startDrawing("instance-1", "quick");
  });
  pointer(canvas, "pointerdown", 200, 100);
  await waitFor(() => {
    expect(canvas.querySelector('[data-testid="quick-annotation"] image')).not.toBeNull();
  });
  fireEvent.keyDown(canvas, { key: "Enter" });
  await waitFor(() => {
    expect(store.getState().drawing).toBeUndefined();
  });
  const merged = store.getState().document!.annotations[key]!;
  expect(merged.kind).toBe("mask");
  expect(maskOf(merged)?.counts).not.toBe(rect(960, 540, 100, 300, 50, 150));
  // The polygons were rasterized into the mask; the user is told so.
  expect(screen.getByTestId("geometry-notice").textContent).toContain("rasterized");
});

it("P and Q switch the creation tool during a drawing and discard the other tool's draft", async () => {
  const { store } = await editor(fixture());
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  act(() => {
    store.getState().startDrawing("instance-empty", "polygon");
  });
  pointer(canvas, "pointerdown", 100, 100);
  pointer(canvas, "pointerdown", 200, 100);
  expect(canvas.querySelector("polyline")!.getAttribute("points")).not.toBe("");
  fireEvent.keyDown(canvas, { key: "q" });
  expect(store.getState().creationTool).toBe("quick");
  expect(store.getState().drawing?.instanceId).toBe("instance-empty");
  expect(canvas.querySelector("polyline")).toBeNull();
  expect(screen.getByRole("radio", { name: /Quick/ }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("radio", { name: /Polygon/ }));
  expect(store.getState().creationTool).toBe("polygon");
  expect(requests).toHaveLength(0);
});

it("keeps the previous mask when the next click selects no foreground", async () => {
  const { store, service } = await quickEditor();
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  act(() => {
    store.getState().startDrawing("instance-1", "quick");
  });
  pointer(canvas, "pointerdown", 200, 100);
  await waitFor(() => {
    expect(canvas.querySelector('[data-testid="quick-annotation"] image')).not.toBeNull();
  });
  service.segmentFrame = async () => await Promise.resolve({ mask: undefined, score: 0 });
  pointer(canvas, "pointerdown", 400, 300);
  await waitFor(() => {
    expect(screen.getByText(/select nothing/)).not.toBeNull();
  });
  expect(canvas.querySelector('[data-testid="quick-annotation"] image')).not.toBeNull();
});

it("explains that quick annotation needs a cloud record when the service cannot segment", async () => {
  // The mock service stands in for sources without an AnnotationService (local files).
  const { store } = await editor(fixture());
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  act(() => {
    store.getState().startDrawing("instance-1", "quick");
  });
  pointer(canvas, "pointerdown", 200, 100);
  await waitFor(() => {
    expect(screen.getByText(/Quick annotation needs an open cloud record/)).not.toBeNull();
  });
  expect(requests).toHaveLength(0);
});
