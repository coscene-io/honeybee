/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { frameInstanceKey, propagationTargets } from "../service";
import type { SegmentationDocument } from "../types";
import { SegmentationPropagateButton } from "./SegmentationPropagateButton";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument, setMockControls } from "../testing/mockService";
import { render, testHost, useSegmentationTestHost } from "../testing/host";

useSegmentationTestHost();

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

async function setup() {
  const document = createSeedDocument();
  seed(document);
  const runtime = createMockSegmentationRuntime(document);
  setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 0 });
  await runtime.initialize();
  act(() => {
    runtime.store.getState().setCurrentFrame(SEED_FRAME);
  });
  testHost().session.setState({
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
  fireEvent.click(screen.getByRole("button", { name: "Propagate" }));
  fireEvent.click(screen.getByRole("radio", { name: "1 s" }));
  return { runtime, propagate };
}

async function start(runtime: Awaited<ReturnType<typeof setup>>["runtime"]) {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Start propagation" })).toHaveProperty(
      "disabled",
      false,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Start propagation" }));
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).toBe("completed");
  });
}

const seedNs = (runtime: Awaited<ReturnType<typeof setup>>["runtime"]) =>
  BigInt(runtime.store.getState().document!.frames.find((f) => f.id === SEED_FRAME)!.logTimeNs);

afterEach(() => {
  cleanup();
  testHost().session.setState({
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
  const boxes = () =>
    screen
      .getAllByRole("checkbox")
      .map((box) => [(box as HTMLInputElement).checked, box.getAttribute("data-indeterminate")]);
  // The select-all row comes first and shows a partial choice as indeterminate.
  expect(boxes()).toEqual([
    [false, "true"],
    [false, "false"],
    [true, "false"],
  ]);
  await start(runtime);
  expect(propagate.mock.calls[0]![0].seeds?.map((item) => item.instanceId)).toEqual(["instance-2"]);
});

it("select all checks every instance, then clears them all", async () => {
  const { runtime, propagate } = await setup();
  const all = () =>
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Select all instances" });
  const start = screen.getByRole("button", { name: "Start propagation" });
  fireEvent.click(screen.getByRole("checkbox", { name: /Object 1/ }));
  expect(screen.getByText("1 / 2")).toBeTruthy();
  // Partial: one click checks all, keeping the user's picks.
  fireEvent.click(all());
  expect(all().checked).toBe(true);
  expect(screen.getByText("2 / 2")).toBeTruthy();
  // Everything checked: one click clears all and blocks starting.
  fireEvent.click(all());
  expect(screen.getByText("0 / 2")).toBeTruthy();
  expect(screen.getByText("Select at least one instance")).toBeTruthy();
  expect(start).toHaveProperty("disabled", true);
  fireEvent.click(all());
  await waitFor(() => {
    expect(start).toHaveProperty("disabled", false);
  });
  fireEvent.click(start);
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).toBe("completed");
  });
  expect(propagate.mock.calls[0]![0].seeds?.map((item) => item.instanceId)).toEqual([
    "instance-1",
    "instance-2",
  ]);
});

it("propagates backward onto earlier frames", async () => {
  const { runtime, propagate } = await setup();
  fireEvent.click(screen.getByRole("radio", { name: "Backward" }));
  await start(runtime);
  const request = propagate.mock.calls[0]![0];
  expect(BigInt(request.endTimeNs)).toBeLessThan(seedNs(runtime));
  // Results land on frame-19 … frame-15 (one second before the seed) and nowhere else.
  const written = runtime.store
    .getState()
    .stagedOperations.filter((op) => op.labelKey === "opLabelPropagateFrame")
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
  fireEvent.click(screen.getByRole("radio", { name: "Both ways" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Start propagation" })).toHaveProperty(
      "disabled",
      false,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Start propagation" }));
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
