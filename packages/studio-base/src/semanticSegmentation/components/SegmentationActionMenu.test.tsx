/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { SemanticSegmentationWorkbench } from "../SemanticSegmentationWorkbench";
import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { SegmentationActionMenu } from "./SegmentationActionMenu";

async function open(panelId = "panel-1") {
  const document = createSeedDocument();
  document.frames = document.frames.slice(0, 3);
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  segmentationSession.setState({
    runtime,
    open: true,
    panelId,
    sourceReady: true,
    workflow: { open: false, nonce: 0 },
  });
  return runtime;
}

afterEach(() => {
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    workflow: { open: false, nonce: 0 },
  });
});

it("renders nothing unless a session is open for this panel", async () => {
  const runtime = await open("panel-1");
  const { container } = render(<SegmentationActionMenu panelId="other-panel" />);
  expect(container.textContent).toBe("");
  runtime.dispose();
});

it("shows undo, redo, propagation and submit as four header buttons", async () => {
  const runtime = await open();
  render(<SegmentationActionMenu panelId="panel-1" />);
  const names = screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
  expect(names).toEqual(["撤销标注", "重做标注", "传播", "提交"]);
  expect(screen.getByRole("button", { name: "撤销标注" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "重做标注" })).toHaveProperty("disabled", true);
  runtime.dispose();
});

it("undoes and redoes staged edits from the header icons", async () => {
  const runtime = await open();
  render(<SegmentationActionMenu panelId="panel-1" />);
  act(() => {
    runtime.store.getState().addClass("Fresh class");
  });
  expect(screen.getByLabelText("1 项暂存").textContent).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "撤销标注" }));
  expect(runtime.store.getState().stagedOperations).toHaveLength(0);
  expect(screen.queryByLabelText("1 项暂存")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重做标注" }));
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  runtime.dispose();
});

it("holds submission, version history and ending the session behind 提交", async () => {
  const runtime = await open();
  render(<SegmentationActionMenu panelId="panel-1" />);
  act(() => {
    runtime.store.getState().addClass("Fresh class");
  });
  fireEvent.click(screen.getByRole("button", { name: /^提交/ }));
  const menu = screen.getByRole("dialog", { name: "提交" });
  expect(within(menu).getByRole("button", { name: "提交 1" })).toHaveProperty("disabled", false);
  expect(within(menu).getByLabelText("提交说明")).toBeTruthy();
  expect(within(menu).getByText(/待提交队列 1/)).toBeTruthy();
  expect(within(menu).getByRole("button", { name: "清除暂存" })).toBeTruthy();
  expect(within(menu).queryByRole("button", { name: "撤销" })).toBeNull();
  fireEvent.click(within(menu).getByRole("button", { name: "结束标注" }));
  expect(segmentationSession.getState().open).toBe(false);
  runtime.dispose();
});

it("shows propagation shortcuts behind 传播 and toggles the side panel", async () => {
  const runtime = await open();
  render(
    <>
      <SegmentationActionMenu panelId="panel-1" />
      <SemanticSegmentationWorkbench runtime={runtime} embedded />
    </>,
  );
  expect(screen.queryByRole("complementary", { name: "工作流管理" })).toBeNull();
  // The workbench draws no toolbar, status bar or hint footer of its own.
  expect(screen.queryByLabelText("功能管理栏")).toBeNull();
  expect(screen.queryByText("就绪")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^传播/ }));
  const menu = screen.getByRole("dialog", { name: "传播与任务" });
  fireEvent.click(within(menu).getByRole("button", { name: "传播实例…" }));
  expect(screen.getByRole("complementary", { name: "工作流管理" })).toBeDefined();
  expect(segmentationSession.getState().workflow.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /^传播/ }));
  fireEvent.click(screen.getByRole("button", { name: "收起工作流面板" }));
  expect(segmentationSession.getState().workflow.open).toBe(false);
  runtime.dispose();
});
