/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime } from "../runtime";
import { frameInstanceKey } from "../service";
import { SpatialTree } from "./SpatialTree";
import { WorkflowControls } from "./WorkflowControls";
import { buildPropagationSeeds } from "./propagationSeeds";

afterEach(cleanup);

async function setup() {
  const document = createSeedDocument();
  const p = {
    id: "P",
    points: [
      { x: 0.123456789, y: 0.234567891 },
      { x: 0.4, y: 0.2 },
      { x: 0.3, y: 0.7 },
    ],
  };
  const q = {
    id: "Q",
    points: [
      { x: 0.5, y: 0.2 },
      { x: 0.7, y: 0.2 },
      { x: 0.6, y: 0.6 },
    ],
  };
  const r = {
    id: "R",
    points: [
      { x: 0.6, y: 0.3 },
      { x: 0.8, y: 0.3 },
      { x: 0.7, y: 0.7 },
    ],
  };
  document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons = [p, q];
  document.annotations[frameInstanceKey("frame-0", "instance-2")]!.polygons = [r];
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0, streamDelayMs: 0 });
  await runtime.initialize();
  const view = render(
    <>
      <SpatialTree store={runtime.store} />
      <WorkflowControls store={runtime.store} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  for (const id of ["P", "R"]) {
    const row = view.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
    fireEvent.click(within(row).getByRole("checkbox"));
  }
  return { runtime, p, q, r };
}

it("sends only checked cross-instance P/R geometry to the propagation service", async () => {
  const { runtime, p, r } = await setup();
  const expected = [
    { instanceId: "instance-1", polygons: [p] },
    { instanceId: "instance-2", polygons: [r] },
  ];
  const online = jest.spyOn(runtime.service, "propagate");
  fireEvent.change(screen.getByRole("spinbutton", { name: "前帧数" }), { target: { value: "0" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "后帧数" }), { target: { value: "1" } });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "在线传播" })).toHaveProperty("disabled", false);
  });
  fireEvent.click(screen.getByRole("button", { name: "在线传播" }));
  await waitFor(() => {
    expect(online).toHaveBeenCalledTimes(1);
  });
  expect(online.mock.calls[0]![0]).toMatchObject({
    instanceId: "instance-1",
    seedPolygons: [p],
    polygonIds: ["P"],
    seeds: expected,
  });
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).not.toBe("running");
  });
  runtime.dispose();
});

it("expands selected parents once and falls back to focus only when selection is empty", async () => {
  const { runtime, p, q, r } = await setup();
  act(() => {
    runtime.store.getState().setSelection([
      { type: "instance", id: "instance-1" },
      { type: "polygon", id: "P" },
      { type: "polygon", id: "R" },
    ]);
  });
  expect(buildPropagationSeeds(runtime.store.getState())).toEqual([
    { instanceId: "instance-1", polygons: [p, q] },
    { instanceId: "instance-2", polygons: [r] },
  ]);
  act(() => {
    runtime.store.getState().setSelection([]);
    runtime.store.getState().setFocus({ type: "polygon", id: "Q" });
  });
  expect(buildPropagationSeeds(runtime.store.getState())).toEqual([
    { instanceId: "instance-1", polygons: [q] },
  ]);
  runtime.dispose();
});
