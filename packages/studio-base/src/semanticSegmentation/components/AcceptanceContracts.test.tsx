/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SemanticSegmentationWorkbench } from "../SemanticSegmentationWorkbench";
import { segmentationFrameStep } from "../frameStep";
import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime, openWorkflowPanel, segmentationSession } from "../runtime";
import { cloneSegmentation, frameInstanceKey } from "../service";
import type { SegmentationDocument } from "../types";
import { ActiveMomentReference } from "./ActiveMomentReference";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { SegmentationWorkspace } from "./SegmentationWorkspace";
import { SpatialTree } from "./SpatialTree";
import { SubmissionControls } from "./WorkflowControls";

const pipeline = {
  playerState: { activeData: { startTime: { sec: 100, nsec: 0 } } },
  pausePlayback: jest.fn(),
  seekPlayback: jest.fn(),
};
const getPipeline = () => pipeline;
jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: () => getPipeline,
}));
jest.mock("@foxglove/studio-base/components/PanelToolbar", () => ({
  PANEL_TOOLBAR_MIN_HEIGHT: 30,
}));

async function fixture(document?: SegmentationDocument) {
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0, streamDelayMs: 0 });
  await runtime.initialize();
  return runtime;
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: jest.fn(),
  });
});

afterEach(() => {
  cleanup();
  segmentationSession.getState().runtime?.dispose();
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    sourceReady: true,
    panelId: undefined,
  });
  jest.clearAllMocks();
});

it.each(["delete", "merge", "move", "class-delete", "class-merge"] as const)(
  "exits editing before validated %s document mutation is observable",
  async (action) => {
    const runtime = await fixture();
    const { store } = runtime;
    store.getState().setFocus({ type: "instance", id: "instance-1" });
    store.getState().setEditing(true);
    const observed: boolean[] = [];
    const detach = store.subscribe((state, previous) => {
      if (state.document !== previous.document) {
        observed.push(state.editing);
      }
    });
    const actions = {
      delete: () => {
        store.getState().deleteInstance("instance-2");
      },
      merge: () => {
        store.getState().mergeInstances(["instance-2"], "instance-1");
      },
      move: () => {
        store.getState().moveInstance("instance-2", "class-1");
      },
      "class-delete": () => {
        store.getState().deleteClass("class-2");
      },
      "class-merge": () => {
        store.getState().mergeClasses(["class-2"], "class-1");
      },
    };
    actions[action]();
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((editing) => !editing)).toBe(true);
    detach();
    runtime.dispose();
  },
);

it("keeps the exact editing/document/staging state when structural validation fails", async () => {
  const runtime = await fixture();
  const { store } = runtime;
  store.getState().setEditing(true);
  const before = store.getState();
  for (const action of [
    () => {
      store.getState().deleteInstance("missing");
    },
    () => {
      store.getState().deleteClass("missing");
    },
    () => {
      store.getState().mergeInstances(["instance-2", "missing"], "instance-1");
    },
    () => {
      store.getState().mergeClasses(["class-2", "missing"], "class-1");
    },
    () => {
      store.getState().moveInstance("instance-2", "missing");
    },
  ]) {
    expect(action).toThrow("Unknown");
    expect(store.getState()).toBe(before);
  }
  runtime.dispose();
});

it("resets tree creation/dialog and canvas drawing/handles while preserving source, viewport and immutable queue", async () => {
  const runtime = await fixture();
  const { store } = runtime;
  const queuedClass = store.getState().addClass("Queued immutable work");
  runtime.service.submit = async () => {
    throw new Error("Retain queued audit");
  };
  store.getState().submit("Queue snapshot");
  await store.getState().waitForSubmissions();
  const queue = store.getState().submissionQueue;
  const audit = cloneSegmentation(queue);
  const source = store.getState().document!.frames;
  const frame = store.getState().currentFrameId;
  const { container } = render(
    <>
      <SpatialTree store={store} />
      <SegmentationCanvas store={store} />
      <SubmissionControls store={store} />
    </>,
  );
  const viewport = screen.getByRole("group", { name: "Annotation viewport" });
  const content = container.querySelector<SVGGElement>("svg g[transform]")!;
  // JSDOM has no SVG layout: model a 960x540 viewBox fitted at half scale,
  // including its screen offset and the live content pan/zoom transform.
  Object.defineProperty(viewport, "getBoundingClientRect", {
    value: () => ({ x: 100, y: 50, width: 480, height: 270 }),
  });
  Object.defineProperty(content, "getScreenCTM", {
    value() {
      const transform = content
        .getAttribute("transform")!
        .match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/)!;
      return {
        a: 0.5 * Number(transform[3]),
        b: 0,
        c: 0,
        d: 0.5 * Number(transform[3]),
        e: 100 + 0.5 * Number(transform[1]),
        f: 50 + 0.5 * Number(transform[2]),
      };
    },
  });
  expect(content.getAttribute("transform")).toBe("translate(0 0) scale(1)");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  const transform = content.getAttribute("transform");
  expect(transform).toBe("translate(-120 -67.5) scale(1.25)");
  const matrix = content.getScreenCTM()!;
  expect(matrix.a).toBe(0.625);
  expect(matrix.a * 480 + matrix.e).toBe(340);
  expect(matrix.d * 270 + matrix.f).toBe(185);
  act(() => {
    const id = store.getState().addPolygon("instance-1");
    store.getState().setFocus({ type: "polygon", id });
    store.getState().setSelection([{ type: "polygon", id }]);
    store.getState().setDrawingPolygonId(id);
  });
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  fireEvent.change(screen.getByLabelText("Class name"), {
    target: { value: "Discard panel draft" },
  });
  act(() => {
    store.getState().revertStaging();
  });
  expect(screen.queryByRole("group", { name: "New class row" })).toBeNull();
  expect(store.getState()).toMatchObject({
    editing: false,
    drawingPolygonId: undefined,
    focus: undefined,
    selection: [],
    currentFrameId: frame,
  });
  expect(container.querySelector("polyline")).toBeNull();
  expect(screen.queryAllByRole("button", { name: /^Vertex/ })).toHaveLength(0);
  expect(content.getAttribute("transform")).toBe(transform);
  expect(store.getState().document!.frames).toEqual(source);
  expect(store.getState().document!.classes.some((item) => item.id === queuedClass)).toBe(true);
  expect(store.getState().submissionQueue).toBe(queue);
  expect(queue).toEqual(audit);
  fireEvent.click(screen.getByRole("button", { name: "Actions for ● Person 1" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete instance in all frames…" }));
  expect(screen.getByRole("dialog")).toBeDefined();
  act(() => {
    store.getState().revertStaging();
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  runtime.dispose();
});

it("identifies a failed stream request, unlocks controls and keeps accepted replacements uncommitted", async () => {
  const runtime = await fixture();
  let requestId: string | undefined;
  runtime.service.propagate = async function* (request) {
    requestId = request.context!.requestId;
    yield {
      frameId: "frame-1",
      instanceId: "instance-1",
      version: 1,
      context: request.context,
      polygons: [{ ...request.seeds![0]!.polygons[0]!, id: "retained" }],
    };
    throw new Error("transport failed");
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
  expect(screen.getByRole("alert").textContent).toContain(requestId);
  expect(screen.getByRole("alert").textContent).toMatch(/部分.*保留.*暂存.*尚未提交/);
  expect(container.querySelector("fieldset")).toHaveProperty("disabled", false);
  expect(
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-1", "instance-1")]!
      .polygons[0]!.id,
  ).toBe("retained");
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  expect(write).not.toHaveBeenCalled();
  runtime.dispose();
});

it("does not mount a duplicate propagation form when opening embedded workflow controls", async () => {
  const runtime = await fixture();
  render(<SemanticSegmentationWorkbench runtime={runtime} embedded />);
  act(() => {
    openWorkflowPanel("seg-propagation");
  });
  expect(screen.queryByRole("region", { name: "传播参数" })).toBeNull();
  expect(screen.queryByRole("button", { name: "在线传播" })).toBeNull();
  runtime.dispose();
});

it("steps the playback bar by annotation frame while editing and fences unready/stopping input", async () => {
  const runtime = await fixture();
  expect(segmentationFrameStep(1)).toBeUndefined();
  segmentationSession.setState({
    runtime,
    open: true,
    panelId: "image-panel",
    sourceReady: true,
    imageUrl: "data:image/png;base64,decoded",
  });
  render(<SegmentationWorkspace panelId="image-panel" />);
  // The in-panel workbench has no frame buttons of its own; the playback bar owns stepping.
  expect(screen.queryByRole("button", { name: "下一帧" })).toBeNull();
  expect(screen.queryByRole("button", { name: "上一帧" })).toBeNull();
  expect(runtime.store.getState().currentFrameId).toBe("frame-0");
  expect(segmentationFrameStep(-1)).toEqual({ timestampSec: undefined });
  expect(segmentationFrameStep(1)).toEqual({ timestampSec: 0.2 });
  expect(segmentationFrameStep(1, 10)).toEqual({ timestampSec: 2 });
  act(() => {
    runtime.store.getState().setCurrentFrame("frame-1");
  });
  expect(segmentationFrameStep(-1)).toEqual({ timestampSec: 0 });
  act(() => {
    segmentationSession.setState({ sourceReady: false });
  });
  expect(segmentationFrameStep(1)).toEqual({ timestampSec: undefined });
  act(() => {
    segmentationSession.setState({ sourceReady: true });
    runtime.store.setState({
      propagation: { status: "stopping", processedFrames: 1, cancellationPending: true },
    });
  });
  expect(segmentationFrameStep(1)).toEqual({ timestampSec: undefined });
  act(() => {
    segmentationSession.setState({ open: false });
  });
  expect(segmentationFrameStep(1)).toBeUndefined();
  runtime.dispose();
});

it("keeps the form record A reference when the runtime switches to B before or during picking", async () => {
  const a = await fixture();
  const document = createSeedDocument();
  document.record.id = "record-B";
  document.videos = document.videos.map((video) => ({ ...video, recordId: "record-B" }));
  const b = await fixture(document);
  const value = "spatial://record-1/video-1/instance/instance-1";
  const change = jest.fn();
  segmentationSession.setState({ runtime: a, sourceReady: true });
  render(<ActiveMomentReference recordId="record-1" value={value} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
  fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
    target: { value: "instance/instance-2" },
  });
  act(() => {
    segmentationSession.setState({ runtime: b });
  });
  expect(screen.getByRole("button", { name: "引用空间类别或实例" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(change).not.toHaveBeenCalled();
  a.dispose();
  b.dispose();
});
