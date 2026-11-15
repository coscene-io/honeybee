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
