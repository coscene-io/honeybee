/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { frameInstanceKey } from "../service";
import { SegmentationActionMenu } from "./SegmentationActionMenu";
import { SegmentationPropagateButton } from "./SegmentationPropagateButton";
import { buildCanvasPropagationScope } from "./propagationSeeds";

const theme = createMuiTheme("light", "en");
const polygon = (id: string, x: number) => ({
  id,
  points: [
    { x, y: 0.2 },
    { x: x + 0.1, y: 0.2 },
    { x: x + 0.05, y: 0.6 },
  ],
});

async function setup(options: { open?: boolean; seeded?: boolean } = {}) {
  const document = createSeedDocument();
  if (options.seeded !== false) {
    document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons = [
      polygon("P", 0.1),
      polygon("Q", 0.3),
    ];
    document.annotations[frameInstanceKey("frame-0", "instance-2")]!.polygons = [polygon("R", 0.6)];
  } else {
    for (const annotation of Object.values(document.annotations)) {
      annotation.polygons = [];
    }
  }
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0, streamDelayMs: 0 });
  await runtime.initialize();
  segmentationSession.setState({
    runtime,
    open: options.open ?? true,
    panelId: "canvas-a",
    sourceReady: true,
    surfaces: { "canvas-a": { frameId: "frame-0", sourceReady: true } },
  });
  render(
    <ThemeProvider theme={theme}>
      <SegmentationPropagateButton panelId="canvas-a" />
    </ThemeProvider>,
  );
  return runtime;
}

afterEach(() => {
  cleanup();
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    surfaces: {},
  });
});

it("lists every instance with a polygon on the frame and ignores tree selection", async () => {
  const document = createSeedDocument();
  document.annotations[frameInstanceKey("frame-0", "instance-1")]!.polygons = [
    polygon("P", 0.1),
    polygon("Q", 0.3),
  ];
  document.annotations[frameInstanceKey("frame-0", "instance-2")]!.polygons = [polygon("R", 0.6)];
  const scope = buildCanvasPropagationScope(document, "frame-0");
  expect(scope?.videoId).toBe(document.frames.find((frame) => frame.id === "frame-0")!.videoId);
  expect(scope?.seeds.map((seed) => [seed.instanceId, seed.polygons.map((p) => p.id)])).toEqual([
    ["instance-1", ["P", "Q"]],
    ["instance-2", ["R"]],
  ]);
  expect(buildCanvasPropagationScope(document, "missing")).toBeUndefined();
});

it("renders no propagate button without an open session", async () => {
  await setup({ open: false });
  expect(screen.queryByRole("button", { name: "传播" })).toBeNull();
});

it("disables the button when the frame has no seeded instance", async () => {
  await setup({ seeded: false });
  expect(screen.getByRole("button", { name: "传播" })).toHaveProperty("disabled", true);
});

it("sends one request with every seeded instance of the canvas's video", async () => {
  const runtime = await setup();
  const online = jest.spyOn(runtime.service, "propagate");
  fireEvent.click(screen.getByRole("button", { name: "传播" }));
  expect(screen.getByText("2 个实例 · 3 个多边形")).toBeTruthy();
  fireEvent.change(screen.getByRole("spinbutton", { name: "后帧数" }), { target: { value: "1" } });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "在线传播" })).toHaveProperty("disabled", false);
  });
  fireEvent.click(screen.getByRole("button", { name: "在线传播" }));
  await waitFor(() => {
    expect(online).toHaveBeenCalledTimes(1);
  });
  expect(online.mock.calls[0]![0].seeds?.map((seed) => seed.instanceId)).toEqual([
    "instance-1",
    "instance-2",
  ]);
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).not.toBe("running");
  });
});

it("the app bar no longer offers 传播", async () => {
  const runtime = await setup();
  cleanup();
  render(<SegmentationActionMenu />);
  expect(screen.queryByRole("button", { name: /^传播/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^提交/ })).toBeTruthy();
  act(() => {
    runtime.dispose();
  });
});
