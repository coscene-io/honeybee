/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen, within } from "@testing-library/react";

import { SegmentationWorkbench } from "../components/SegmentationWorkbench";
import { render, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { setMockControls } from "../testing/mockService";
import { allowSlowRunner } from "../testing/slowRunner";

allowSlowRunner();

installSegmentationTestHost();

describe("layout feedback", () => {
  it("keeps workbench notices outside the layout and editing lock while leaving STOP to the global lock and keeping retry guards", async () => {
    const runtime = createMockSegmentationRuntime();
    setMockControls(runtime.service, { delayMs: 0 });
    await runtime.initialize();
    const retry = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    runtime.store.setState({ retryCurrentFrameWindow: retry });
    const { unmount } = render(<SegmentationWorkbench runtime={runtime} />);
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
    const fieldset = screen
      .getByTestId("semantic-segmentation-workbench")
      .querySelector("fieldset")!;
    expect(fieldset.disabled).toBe(true);
    expect(fieldset.hasAttribute("inert")).toBe(true);
    // The embedded canvas leaves STOP to the global lock's top banner.
    expect(screen.queryByRole("button", { name: "Stop propagation" })).toBeNull();
    const retryButton = within(notices).getByRole("button", {
      name: "Retry this annotation window",
    });
    expect(retryButton).toHaveProperty("disabled", true);
    act(() => {
      runtime.store.setState({ propagation: { status: "idle", processedFrames: 1 } });
    });
    expect(retryButton).toHaveProperty("disabled", false);
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(within(notices).getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Failed to save the local batch")).toBeNull();
    unmount();
    runtime.dispose();
  });
});
