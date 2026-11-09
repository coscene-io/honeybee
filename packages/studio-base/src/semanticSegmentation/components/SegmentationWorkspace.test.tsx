/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";

import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { SegmentationWorkspace } from "./SegmentationWorkspace";

const enterFullscreen = jest.fn();
jest.mock("@foxglove/studio-base/components/PanelContext", () => ({
  usePanelContext: () => ({ enterFullscreen }),
}));
jest.mock("@foxglove/studio-base/components/PanelToolbar", () => ({
  PANEL_TOOLBAR_MIN_HEIGHT: 30,
}));
jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: () => () => ({ playerState: {} }),
}));
jest.mock("../SemanticSegmentationWorkbench", () => ({
  SemanticSegmentationWorkbench: ({
    imageUrl,
    onFullscreen,
  }: {
    imageUrl?: string;
    onFullscreen?: () => void | Promise<void>;
  }) => (
    <button
      type="button"
      data-image={imageUrl ?? "pending"}
      onClick={() => {
        void onFullscreen?.();
      }}
    >
      Panel fullscreen
    </button>
  ),
}));

it("delegates fullscreen to the original panel below its header and withholds mismatched pixels", async () => {
  const runtime = createSegmentationRuntime();
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  segmentationSession.setState({
    runtime,
    panelId: "image-panel",
    open: true,
    imageUrl: "data:image/png;base64,decoded",
    sourceReady: true,
  });
  const { container, unmount } = render(<SegmentationWorkspace panelId="image-panel" />);
  expect(container.querySelector("div")!.style.inset).toMatch(/^30px\s/);
  expect(
    screen.getByRole("button", { name: "Panel fullscreen" }).getAttribute("data-image"),
  ).toContain("decoded");
  fireEvent.click(screen.getByRole("button", { name: "Panel fullscreen" }));
  expect(enterFullscreen).toHaveBeenCalledTimes(1);
  act(() => {
    segmentationSession.setState({ sourceReady: false });
  });
  expect(screen.getByRole("button", { name: "Panel fullscreen" }).getAttribute("data-image")).toBe(
    "pending",
  );
  unmount();
  runtime.dispose();
  segmentationSession.setState({
    runtime: undefined,
    panelId: undefined,
    open: false,
    imageUrl: undefined,
    surfaces: {},
  });
});

it("mounts a workbench on every open camera, not only the focused one", async () => {
  const runtime = createSegmentationRuntime();
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  segmentationSession.setState({
    runtime,
    open: true,
    panelId: "left",
    surfaces: {
      left: { frameId: "frame-0", imageUrl: "data:image/png;base64,left", sourceReady: true },
      right: { frameId: "side-0", imageUrl: "data:image/png;base64,right", sourceReady: true },
    },
  });
  const { unmount } = render(
    <>
      <SegmentationWorkspace panelId="left" />
      <SegmentationWorkspace panelId="right" />
    </>,
  );
  const images = screen.getAllByRole("button", { name: "Panel fullscreen" }).map((button) => {
    return button.getAttribute("data-image");
  });
  expect(images).toEqual([expect.stringContaining("left"), expect.stringContaining("right")]);
  unmount();
  runtime.dispose();
  segmentationSession.setState({
    runtime: undefined,
    panelId: undefined,
    open: false,
    surfaces: {},
  });
});
