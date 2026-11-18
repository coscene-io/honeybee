/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { createSeedDocument, setMockControls } from "../mockService";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { frameInstanceKey, propagationTargets } from "../service";
import type { PropagationRequest, SegmentationDocument } from "../types";
import { SegmentationPropagateButton } from "./SegmentationPropagateButton";

const theme = createMuiTheme("light", "en");
/** Five frames per second in the mock recording: frame-20 has frames on both sides. */
const SEED_FRAME = "frame-20";
const polygon = (id: string, x: number) => ({
  id,
  points: [
    { x, y: 0.2 },
    { x: x + 0.1, y: 0.2 },
    { x: x + 0.05, y: 0.6 },
  ],
});

/** Seeds only instance-1 and instance-2 on the seed frame. */
function seed(document: SegmentationDocument): void {
  for (const key of Object.keys(document.annotations)) {
    if (document.annotations[key]!.frameId === SEED_FRAME) {
      delete document.annotations[key];
    }
  }
  for (const [instanceId, x] of [
    ["instance-1", 0.1],
    ["instance-2", 0.6],
  ] as const) {
    document.annotations[frameInstanceKey(SEED_FRAME, instanceId)] = {
      frameId: SEED_FRAME,
      instanceId,
      kind: "polygons",
      polygons: [polygon(`${instanceId}-P`, x)],
    };
  }
}

async function setup(options: { backward?: boolean } = {}) {
  const document = createSeedDocument();
  seed(document);
  const runtime = createSegmentationRuntime(document);
  setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 0 });
  if (options.backward === false) {
    const original = runtime.service.getPropagationCapabilities!.bind(runtime.service);
    runtime.service.getPropagationCapabilities = async () => ({
      ...(await original()),
      backward: false,
    });
  }
  await runtime.initialize();
  act(() => {
    runtime.store.getState().setCurrentFrame(SEED_FRAME);
  });
  segmentationSession.setState({
    runtime,
    open: true,
    panelId: "canvas-a",
    sourceReady: true,
    surfaces: { "canvas-a": { frameId: SEED_FRAME, sourceReady: true } },
  });
  render(
    <ThemeProvider theme={theme}>
      <SegmentationPropagateButton panelId="canvas-a" />
    </ThemeProvider>,
  );
  const propagate = jest.spyOn(runtime.service, "propagate");
  fireEvent.click(screen.getByRole("button", { name: "传播" }));
  fireEvent.click(screen.getByRole("radio", { name: "1 秒" }));
  return { runtime, propagate };
}

async function start(runtime: Awaited<ReturnType<typeof setup>>["runtime"]) {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "开始传播" })).toHaveProperty("disabled", false);
  });
  fireEvent.click(screen.getByRole("button", { name: "开始传播" }));
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).toBe("completed");
  });
}

const seedNs = (runtime: Awaited<ReturnType<typeof setup>>["runtime"]) =>
  BigInt(runtime.store.getState().document!.frames.find((f) => f.id === SEED_FRAME)!.logTimeNs);

afterEach(() => {
  cleanup();
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    surfaces: {},
  });
});

it("orders backward targets latest first and excludes the seed", () => {
  const frames = createSeedDocument().frames.filter((frame) => frame.videoId === "video-1");
  const source = frames[20]!;
  expect(propagationTargets(frames, source, frames[22]!.logTimeNs).map((f) => f.id)).toEqual([
    "frame-21",
    "frame-22",
  ]);
  expect(propagationTargets(frames, source, frames[18]!.logTimeNs).map((f) => f.id)).toEqual([
    "frame-19",
    "frame-18",
  ]);
  expect(() => propagationTargets(frames, source, source.logTimeNs)).toThrow("differ");
});

it("propagates only the checked instances", async () => {
  const { runtime, propagate } = await setup();
  fireEvent.click(screen.getByRole("checkbox", { name: /Object 1/ }));
  await start(runtime);
  expect(propagate).toHaveBeenCalledTimes(1);
  expect(propagate.mock.calls[0]![0].seeds?.map((item) => item.instanceId)).toEqual(["instance-1"]);
});

it("defaults to the instances selected in the tree", async () => {
  const { runtime, propagate } = await setup();
  act(() => {
    runtime.store.getState().setSelection([{ type: "instance", id: "instance-2" }]);
  });
  expect(screen.getAllByRole("checkbox").map((box) => (box as HTMLInputElement).checked)).toEqual([
    false,
    true,
  ]);
  await start(runtime);
  expect(propagate.mock.calls[0]![0].seeds?.map((item) => item.instanceId)).toEqual(["instance-2"]);
});

it("propagates backward onto earlier frames", async () => {
  const { runtime, propagate } = await setup();
  fireEvent.click(screen.getByRole("radio", { name: "向前" }));
  await start(runtime);
  const request = propagate.mock.calls[0]![0];
  expect(BigInt(request.endTimeNs)).toBeLessThan(seedNs(runtime));
  // Results land on frame-19 … frame-15 (one second before the seed) and nowhere else.
  const written = runtime.store
    .getState()
    .stagedOperations.filter((op) => op.label === "Propagate frame")
    .flatMap((op) => Object.keys(op.patch.annotations ?? {}));
  expect(new Set(written)).toEqual(
    new Set(
      [19, 18, 17, 16, 15].flatMap((index) =>
        ["instance-1", "instance-2"].map((id) => frameInstanceKey(`frame-${index}`, id)),
      ),
    ),
  );
  // Playback follows the results back to the earliest frame.
  expect(runtime.store.getState().currentFrameId).toBe("frame-15");
});

it("both directions run forward, then backward", async () => {
  const { runtime, propagate } = await setup();
  fireEvent.click(screen.getByRole("radio", { name: "双向" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "开始传播" })).toHaveProperty("disabled", false);
  });
  fireEvent.click(screen.getByRole("button", { name: "开始传播" }));
  await waitFor(() => {
    expect(propagate).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).toBe("completed");
  });
  const [forward, backward] = propagate.mock.calls.map(
    (call) => BigInt(call[0].endTimeNs) - seedNs(runtime),
  );
  expect(forward).toBeGreaterThan(0n);
  expect(backward).toBeLessThan(0n);
});

it("offers no direction and refuses backward when the service is forward-only", async () => {
  const { runtime } = await setup({ backward: false });
  await waitFor(() => {
    expect(runtime.store.getState().propagationCapabilities?.backward).toBe(false);
  });
  expect(screen.queryByRole("radiogroup", { name: "传播方向" })).toBeNull();
  const frames = runtime.store.getState().document!.frames;
  await expect(
    runtime.store.getState().startPropagation({
      instanceId: "instance-1",
      fromFrameId: SEED_FRAME,
      endTimeNs: frames.find((f) => f.id === "frame-18")!.logTimeNs,
    }),
  ).rejects.toThrow("only propagates forward");
});
