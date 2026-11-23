/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { frameInstanceKey } from "../service";
import { SubmissionControls, WorkflowControls } from "./WorkflowControls";
import { CurrentFramePropagationForm } from "../acceptance/interaction/fixtures";
import { polygonsOf } from "../maskGeometry";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { setMockControls } from "../testing/mockService";

afterEach(cleanup);
async function setup() {
  const runtime = createMockSegmentationRuntime();
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
  return runtime;
}

it("offers bounded one-click ranges and starts without a frame count", async () => {
  const runtime = await setup();
  render(<CurrentFramePropagationForm store={runtime.store} />);
  expect(screen.getByRole("radio", { name: "10 s" })).toHaveProperty("ariaChecked", "true");
  fireEvent.click(screen.getByRole("radio", { name: "3 s" }));
  expect(screen.getByRole("radio", { name: "3 s" })).toHaveProperty("ariaChecked", "true");
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getByText(/up to 3 seconds/)).toBeTruthy();
  runtime.dispose();
});

it("shows exact frame/instance/type staging and confirms local-only reset while preserving queued snapshots", async () => {
  const runtime = await setup();
  const originalSubmit = runtime.service.submit.bind(runtime.service);
  let release: (() => void) | undefined;
  jest.spyOn(runtime.service, "submit").mockImplementation(async (request) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return await originalSubmit(request);
  });
  runtime.store.getState().addClass("Queued class");
  runtime.store.getState().submit("Keep queued");
  await waitFor(() => {
    expect(release).toBeDefined();
  });
  const queued = JSON.stringify(runtime.store.getState().submissionQueue[0]?.operations);
  const polygon = polygonsOf(
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")],
  )[0]!;
  runtime.store.getState().setPolygonPoints(
    polygon.id,
    polygon.points.map((point) => ({ ...point, x: point.x + 0.01 })),
  );
  runtime.store.getState().setCurrentFrame("frame-1");
  const second = polygonsOf(
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-1", "instance-2")],
  )[0]!;
  runtime.store.getState().setPolygonPoints(
    second.id,
    second.points.map((point) => ({ ...point, x: point.x - 0.01 })),
  );
  render(<SubmissionControls store={runtime.store} />);
  fireEvent.click(screen.getByLabelText("Show staged changes"));
  expect(await screen.findByText(/Frame 1 · Person Person 1/)).toBeTruthy();
  expect(screen.getByText(/Frame 2 · Object Object 1/)).toBeTruthy();
  expect(screen.getAllByText("Type: Edit polygon")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Clear staged" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(runtime.store.getState().stagedOperations).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Clear staged" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear unsubmitted changes only" }));
  expect(runtime.store.getState().stagedOperations).toHaveLength(0);
  expect(JSON.stringify(runtime.store.getState().submissionQueue[0]?.operations)).toBe(queued);
  expect(screen.getByRole("button", { name: "Submit" }).className).toContain(
    "MuiButton-colorPrimary",
  );
  await act(async () => {
    release?.();
    await runtime.store.getState().waitForSubmissions();
  });
  runtime.dispose();
});

it("keeps clean staging and empty queues honest", async () => {
  const runtime = await setup();
  render(
    <>
      <SubmissionControls store={runtime.store} />
      <WorkflowControls store={runtime.store} />
    </>,
  );
  const submit = screen.getByRole("button", { name: "Submit" });
  expect(submit.className).toContain("MuiButton-colorPrimary");
  expect(submit.textContent).toBe("Submit");
  fireEvent.click(screen.getByLabelText("Show staged changes"));
  expect(screen.getByText("No staged changes")).toBeTruthy();
  expect(screen.getByText("Submitted batches appear here; you can keep editing.")).toBeTruthy();
  expect(runtime.store.getState().submissionQueue).toHaveLength(0);
  runtime.dispose();
});
