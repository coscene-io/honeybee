/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { createMuiTheme } from "@foxglove/theme";

import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import {
  registerSegmentationCanvas,
  segmentationChrome,
  type SegmentationCanvasEntry,
} from "../segmentationChrome";
import { SegmentationAppBarControls } from "./SegmentationAppBarControls";

const theme = createMuiTheme("light", "en");

function canvas(
  panelId: string,
  topic: string,
): SegmentationCanvasEntry & { inline: jest.Mock; maximize: jest.Mock } {
  const inline = jest.fn();
  const maximize = jest.fn();
  return { panelId, topic, enterInline: inline, enterMaximize: maximize, inline, maximize };
}

function renderBar(): void {
  render(
    <ThemeProvider theme={theme}>
      <MockCurrentLayoutProvider>
        <SegmentationAppBarControls />
      </MockCurrentLayoutProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  segmentationChrome.setState({ canvases: [] });
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    workflow: { open: false, nonce: 0 },
  });
});

it("stays hidden until an image panel can enter annotation", () => {
  renderBar();
  expect(screen.queryByTestId("segmentation-app-bar")).toBeNull();
});

it("opens and maximizes the only canvas from the app bar", () => {
  const only = canvas("panel-1", "/astribot_camera/head_rgbd/color_compress/compressed/h264");
  const unregister = registerSegmentationCanvas(only);
  renderBar();
  fireEvent.click(screen.getByTitle("编辑空间标注"));
  fireEvent.click(screen.getByLabelText("放大并编辑空间标注"));
  expect(only.inline).toHaveBeenCalledTimes(1);
  expect(only.maximize).toHaveBeenCalledTimes(1);
  expect(screen.getByTitle("编辑空间标注").textContent).toBe("✎ 编辑空间标注");
  act(() => {
    unregister();
  });
  expect(screen.queryByTitle("编辑空间标注")).toBeNull();
});

it("enters annotation on one click when several image panels are open", () => {
  const head = canvas("head", "/astribot_camera/head_rgbd/color_compress/compressed/h264");
  const torso = canvas("torso", "/astribot_camera/torso_rgbd/color_compress/compressed/h264");
  registerSegmentationCanvas(head);
  registerSegmentationCanvas(torso);
  renderBar();
  expect(screen.queryByRole("button", { name: "放大并编辑空间标注" })).toBeNull();
  fireEvent.click(screen.getByTitle("编辑空间标注"));
  expect(screen.queryByRole("dialog", { name: "选择画布" })).toBeNull();
  expect(head.inline).toHaveBeenCalledTimes(1);
  expect(torso.inline).not.toHaveBeenCalled();
});

it("shows the record actions and closes the space from the app bar", async () => {
  const document = createSeedDocument();
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  const other = canvas("torso", "/camera/torso");
  registerSegmentationCanvas(other);
  segmentationSession.setState({
    runtime,
    open: true,
    panelId: "head",
    sourceReady: true,
    workflow: { open: false, nonce: 0 },
  });
  renderBar();
  const bar = screen.getByTestId("segmentation-app-bar");
  expect(within(bar).queryByTitle("编辑空间标注")).toBeNull();
  expect(within(bar).getByRole("button", { name: "撤销标注" })).toBeTruthy();
  expect(within(bar).getByRole("button", { name: "传播" })).toBeTruthy();
  expect(within(bar).getByRole("button", { name: "提交" })).toBeTruthy();
  expect(within(bar).queryByRole("button", { name: "切换画布" })).toBeNull();
  fireEvent.click(within(bar).getByRole("button", { name: "结束标注" }));
  expect(segmentationSession.getState().open).toBe(false);
  runtime.dispose();
});
