/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, screen } from "@testing-library/react";

import { editor, fixture, pointer } from "../acceptance/interaction/fixtures";
import { countsFromRuns, runsFromIntervals } from "../maskCodec";
import { frameInstanceKey } from "../service";

afterEach(cleanup);

it("double-clicking a mask edits only that observation as polygons and leaves it untouched on exit", async () => {
  const document = fixture();
  const width = document.videos[0]!.width!;
  const height = document.videos[0]!.height!;
  // A column-major rectangle: columns 100–399, rows 100–299.
  const intervals: number[] = [];
  for (let x = 100; x < 400; x++) {
    intervals.push(x * height + 100, x * height + 300);
  }
  const counts = countsFromRuns(runsFromIntervals(Uint32Array.from(intervals), width, height));
  const key = frameInstanceKey("frame-0", "instance-1");
  document.annotations[key] = {
    frameId: "frame-0",
    instanceId: "instance-1",
    polygons: [],
    mask: { counts, width, height },
  };
  document.annotationSummaries[key] = { polygonCount: 0, pointCount: 0 };
  const { store } = await editor(document);
  const original = store.getState().document!.annotations[key]!;

  act(() => {
    pointer(screen.getByRole("img", { name: "Frame polygons" }), "dblclick", 200, 200);
  });

  expect(store.getState().maskEdit).toMatchObject({ frameId: "frame-0", instanceId: "instance-1" });
  const edited = store.getState().document!.annotations[key]!;
  expect(edited.mask).toBeUndefined();
  expect(edited.polygons.length).toBeGreaterThan(0);
  // Only the double-clicked instance is converted.
  expect(
    store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-2")]!.mask,
  ).toBeUndefined();

  act(() => {
    store.getState().setEditing(false);
  });

  expect(store.getState().maskEdit).toBeUndefined();
  expect(store.getState().document!.annotations[key]).toEqual(original);
  expect(store.getState().stagedOperations).toHaveLength(0);
});

it("keeps a double-clicked mask in edit when one of its polygons is picked in the tree", async () => {
  const document = fixture();
  const width = document.videos[0]!.width!;
  const height = document.videos[0]!.height!;
  // Two separate rectangles: two connected components, so two polygons.
  const intervals: number[] = [];
  for (let x = 100; x < 200; x++) {
    intervals.push(x * height + 100, x * height + 200);
  }
  for (let x = 400; x < 500; x++) {
    intervals.push(x * height + 100, x * height + 200);
  }
  const counts = countsFromRuns(runsFromIntervals(Uint32Array.from(intervals), width, height));
  const key = frameInstanceKey("frame-0", "instance-1");
  document.annotations[key] = {
    frameId: "frame-0",
    instanceId: "instance-1",
    polygons: [],
    mask: { counts, width, height },
  };
  document.annotationSummaries[key] = { polygonCount: 0, pointCount: 0 };
  const { store } = await editor(document);
  act(() => {
    pointer(screen.getByRole("img", { name: "Frame polygons" }), "dblclick", 150, 150);
  });
  const polygons = store.getState().document!.annotations[key]!.polygons;
  expect(polygons).toHaveLength(2);
  act(() => {
    store.getState().setFocus({ type: "polygon", id: polygons[1]!.id });
  });
  expect(store.getState().editing).toBe(true);
  expect(store.getState().maskEdit).toBeDefined();
  expect(store.getState().document!.annotations[key]!.polygons).toHaveLength(2);
  act(() => {
    store.getState().setFocus({ type: "instance", id: "instance-2" });
  });
  // Leaving the instance still ends the edit and restores the untouched mask.
  expect(store.getState().maskEdit).toBeUndefined();
  expect(store.getState().document!.annotations[key]!.mask?.counts).toBe(counts);
});
