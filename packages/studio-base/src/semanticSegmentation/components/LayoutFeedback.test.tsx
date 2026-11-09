/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { SemanticSegmentationWorkbench } from "../SemanticSegmentationWorkbench";
import { createSegmentationRuntime } from "../runtime";

it("keeps workbench notices outside the layout and editing lock while preserving STOP and retry guards", async () => {
  const runtime = createSegmentationRuntime();
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  const stop = jest.fn();
  const retry = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  runtime.store.setState({ stopPropagation: stop, retryCurrentFrameWindow: retry });
  const { unmount } = render(<SemanticSegmentationWorkbench runtime={runtime} embedded />);
  act(() => {
    runtime.store.setState({
      error: "Failed to save the local batch",
      frameWindowError: { videoId: "video-1", startSec: 0, endSec: 1, message: "Read failed" },
      propagation: { status: "running", processedFrames: 1 },
    });
  });
  const notices = screen.getByTestId("workbench-notices");
  expect(notices.closest("fieldset")).toBeNull();
  expect(within(notices).getByText("Failed to save the local batch")).toBeDefined();
  const fieldset = screen.getByTestId("semantic-segmentation-workbench").querySelector("fieldset")!;
  expect(fieldset.disabled).toBe(true);
  expect(fieldset.hasAttribute("inert")).toBe(true);
  const stopButton = within(notices).getByRole("button", { name: "STOP · 停止传播" });
  expect(stopButton).toHaveProperty("disabled", false);
  fireEvent.click(stopButton);
  expect(stop).toHaveBeenCalledTimes(1);
  const retryButton = within(notices).getByRole("button", { name: "重试当前标注窗口" });
  expect(retryButton).toHaveProperty("disabled", true);
  act(() => {
    runtime.store.setState({ propagation: { status: "idle", processedFrames: 1 } });
  });
  expect(retryButton).toHaveProperty("disabled", false);
  fireEvent.click(retryButton);
  expect(retry).toHaveBeenCalledTimes(1);
  fireEvent.click(within(notices).getByRole("button", { name: "关闭错误提示" }));
  expect(screen.queryByText("Failed to save the local batch")).toBeNull();
  unmount();
  runtime.dispose();
});
