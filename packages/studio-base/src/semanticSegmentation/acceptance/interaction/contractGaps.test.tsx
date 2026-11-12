/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { editor, fixture, polygon, setup } from "./fixtures";
import { SemanticSegmentationWorkbench } from "../../SemanticSegmentationWorkbench";
import { SegmentationCanvas } from "../../components/SegmentationCanvas";
import { SpatialTree } from "../../components/SpatialTree";
import { SubmissionControls } from "../../components/WorkflowControls";
import { createSegmentationRuntime, openWorkflowPanel } from "../../runtime";
import { cloneSegmentation } from "../../service";

// These retain the original Then. A product defect is evidence, never a reason to weaken an assertion.
it.each(["delete", "merge", "move"] as const)(
  "SEG-FOC-013 exits edit BEFORE another instance %s mutation becomes observable",
  async (action) => {
    const { store } = await editor();
    fireEvent.click(screen.getByRole("button", { name: "● Person 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for ● Object 1" }));
    const names = {
      delete: "Delete instance in all frames…",
      merge: "Merge into instance…",
      move: "Move to class…",
    };
    fireEvent.click(screen.getByRole("menuitem", { name: names[action] }));
    const before = store.getState().document;
    const observed: boolean[] = [];
    const detach = store.subscribe((state, previous) => {
      if (state.document !== previous.document) {
        observed.push(state.editing);
      }
    });
    const dialog = screen.getByRole("dialog");
    if (action !== "delete") {
      fireEvent.mouseDown(within(dialog).getByRole("combobox"));
      fireEvent.click(
        screen.getByRole("option", {
          name: action === "merge" ? /Person \/ Person 1/ : /^Person \(/,
        }),
      );
    }
    fireEvent.click(
      within(dialog).getByRole("button", { name: action === "delete" ? "Delete" : "Confirm" }),
    );
    expect(store.getState().document).not.toEqual(before);
    expect(store.getState().editing).toBe(false);
    detach();
    store.getState().dispose();
    expect(observed.length).toBeGreaterThan(0);
    expect(observed).toEqual(observed.map(() => false));
  },
);

it("SEG-ONLINE-014 failure names the job and explicitly explains retained partial staging", async () => {
  const runtime = createSegmentationRuntime(fixture());
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  const seed = cloneSegmentation(polygon(runtime.store));
  let jobId: string | undefined;
  runtime.service.propagate = async function* (request) {
    jobId = request.context!.requestId;
    yield {
      frameId: "frame-1",
      instanceId: "instance-1",
      version: 1,
      polygons: [{ ...seed, id: "partial-result" }],
      context: request.context,
    };
    throw new Error("Inference transport failed");
  };
  const write = jest.spyOn(runtime.service, "submit");
  const { container } = render(<SemanticSegmentationWorkbench runtime={runtime} />);
  await act(async () => {
    await runtime.store.getState().startPropagation({
      fromFrameId: "frame-0",
      instanceId: "instance-1",
      endTimeNs: "1700000000400000000",
    });
  });
  expect(runtime.store.getState().propagation.status).toBe("failed");
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  expect(polygon(runtime.store, "instance-1", "frame-1").id).toBe("partial-result");
  expect(container.querySelector("fieldset")).toHaveProperty("disabled", false);
  expect(write).not.toHaveBeenCalled();
  const alert = screen.getByRole("alert").textContent;
  const body = container.textContent;
  runtime.dispose();
  expect({
    identifiesTask: alert.includes(jobId!),
    explainsRetainedPartialDrafts: /部分.*(?:保留|暂存)|(?:保留|暂存).*部分/.test(body),
  }).toEqual({ identifiesTask: true, explainsRetainedPartialDrafts: true });
});

it("SEG-SAVE-025 local reset clears drawing, stale focus handles and temporary creation panel", async () => {
  const { store } = await setup();
  const { container } = render(
    <>
      <SpatialTree store={store} />
      <SegmentationCanvas store={store} />
      <SubmissionControls store={store} />
    </>,
  );
  act(() => {
    const id = store.getState().addPolygon("instance-empty");
    store.getState().setFocus({ type: "polygon", id });
    store.getState().setSelection([{ type: "polygon", id }]);
    store.getState().setDrawingPolygonId(id);
  });
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Stale panel draft" } });
  fireEvent.click(screen.getByRole("button", { name: "清除暂存" }));
  fireEvent.click(screen.getByRole("button", { name: "仅清除未提交修改" }));
  expect(store.getState().drawingPolygonId).toBeUndefined();
  expect(store.getState().editing).toBe(false);
  expect(store.getState().focus).toBeUndefined();
  expect(store.getState().selection).toEqual([]);
  expect(container.querySelector("polyline")).toBeNull();
  expect(screen.queryAllByRole("button", { name: /^Vertex/ })).toHaveLength(0);
  store.getState().dispose();
  expect(screen.queryByRole("group", { name: "New class row" })).toBeNull();
});

it("SEG-ONLINE-001 propagation entry opens online/offline choices and common supported parameters", async () => {
  const runtime = createSegmentationRuntime(fixture());
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
  const before = runtime.store.getState().document;
  // Browser scrolling is outside jsdom; actual opening and form controls remain real.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  render(<SemanticSegmentationWorkbench runtime={runtime} />);
  act(() => {
    openWorkflowPanel("seg-propagation");
  });
  const panel = screen.getByRole("complementary", { name: "工作流管理" });
  expect(within(panel).getByRole("button", { name: "在线传播" })).toBeDefined();
  expect(within(panel).queryByRole("button", { name: "加入离线队列" })).toBeNull();
  expect(within(panel).getByRole("spinbutton", { name: "后帧数" })).toBeDefined();
  expect(within(panel).getByRole("combobox", { name: "传播模型" })).toBeDefined();
  expect(within(panel).queryByRole("combobox", { name: "传播分辨率" })).toBeNull();
  expect(
    [...within(panel).getByRole<HTMLSelectElement>("combobox", { name: "传播模型" }).options].map(
      (option) => option.value,
    ),
  ).toEqual(runtime.store.getState().propagationCapabilities!.models);
  expect(runtime.store.getState().document).toEqual(before);
  expect(runtime.store.getState().stagedOperations).toHaveLength(0);
  runtime.dispose();
});
