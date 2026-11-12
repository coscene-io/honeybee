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

afterEach(cleanup);
async function setup() {
  const runtime = createSegmentationRuntime();
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
  return runtime;
}

it("identifies negative, fractional, empty and both-zero forward ranges without clamping them", async () => {
  const runtime = await setup();
  render(<WorkflowControls store={runtime.store} />);
  const after = screen.getByRole("spinbutton", { name: "后帧数" });
  for (const value of ["-1", "1.5", "Infinity", ""]) {
    fireEvent.change(after, { target: { value } });
    expect(screen.getByText("后帧数必须是 0–10000 的有限整数。")).toBeTruthy();
    expect(after).toHaveProperty("value", value === "Infinity" ? "" : value);
    expect(screen.getByRole("button", { name: "在线传播" })).toHaveProperty("disabled", true);
  }
  fireEvent.change(after, { target: { value: "0" } });
  expect(screen.getByText("后帧数必须大于 0。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "在线传播" })).toHaveProperty("disabled", true);
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
  const polygon =
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!
      .polygons[0]!;
  runtime.store.getState().setPolygonPoints(
    polygon.id,
    polygon.points.map((point) => ({ ...point, x: point.x + 0.01 })),
  );
  runtime.store.getState().setCurrentFrame("frame-1");
  const second =
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-1", "instance-2")]!
      .polygons[0]!;
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

it("lists three committed authors with stable newest-first IDs and acknowledged queue scopes", async () => {
  const runtime = await setup();
  for (const author of ["Alice", "Bob", "Carol"]) {
    runtime.service.setControls({ revisionAuthor: author });
    runtime.store.getState().addClass(`${author} class`);
    runtime.store.getState().submit(`${author} commit`);
    await runtime.store.getState().waitForSubmissions();
  }
  const { container } = render(<WorkflowControls store={runtime.store} />);
  const metadata = [...container.querySelectorAll(".seg-card p")]
    .map((item) => item.textContent)
    .filter((text) => text.includes("作者 "));
  expect(metadata.slice(0, 3).map((text) => /作者 (\w+)/.exec(text)?.[1])).toEqual([
    "Carol",
    "Bob",
    "Alice",
  ]);
  expect(metadata[0]).toContain(runtime.store.getState().revisions[0]!.id);
  const batch = runtime.store.getState().submissionQueue[0]!;
  expect(screen.getByText(new RegExp(`批次 ${batch.id}`)).textContent).toContain(batch.revisionId);
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
  expect(runtime.store.getState().tasks).toHaveLength(0);
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
