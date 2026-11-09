/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SemanticSegmentationWorkbench } from "../SemanticSegmentationWorkbench";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { GlobalPropagationLock } from "./GlobalPropagationLock";
import { MomentReferencePicker } from "./MomentReferencePicker";

afterEach(() => {
  cleanup();
  segmentationSession.setState({ runtime: undefined, open: false });
  document.body.removeAttribute("tabindex");
});

it("keeps actual editor/picker/native surfaces locked until delayed cancel ack and restores keyboard focus for retry", async () => {
  const runtime = createSegmentationRuntime();
  runtime.service.setControls({
    delayMs: 0,
    streamDelayMs: 1000,
    cancelDelayMs: 60,
    failCancelNext: true,
  });
  await runtime.initialize();
  runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
  let cancels = 0;
  const originalCancel = runtime.service.cancelPropagation?.bind(runtime.service);
  if (!originalCancel) {
    throw new Error("Mock fixture must support cancellation acknowledgement");
  }
  runtime.service.cancelPropagation = async (context) => {
    cancels++;
    return await originalCancel(context);
  };
  segmentationSession.setState({ runtime, open: true });
  const { container } = render(
    <>
      <button type="button">Native timeline seek</button>
      <SemanticSegmentationWorkbench runtime={runtime} />
      <MomentReferencePicker store={runtime.store} value="" onChange={() => {}} />
      <GlobalPropagationLock />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "在线传播" }));
  const lock = await screen.findByRole("dialog", { name: "在线传播锁定" });
  fireEvent.click(within(lock).getByRole("button", { name: "STOP · 停止传播" }));
  expect(runtime.store.getState().propagation.status).toBe("stopping");
  expect(within(lock).getByRole("button", { name: "正在停止…" })).toHaveProperty("disabled", true);
  expect(container.inert).toBe(true);
  expect(screen.getByRole("button", { name: "Zoom in" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "New" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "引用空间类别或实例" })).toHaveProperty(
    "disabled",
    true,
  );
  act(() => {
    runtime.store.getState().stopPropagation();
  });
  await waitFor(() => {
    expect(cancels).toBe(1);
  });
  document.body.tabIndex = -1;
  document.body.focus();
  expect(document.activeElement).toBe(document.body);
  const retry = await within(lock).findByRole("button", { name: "重试停止" });
  await waitFor(() => {
    expect(document.activeElement).toBe(retry);
  });
  expect(container.inert).toBe(true);
  fireEvent.keyDown(retry, { key: "Enter" });
  await waitFor(() => {
    expect(cancels).toBe(2);
  });
  await waitFor(() => {
    expect(runtime.store.getState().propagation.status).toBe("cancelled");
  });
  expect(container.inert).not.toBe(true);
  expect(screen.getByRole("button", { name: "Zoom in" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "New" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "引用空间类别或实例" })).toHaveProperty(
    "disabled",
    false,
  );
  runtime.dispose();
});
