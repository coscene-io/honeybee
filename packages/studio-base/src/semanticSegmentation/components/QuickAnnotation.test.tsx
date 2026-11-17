/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  localPropagationUrl,
  PROPAGATION_URL_KEY,
  SEGMENT_URL_KEY,
} from "@foxglove/studio-base/util/coscene/annotation";

import { editor, fixture, pointer } from "../acceptance/interaction/fixtures";
import { countsFromRuns, runsFromIntervals } from "../maskCodec";
import { frameInstanceKey } from "../service";

/** A column-major rectangle mask, columns [x0, x1) and rows [y0, y1). */
function rect(width: number, height: number, x0: number, x1: number, y0: number, y1: number) {
  const intervals: number[] = [];
  for (let x = x0; x < x1; x++) {
    intervals.push(x * height + y0, x * height + y1);
  }
  return countsFromRuns(runsFromIntervals(Uint32Array.from(intervals), width, height));
}

let requests: {
  points: { x: number; y: number; positive: boolean }[];
  topic: string;
  /** Whether the displayed frame was uploaded with this click. */
  image: boolean;
}[] = [];

beforeEach(() => {
  requests = [];
  localStorage.setItem(PROPAGATION_URL_KEY, "http://127.0.0.1:18876");
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
        return new Blob(["jpeg"], { type: "image/jpeg" });
      }
    },
  });
  globalThis.fetch = jest.fn(async (url: unknown, init?: { body?: FormData }) => {
    if (String(url).startsWith("data:")) {
      return { blob: async () => new Blob(["frame"]) };
    }
    const form = init!.body!;
    const body = JSON.parse(String(form.get("request"))) as Omit<
      (typeof requests)[number],
      "image"
    >;
    requests.push({ ...body, image: form.get("image") != undefined });
    const result = {
      counts: rect(960, 540, 100, 300, 50, 150),
      width: 960,
      height: 540,
      score: 0.9,
    };
    return { ok: true, status: 200, json: async () => result };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(PROPAGATION_URL_KEY);
});

it("clicks positive and negative points, then Enter saves one mask observation", async () => {
  const document = fixture();
  const width = document.videos[0]!.width!;
  const height = document.videos[0]!.height!;
  const { store } = await editor(document);
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  let instanceId = "";
  act(() => {
    instanceId = store.getState().addInstance(document.classes[0]!.id, "fresh");
    store.getState().addPolygon(instanceId);
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
  // Clicks upload the displayed frame until one answer arrives; then the server's copy is reused.
  expect(requests[0]!.image).toBe(true);
  expect(requests[3]!.image).toBe(false);
  expect(requests[3]!.points.map((p) => [Math.round(p.x), Math.round(p.y), p.positive])).toEqual([
    [200, 100, true],
    [250, 120, false],
  ]);
  expect(canvas.querySelectorAll('[data-quick-point="negative"]')).toHaveLength(1);

  fireEvent.keyDown(canvas, { key: "Enter" });
  await waitFor(() => {
    expect(store.getState().drawingPolygonId).toBeUndefined();
  });
  const saved = store.getState().document!.annotations[frameInstanceKey("frame-0", instanceId)]!;
  expect(saved.polygons).toEqual([]);
  expect(saved.mask).toMatchObject({ width, height, counts: rect(960, 540, 100, 300, 50, 150) });
});

it("merges the clicked mask with the instance's existing polygons on that frame", async () => {
  const { store } = await editor(fixture());
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  const key = frameInstanceKey("frame-0", "instance-1");
  expect(store.getState().document!.annotations[key]!.polygons.length).toBeGreaterThan(0);
  act(() => {
    store.getState().addPolygon("instance-1");
  });
  pointer(canvas, "pointerdown", 200, 100);
  await waitFor(() => {
    expect(canvas.querySelector('[data-testid="quick-annotation"] image')).not.toBeNull();
  });
  fireEvent.keyDown(canvas, { key: "Enter" });
  await waitFor(() => {
    expect(store.getState().drawingPolygonId).toBeUndefined();
  });
  const merged = store.getState().document!.annotations[key]!;
  expect(merged.polygons).toEqual([]);
  expect(merged.mask?.counts).not.toBe(rect(960, 540, 100, 300, 50, 150));
});

it("uses the segment URL for clicks while propagation stays on the backend", async () => {
  localStorage.removeItem(PROPAGATION_URL_KEY);
  localStorage.setItem(SEGMENT_URL_KEY, "http://127.0.0.1:18876");
  try {
    expect(localPropagationUrl()).toBeUndefined();
    const { store } = await editor(fixture());
    const canvas = screen.getByRole("img", { name: "Frame polygons" });
    act(() => {
      store.getState().addPolygon("instance-1");
    });
    pointer(canvas, "pointerdown", 200, 100);
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
  } finally {
    localStorage.removeItem(SEGMENT_URL_KEY);
  }
});
