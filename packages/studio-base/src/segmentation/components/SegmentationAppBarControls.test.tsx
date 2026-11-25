/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, screen, within } from "@testing-library/react";

import { CoreDataContext } from "@foxglove/studio-base/context/CoreDataContext";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { createMuiTheme } from "@foxglove/theme";

import { SEGMENTATION_FEATURE_FLAG } from "../featureFlag";
import { registerSegmentationCanvas, type SegmentationCanvasEntry } from "../segmentationChrome";
import { SegmentationAppBarControls } from "./SegmentationAppBarControls";
import { createCoreDataSourceStore } from "../testing/coreDataSource";
import { render, testHost, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument, setMockControls } from "../testing/mockService";

installSegmentationTestHost();

const theme = createMuiTheme("light", "en");

function canvas(
  panelId: string,
  topic: string,
): SegmentationCanvasEntry & { inline: jest.Mock; maximize: jest.Mock } {
  const inline = jest.fn();
  const maximize = jest.fn();
  return { panelId, topic, enterInline: inline, enterMaximize: maximize, inline, maximize };
}

let core = createCoreDataSourceStore();

function renderBar(): void {
  render(
    <CoreDataContext.Provider value={core}>
      <ThemeProvider theme={theme}>
        <MockCurrentLayoutProvider>
          <SegmentationAppBarControls />
        </MockCurrentLayoutProvider>
      </ThemeProvider>
    </CoreDataContext.Provider>,
  );
}

beforeEach(() => {
  window.cosConfig = {
    FEATURE_FLAG_GROWTHBOOK: { [SEGMENTATION_FEATURE_FLAG]: true },
  } as typeof window.cosConfig;
  core = createCoreDataSourceStore();
});

afterEach(() => {
  window.cosConfig = undefined;
  testHost().chrome.setState({ canvases: [] });
  testHost().session.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    workflow: { open: false, nonce: 0 },
  });
});

describe("SegmentationAppBarControls", () => {
  it("stays hidden until an image panel can enter annotation", () => {
    renderBar();
    expect(screen.queryByTestId("segmentation-app-bar")).toBeNull();
  });

  it("opens and maximizes the only canvas from the app bar", () => {
    const only = canvas("panel-1", "/camera/head_rgbd/h264");
    const unregister = registerSegmentationCanvas(testHost().chrome, only);
    renderBar();
    fireEvent.click(screen.getByTitle("Edit spatial annotation"));
    fireEvent.click(screen.getByRole("button", { name: "Maximize and edit spatial annotation" }));
    expect(only.inline).toHaveBeenCalledTimes(1);
    expect(only.maximize).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Edit spatial annotation").textContent).toBe(
      "Edit spatial annotation",
    );
    act(() => {
      unregister();
    });
    expect(screen.queryByTitle("Edit spatial annotation")).toBeNull();
  });

  it("hides the entry for a source without a cloud record", () => {
    core = createCoreDataSourceStore({ dataSourceId: "file" });
    const unregister = registerSegmentationCanvas(testHost().chrome, canvas("panel-1", "/camera"));
    renderBar();
    expect(screen.queryByTestId("segmentation-app-bar")).toBeNull();
    expect(screen.queryByTitle("Edit spatial annotation")).toBeNull();
    act(() => {
      unregister();
    });
  });

  it("hides the entry while the rollout flag is off, even on a cloud record", () => {
    window.cosConfig = undefined;
    const unregister = registerSegmentationCanvas(testHost().chrome, canvas("panel-1", "/camera"));
    renderBar();
    expect(screen.queryByTestId("segmentation-app-bar")).toBeNull();
    act(() => {
      unregister();
    });
  });

  it("enters annotation on one click when several image panels are open", () => {
    const head = canvas("head", "/camera/head_rgbd/h264");
    const torso = canvas("torso", "/camera/torso_rgbd/h264");
    registerSegmentationCanvas(testHost().chrome, head);
    registerSegmentationCanvas(testHost().chrome, torso);
    renderBar();
    expect(
      screen.queryByRole("button", { name: "Maximize and edit spatial annotation" }),
    ).toBeNull();
    fireEvent.click(screen.getByTitle("Edit spatial annotation"));
    expect(screen.queryByRole("dialog", { name: "选择画布" })).toBeNull();
    expect(head.inline).toHaveBeenCalledTimes(1);
    expect(torso.inline).not.toHaveBeenCalled();
  });

  it("shows the record actions and closes the space from the app bar", async () => {
    const document = createSeedDocument();
    const runtime = createMockSegmentationRuntime(document);
    setMockControls(runtime.service, { delayMs: 0 });
    await runtime.initialize();
    const other = canvas("torso", "/camera/torso");
    registerSegmentationCanvas(testHost().chrome, other);
    testHost().session.setState({
      runtime,
      open: true,
      panelId: "head",
      sourceReady: true,
      workflow: { open: false, nonce: 0 },
    });
    renderBar();
    const bar = screen.getByTestId("segmentation-app-bar");
    expect(within(bar).queryByTitle("Edit spatial annotation")).toBeNull();
    expect(within(bar).getByRole("button", { name: "Undo annotation" })).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: "Propagate" })).toBeNull();
    expect(within(bar).getByRole("button", { name: "Submit" })).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: "切换画布" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "End annotation" }));
    expect(testHost().session.getState().open).toBe(false);
    runtime.dispose();
  });
});
