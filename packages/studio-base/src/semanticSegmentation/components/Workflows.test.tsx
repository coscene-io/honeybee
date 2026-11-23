/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SemanticSegmentationWorkbench } from "../SemanticSegmentationWorkbench";
import { openWorkflowPanel, segmentationSession } from "../runtime";
import { GlobalPropagationLock } from "./GlobalPropagationLock";
import {
  MomentReferencePicker,
  encodeSpatialReference,
  parseSpatialReference,
  resolveSpatialReference,
} from "./MomentReferencePicker";
import { SegmentationActionMenu } from "./SegmentationActionMenu";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { setMockControls } from "../testing/mockService";

jest.mock("./SegmentationCanvas", () => ({
  SegmentationCanvas: () => <div>Canvas</div>,
}));
jest.mock("./SpatialTree", () => ({ SpatialTree: () => <div>Space tree</div> }));

async function initializedRuntime() {
  const runtime = createMockSegmentationRuntime();
  setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 50 });
  await runtime.initialize();
  return runtime;
}

afterEach(() => {
  cleanup();
  segmentationSession.setState({
    runtime: undefined,
    open: false,
  });
});

describe("workbench workflow integration", () => {
  it("retries only the failed frame window without resetting drafts or queued work", async () => {
    const runtime = await initializedRuntime();
    const reads = jest
      .spyOn(runtime.service, "loadFrameWindow")
      .mockRejectedValueOnce(new Error("Window unavailable"));
    const reload = jest.spyOn(runtime.service, "loadDocument");
    const originalSubmit = runtime.service.submit.bind(runtime.service);
    let releaseSubmission: (() => void) | undefined;
    jest.spyOn(runtime.service, "submit").mockImplementation(async (request) => {
      await new Promise<void>((resolve) => {
        releaseSubmission = resolve;
      });
      return await originalSubmit(request);
    });
    runtime.store.getState().addClass("Queued before retry");
    runtime.store.getState().submit("Keep queued work");
    runtime.store.getState().addClass("Draft survives retry");
    render(<SemanticSegmentationWorkbench runtime={runtime} />);
    act(() => {
      runtime.store.getState().setCurrentFrame("frame-80");
    });
    await screen.findByText(/当前标注窗口读取失败/);
    // Submit lives in the app-bar menu; it stays disabled while the window is unavailable.
    segmentationSession.setState({ runtime, open: true, panelId: "menu-panel", sourceReady: true });
    render(<SegmentationActionMenu />);
    fireEvent.click(screen.getByRole("button", { name: /^提交/ }));
    expect(screen.getByRole("button", { name: /提交 1/ })).toHaveProperty("disabled", true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "提交" }), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "提交" })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "重试当前标注窗口" }));
    await waitFor(() => {
      expect(runtime.store.getState().isFrameReady("frame-80")).toBe(true);
    });
    expect(runtime.store.getState().frameWindowError).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /^提交/ }));
    expect(screen.getByRole("button", { name: /提交 1/ })).toHaveProperty("disabled", false);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "提交" }), { key: "Escape" });
    act(() => {
      segmentationSession.setState({ open: false, runtime: undefined, panelId: undefined });
    });
    expect(runtime.store.getState().stagedOperations).toHaveLength(1);
    expect(runtime.store.getState().submissionQueue).toHaveLength(1);
    expect(
      runtime.store
        .getState()
        .document?.classes.some((item) => item.name === "Draft survives retry"),
    ).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledTimes(2);
    expect(reads.mock.calls[1]?.slice(0, 3)).toEqual(reads.mock.calls[0]?.slice(0, 3));
    expect(reads.mock.calls[1]![2] - reads.mock.calls[1]![1]).toBeLessThanOrEqual(10);
    await waitFor(() => {
      expect(releaseSubmission).toBeDefined();
    });
    await act(async () => {
      releaseSubmission?.();
      await runtime.store.getState().waitForSubmissions();
    });
    runtime.store.getState().dispose();
  });

  it("persists a typed reference selected by stable identity and resolves changed or deleted targets", async () => {
    const runtime = await initializedRuntime();
    const onChange = jest.fn();
    render(<MomentReferencePicker store={runtime.store} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
      target: { value: "instance/instance-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "插入引用" }));
    const value = onChange.mock.calls[0]![0] as string;
    expect(parseSpatialReference(value)).toEqual({
      recordId: "record-1",
      videoId: "video-1",
      targetType: "instance",
      targetId: "instance-1",
    });
    act(() => {
      runtime.store.getState().renameInstance("instance-1", "Renamed person");
    });
    expect(resolveSpatialReference(value, runtime.store.getState().document)).toContain(
      "Renamed person",
    );
    act(() => {
      runtime.store.getState().deleteInstance("instance-1", "all");
    });
    expect(resolveSpatialReference(value, runtime.store.getState().document)).toContain("已删除");
    expect(resolveSpatialReference(value, undefined)).toContain("记录未打开");
    expect(
      parseSpatialReference(encodeSpatialReference("record/odd", "class", "id:odd", "video/odd"))
        ?.recordId,
    ).toBe("record/odd");
    expect(parseSpatialReference("spatial://bad/%zz/class/id")).toBeUndefined();
    runtime.store.getState().dispose();
  });
  it("makes every app surface inert while STOP remains outside and restores prior inert state", async () => {
    const runtime = await initializedRuntime();
    segmentationSession.setState({ runtime });
    const { container } = render(
      <>
        <button type="button">Existing player seek</button>
        <GlobalPropagationLock />
      </>,
    );
    const previousContainerInert = container.inert;
    let streaming: Promise<void> | undefined;
    act(() => {
      streaming = runtime.store.getState().startPropagation({
        instanceId: "instance-1",
        fromFrameId: "frame-0",
        endTimeNs: "1700000002000000000",
      });
    });
    const stop = await screen.findByRole("button", { name: "STOP · 停止传播" });
    expect(container.inert).toBe(true);
    expect(stop.closest('[aria-label="在线传播锁定"]')?.parentElement).toBe(document.body);
    const shortcut = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);
    const portalMenu = document.createElement("div");
    const previousPortalInert = portalMenu.inert;
    document.body.appendChild(portalMenu);
    await waitFor(() => {
      expect(portalMenu.inert).toBe(true);
    });
    const backgroundShortcut = jest.fn();
    window.addEventListener("keydown", backgroundShortcut);
    fireEvent.keyDown(stop, { key: " " });
    expect(backgroundShortcut).not.toHaveBeenCalled();
    window.removeEventListener("keydown", backgroundShortcut);
    await act(async () => {
      await streaming;
    });
    await waitFor(() => {
      expect(runtime.store.getState().propagation.status).toBe("cancelled");
    });
    expect(container.inert).toBe(previousContainerInert);
    expect(portalMenu.inert).toBe(previousPortalInert);
    portalMenu.remove();
    runtime.store.getState().dispose();
  });

  it("embeds in the Image Panel without a duplicate timeline and gates edits until decode is ready", async () => {
    const runtime = await initializedRuntime();
    runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
    render(<SemanticSegmentationWorkbench runtime={runtime} sourceReady={false} />);
    expect(screen.queryByRole("slider", { name: "视频帧时间轴" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "空间理解标注工作台" })).toBeNull();
    // A lasting wait shows a small marker, not a banner.
    expect(
      await screen.findByTitle(/正在等待当前视频帧和标注数据/, undefined, { timeout: 2000 }),
    ).toBeTruthy();
    act(() => {
      openWorkflowPanel();
    });
    expect(screen.queryByRole("button", { name: "开始传播" })).toBeNull();
    runtime.store.getState().dispose();
  });

  it("closes the Moment picker on same-record video switches and source readiness changes", async () => {
    const runtime = await initializedRuntime();
    const onChange = jest.fn();
    const { rerender } = render(
      <MomentReferencePicker store={runtime.store} value="" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
      target: { value: "instance/instance-1" },
    });
    act(() => {
      const document = runtime.store.getState().document!;
      runtime.store.setState({
        document: {
          ...document,
          videos: [...document.videos, { ...document.videos[0]!, id: "video-2" }],
          frames: [
            ...document.frames,
            { ...document.frames[0]!, id: "rear-frame", videoId: "video-2" },
          ],
        },
        currentFrameId: "rear-frame",
      });
    });
    expect(screen.queryByRole("dialog", { name: "引用已标注类别或实例" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
      target: { value: "instance/instance-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "插入引用" }));
    expect(onChange).toHaveBeenLastCalledWith("spatial://record-1/video-2/instance/instance-1");
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    rerender(<MomentReferencePicker store={runtime.store} value="" onChange={onChange} disabled />);
    expect(screen.queryByRole("dialog", { name: "引用已标注类别或实例" })).toBeNull();
    runtime.store.getState().dispose();
  });
});
