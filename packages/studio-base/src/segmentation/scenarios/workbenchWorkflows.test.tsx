/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

import { GlobalPropagationLock } from "../components/GlobalPropagationLock";
import {
  MomentReferencePicker,
  encodeSpatialReference,
  parseSpatialReference,
  resolveSpatialReference,
} from "../components/MomentReferencePicker";
import { SegmentationActionMenu } from "../components/SegmentationActionMenu";
import { SegmentationWorkbench } from "../components/SegmentationWorkbench";
import { endSegmentationSession, openWorkflowPanel } from "../runtime";
import { render, testHost, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { setMockControls } from "../testing/mockService";
import { allowSlowRunner } from "../testing/slowRunner";

allowSlowRunner();

installSegmentationTestHost();

jest.mock("../components/SegmentationCanvas/SegmentationCanvas", () => ({
  SegmentationCanvas: () => <div>Canvas</div>,
}));
jest.mock("../components/SegmentationTree/SegmentationTree", () => ({
  SegmentationTree: () => <div>Space tree</div>,
}));

async function initializedRuntime() {
  const runtime = createMockSegmentationRuntime();
  setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 50 });
  await runtime.initialize();
  return runtime;
}

afterEach(() => {
  cleanup();
  testHost().session.setState({
    runtime: undefined,
    open: false,
  });
});

const t = i18n.getFixedT("en", "segmentation");

describe("workbench workflow integration", () => {
  it("keeps the focused canvas workflow open when an unrelated canvas unmounts", async () => {
    const runtime = await initializedRuntime();
    const session = testHost().session;
    session.setState({ open: true, runtime });
    const view = (panels: "focused-only" | "both") => (
      <>
        <SegmentationWorkbench runtime={runtime} focused />
        {panels === "both" && <SegmentationWorkbench runtime={runtime} focused={false} />}
      </>
    );
    const { rerender } = render(view("both"));
    act(() => {
      openWorkflowPanel(session);
    });
    expect(screen.getByRole("complementary", { name: "Workflow" })).toBeTruthy();
    rerender(view("focused-only"));
    expect(screen.getByRole("complementary", { name: "Workflow" })).toBeTruthy();
    act(() => {
      endSegmentationSession(session);
    });
    expect(screen.queryByRole("complementary", { name: "Workflow" })).toBeNull();
    runtime.dispose();
  });

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
    render(<SegmentationWorkbench runtime={runtime} />);
    act(() => {
      runtime.store.getState().setCurrentFrame("frame-80");
    });
    await screen.findByText(/Could not read this annotation window/);
    // Submit lives in the app-bar menu; it stays disabled while the window is unavailable.
    testHost().session.setState({ runtime, open: true, panelId: "menu-panel", sourceReady: true });
    render(<SegmentationActionMenu />);
    fireEvent.click(screen.getByRole("button", { name: /^Submit/ }));
    expect(screen.getByRole("button", { name: /Submit 1/ })).toHaveProperty("disabled", true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Submit" }), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Submit" })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry this annotation window" }));
    await waitFor(() => {
      expect(runtime.store.getState().isFrameReady("frame-80")).toBe(true);
    });
    expect(runtime.store.getState().frameWindowError).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /^Submit/ }));
    expect(screen.getByRole("button", { name: /Submit 1/ })).toHaveProperty("disabled", false);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Submit" }), { key: "Escape" });
    act(() => {
      testHost().session.setState({ open: false, runtime: undefined, panelId: undefined });
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
    fireEvent.click(screen.getByRole("button", { name: "Reference a spatial class or instance" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Choose a class or instance" }), {
      target: { value: "instance/instance-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert reference" }));
    const value = onChange.mock.calls[0]![0] as string;
    expect(parseSpatialReference(value)).toEqual({
      recordId: "record-1",
      targetType: "instance",
      targetId: "instance-1",
    });
    act(() => {
      runtime.store.getState().renameInstance("instance-1", "Renamed person");
    });
    expect(resolveSpatialReference(value, runtime.store.getState().document, t)).toContain(
      "Renamed person",
    );
    act(() => {
      runtime.store.getState().deleteInstance("instance-1", "all");
    });
    expect(resolveSpatialReference(value, runtime.store.getState().document, t)).toContain(
      "(deleted)",
    );
    expect(resolveSpatialReference(value, undefined, t)).toContain("(record not open)");
    expect(
      parseSpatialReference(encodeSpatialReference("record/odd", "class", "id:odd"))?.recordId,
    ).toBe("record/odd");
    expect(parseSpatialReference("spatial://bad%zz/class/id")).toBeUndefined();
    // The persisted format names the record, the kind and the id only; a camera segment written by
    // earlier builds is read and ignored.
    expect(encodeSpatialReference("record-1", "instance", "instance-1")).toBe(
      "spatial://record-1/instance/instance-1",
    );
    expect(parseSpatialReference("spatial://record-1/old-video/instance/instance-1")).toEqual({
      recordId: "record-1",
      targetType: "instance",
      targetId: "instance-1",
    });
    runtime.store.getState().dispose();
  });
  it("makes every app surface inert while STOP remains outside and restores prior inert state", async () => {
    const runtime = await initializedRuntime();
    testHost().session.setState({ runtime });
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
    const stop = await screen.findByRole("button", { name: "Stop propagation" });
    expect(container.inert).toBe(true);
    expect(stop.closest('[aria-label="Live propagation lock"]')?.parentElement).toBe(document.body);
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
    render(<SegmentationWorkbench runtime={runtime} sourceReady={false} />);
    expect(screen.queryByRole("slider", { name: "视频帧时间轴" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "空间理解标注工作台" })).toBeNull();
    // A lasting wait shows a small marker, not a banner.
    expect(
      await screen.findByTitle(
        /Waiting for the current video frame and annotation data/,
        undefined,
      ),
    ).toBeTruthy();
    act(() => {
      openWorkflowPanel(testHost().session);
    });
    expect(screen.queryByRole("button", { name: "Start propagation" })).toBeNull();
    runtime.store.getState().dispose();
  });

  it("closes the Moment picker when its record becomes unavailable", async () => {
    const runtime = await initializedRuntime();
    const onChange = jest.fn();
    const { rerender } = render(
      <MomentReferencePicker store={runtime.store} value="" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reference a spatial class or instance" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Choose a class or instance" }), {
      target: { value: "instance/instance-1" },
    });
    rerender(<MomentReferencePicker store={runtime.store} value="" onChange={onChange} disabled />);
    expect(
      screen.queryByRole("dialog", { name: "Reference an annotated class or instance" }),
    ).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    runtime.store.getState().dispose();
  });
});
