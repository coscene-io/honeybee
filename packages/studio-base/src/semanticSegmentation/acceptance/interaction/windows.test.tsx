/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { deferred, fixture } from "./fixtures";
import { SemanticSegmentationWorkbench } from "../../SemanticSegmentationWorkbench";
import { createSegmentationRuntime, openWorkflowPanel } from "../../runtime";
import { cloneSegmentation, frameInstanceKey } from "../../service";

it("SEG-ENT-004/005/006 bounds 60s-video windows at start/30s/last actual frame and preserves selected instance while a read is held", async () => {
  const document = fixture();
  const template = document.frames[0]!;
  document.frames = Array.from({ length: 300 }, (_, index) => ({
    ...template,
    id: `frame-${index}`,
    index,
    timestampSec: index / 5,
  }));
  document.videos[0]!.durationSec = 60;
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0 });
  const reads = jest.spyOn(runtime.service, "loadFrameWindow");
  await runtime.initialize();
  expect(reads.mock.calls[0]!.slice(0, 3)).toEqual(["video-1", 0, 10]);
  runtime.store.getState().setFocus({ type: "instance", id: "instance-1" });
  runtime.store.getState().setSelection([{ type: "instance", id: "instance-1" }]);
  const original = runtime.service.loadFrameWindow.bind(runtime.service);
  const annotationWindow = await original("video-1", 30, 40);
  const gate = deferred<typeof annotationWindow>();
  reads.mockImplementationOnce(async () => await gate.promise);
  render(<SemanticSegmentationWorkbench runtime={runtime} embedded />);
  const selected = cloneSegmentation(runtime.store.getState().selection);
  act(() => {
    runtime.store.getState().setCurrentFrame("frame-150");
  });
  expect(reads.mock.calls.at(-1)!.slice(0, 3)).toEqual(["video-1", 30, 40]);
  expect(runtime.store.getState().document!.record.id).toBe("record-1");
  expect(runtime.store.getState().loading).toBe(true);
  expect(screen.getByText(/正在等待当前视频帧和标注数据/)).toBeDefined();
  // A real drawer control reacts while the geometry promise remains unresolved.
  act(() => {
    openWorkflowPanel();
  });
  expect(screen.getByRole("complementary", { name: "工作流管理" })).toBeDefined();
  expect(runtime.store.getState().loading).toBe(true);
  expect(runtime.store.getState().focus).toEqual({ type: "instance", id: "instance-1" });
  expect(runtime.store.getState().selection).toEqual(selected);
  await act(async () => {
    gate.resolve(annotationWindow);
    await Promise.resolve();
  });
  expect(runtime.store.getState().isFrameReady("frame-150")).toBe(true);
  const end = deferred<Awaited<ReturnType<typeof original>>>();
  reads.mockImplementationOnce(async () => await end.promise);
  act(() => {
    runtime.store.getState().setCurrentFrame("frame-299");
  });
  expect(reads.mock.calls.at(-1)!.slice(0, 3)).toEqual(["video-1", 50, 60]);
  await act(async () => {
    end.resolve(await original("video-1", 50, 60));
    await Promise.resolve();
  });
  for (const [, start, finish] of reads.mock.calls) {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(finish).toBeLessThanOrEqual(60);
    expect(finish - start).toBeGreaterThanOrEqual(0);
    expect(finish - start).toBeLessThanOrEqual(10);
  }
  runtime.dispose();
});

it("SEG-ENT-007 a normalized two-page complete-window response renders each stable identity and every frame polygon once", async () => {
  const document = fixture(2);
  document.instances = document.instances.filter((instance) => instance.id !== "instance-empty");
  document.classes = document.classes.filter((category) => category.id !== "class-empty");
  delete document.annotations[frameInstanceKey("frame-1", "instance-2")];
  delete document.annotationSummaries[frameInstanceKey("frame-1", "instance-2")];
  delete document.versions[frameInstanceKey("frame-1", "instance-2")];
  const first = cloneSegmentation(document.annotations[frameInstanceKey("frame-0", "instance-1")]!);
  const second = cloneSegmentation(
    document.annotations[frameInstanceKey("frame-0", "instance-2")]!,
  );
  const later = cloneSegmentation(document.annotations[frameInstanceKey("frame-1", "instance-1")]!);
  const q = {
    id: "page-two-Q",
    points: [
      { x: 0.6, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.7, y: 0.3 },
    ],
  };
  // Backend boundary fixture, not an implementation or proof of production pagination.
  // Page 2 repeats P at a service page boundary and adds Q/later-frame content.
  const pages = [
    [first, second],
    [{ ...first, polygons: [first.polygons[0]!, q] }, later],
  ];
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0 });
  const original = runtime.service.loadFrameWindow.bind(runtime.service);
  jest.spyOn(runtime.service, "loadFrameWindow").mockImplementation(async (...args) => {
    const complete = await original(...args);
    return {
      ...complete,
      annotations: {
        [frameInstanceKey("frame-0", "instance-1")]: cloneSegmentation(pages[1]![0]!),
        [frameInstanceKey("frame-0", "instance-2")]: cloneSegmentation(second),
        [frameInstanceKey("frame-1", "instance-1")]: cloneSegmentation(later),
      },
    };
  });
  await runtime.initialize();
  const { container } = render(<SemanticSegmentationWorkbench runtime={runtime} />);
  const instanceRow = container.querySelector('[data-node-id="instance-1"]');
  for (const id of [
    "class-1",
    "class-2",
    "instance-1",
    "instance-2",
    first.polygons[0]!.id,
    second.polygons[0]!.id,
    q.id,
  ]) {
    expect(container.querySelectorAll(`[data-node-id="${id}"]`)).toHaveLength(1);
  }
  const image = screen.getByRole("img", { name: "Frame polygons" });
  expect(
    image.querySelectorAll(
      '[data-instance-id="instance-1"] [data-testid="instance-union-fill"] path',
    ),
  ).toHaveLength(2);
  expect(
    image.querySelectorAll(
      '[data-instance-id="instance-2"] [data-testid="instance-union-fill"] path',
    ),
  ).toHaveLength(1);
  expect(
    image
      .querySelectorAll(
        '[data-instance-id="instance-1"] [data-testid="instance-union-fill"] path',
      )[1]!
      .getAttribute("d"),
  ).toBe("M576,54 L768,54 L672,162 Z");
  expect(
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-0", "instance-1")]!
      .polygons,
  ).toEqual([first.polygons[0]!, q]);
  const qRow = container.querySelector<HTMLElement>(`[data-node-id="${q.id}"]`)!;
  fireEvent.click(within(qRow).getByRole("button", { name: /^Polygon 2/ }));
  expect(runtime.store.getState().selection).toEqual([{ type: "polygon", id: q.id }]);
  await act(async () => {
    await runtime.store.getState().loadFrameWindow("video-1", 0, 0.4);
  });
  expect(container.querySelector('[data-node-id="instance-1"]')).toBe(instanceRow);
  expect(container.querySelectorAll(`[data-node-id="${q.id}"]`)).toHaveLength(1);
  expect(runtime.store.getState().selection).toEqual([{ type: "polygon", id: q.id }]);
  act(() => {
    runtime.store.getState().setCurrentFrame("frame-1");
  });
  expect(container.querySelectorAll(`[data-node-id="${later.polygons[0]!.id}"]`)).toHaveLength(1);
  expect(
    runtime.store.getState().document!.annotations[frameInstanceKey("frame-1", "instance-1")]!
      .polygons,
  ).toEqual(later.polygons);
  expect(
    image.querySelectorAll(
      '[data-instance-id="instance-1"] [data-testid="instance-union-fill"] path',
    ),
  ).toHaveLength(1);
  runtime.dispose();
});
