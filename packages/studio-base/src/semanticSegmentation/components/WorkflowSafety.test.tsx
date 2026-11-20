/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createSegmentationRuntime } from "../runtime";
import { frameInstanceKey } from "../service";
import { MomentReferencePicker } from "./MomentReferencePicker";
import { SubmissionControls, WorkflowControls } from "./WorkflowControls";
import { CurrentFramePropagationForm } from "../acceptance/interaction/fixtures";
import { polygonsOf } from "../maskGeometry";
import { setMockControls } from "../mockService";

afterEach(cleanup);
async function setup() {
  const runtime = createSegmentationRuntime();
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
  return runtime;
}

it("offers bounded one-click ranges and starts without a frame count", async () => {
  const runtime = await setup();
  render(<CurrentFramePropagationForm store={runtime.store} />);
  expect(screen.getByRole("radio", { name: "10 秒" })).toHaveProperty("ariaChecked", "true");
  fireEvent.click(screen.getByRole("radio", { name: "3 秒" }));
  expect(screen.getByRole("radio", { name: "3 秒" })).toHaveProperty("ariaChecked", "true");
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getByText(/最多向后传播 3 秒/)).toBeTruthy();
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
  fireEvent.click(screen.getByLabelText("查看暂存操作"));
  expect(await screen.findByText(/帧 1 \[frame-0\] · 实例 instance-1/)).toBeTruthy();
  expect(screen.getByText(/帧 2 \[frame-1\] · 实例 instance-2/)).toBeTruthy();
  expect(screen.getAllByText("类型：Edit polygon")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "清除暂存" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(runtime.store.getState().stagedOperations).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "清除暂存" }));
  fireEvent.click(screen.getByRole("button", { name: "仅清除未提交修改" }));
  expect(runtime.store.getState().stagedOperations).toHaveLength(0);
  expect(JSON.stringify(runtime.store.getState().submissionQueue[0]?.operations)).toBe(queued);
  expect(screen.getByRole("button", { name: "提交" }).className).toContain("seg-primary");
  await act(async () => {
    release?.();
    await runtime.store.getState().waitForSubmissions();
  });
  runtime.dispose();
});

it("keeps clean staging and empty queues honest, and cannot fabricate an empty Moment reference", async () => {
  const runtime = await setup();
  const onChange = jest.fn();
  const { rerender } = render(
    <>
      <SubmissionControls store={runtime.store} />
      <WorkflowControls store={runtime.store} />
    </>,
  );
  const submit = screen.getByRole("button", { name: "提交" });
  expect(submit.className).toContain("seg-primary");
  expect(submit.textContent).toBe("提交");
  fireEvent.click(screen.getByLabelText("查看暂存操作"));
  expect(screen.getByText("当前没有暂存修改")).toBeTruthy();
  expect(screen.getByText("提交后进入队列，编辑可以继续。")).toBeTruthy();
  expect(runtime.store.getState().submissionQueue).toHaveLength(0);
  act(() => {
    const document = runtime.store.getState().document!;
    runtime.store.setState({ document: { ...document, classes: [], instances: [] } });
  });
  rerender(<MomentReferencePicker store={runtime.store} value="unchanged" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
  expect(screen.getByText("暂无可引用目标，请先在空间侧栏创建类别或实例。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "插入引用" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onChange).not.toHaveBeenCalled();
  runtime.dispose();
});
