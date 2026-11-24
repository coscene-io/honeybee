/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { createStore, type StoreApi } from "zustand";

import { KeyboardShortcutsDialog } from "@foxglove/studio-base/components/PlaybackControls/KeyboardShortcutsDialog";
import {
  closeKeyboardShortcuts,
  openKeyboardShortcuts,
} from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcutsDialogStore";
import { CoreDataContext, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import { useWorkspaceSlots } from "@foxglove/studio-base/context/WorkspaceSlots";

import { SEMANTIC_SEGMENTATION_FEATURE_FLAG } from "../featureFlag";
import {
  acquireSegmentationRuntime,
  releaseSegmentationRuntime,
  segmentationSession,
  type SegmentationRuntime,
} from "../runtime";
import { segmentationChrome } from "../segmentationChrome";
import { SegmentationWorkspaceExtension } from "./SegmentationWorkspaceExtension";
import { CLOUD_RECORD, createCoreDataSourceStore } from "../testing/coreDataSource";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument } from "../testing/mockService";

const RECORD = CLOUD_RECORD;
let core: StoreApi<CoreDataStore>;
const setRecord = (name: string | undefined) => {
  core.setState({
    record: { loading: false, value: name == undefined ? undefined : { name } },
  } as never);
};

/** Renders the extension on the open source; the editor part loads on demand once the flag is on. */
function renderExtension(extra?: React.ReactNode) {
  return render(
    <CoreDataContext.Provider value={core}>
      <SegmentationWorkspaceExtension />
      {extra}
    </CoreDataContext.Provider>,
  );
}
async function registered(): Promise<void> {
  await waitFor(() => {
    expect(Object.keys(useWorkspaceSlots.getState().appBarItems)).toEqual(["semanticSegmentation"]);
  });
}
const originalUserAgent = navigator.userAgent;
const setUserAgent = (value: string) => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value });
};

beforeEach(async () => {
  core = createCoreDataSourceStore();
  window.cosConfig = {
    FEATURE_FLAG_GROWTHBOOK: { [SEMANTIC_SEGMENTATION_FEATURE_FLAG]: true },
  } as typeof window.cosConfig;
  await i18n.changeLanguage("en");
});

afterEach(() => {
  window.cosConfig = undefined;
  setUserAgent(originalUserAgent);
  act(() => {
    closeKeyboardShortcuts();
    segmentationChrome.setState({ canvases: [] });
    segmentationSession.setState({ open: false, runtime: undefined, panelId: undefined });
  });
});

it("registers nothing while the rollout flag is off, even on a cloud record", () => {
  window.cosConfig = undefined;
  const { container } = renderExtension();
  const slots = useWorkspaceSlots.getState();
  expect(slots.appBarItems).toEqual({});
  expect(slots.leftSidebarItems).toEqual({});
  expect(slots.playbackStep).toEqual({});
  expect(slots.shortcutColumns).toEqual({});
  expect(container.innerHTML).toBe("");
});

it("registers the app bar entry, and the Space sidebar only for a cloud record", async () => {
  setRecord(undefined);
  renderExtension();
  await registered();
  expect(useWorkspaceSlots.getState().leftSidebarItems).toEqual({});

  act(() => {
    setRecord(RECORD);
  });
  const sidebar = Object.values(useWorkspaceSlots.getState().leftSidebarItems);
  expect(sidebar.map(({ key, item }) => [key, item.title])).toEqual([["space", "Space"]]);

  act(() => {
    setRecord("local.mcap");
  });
  expect(useWorkspaceSlots.getState().leftSidebarItems).toEqual({});
});

it("offers no Space sidebar once a local file replaces the cloud source", async () => {
  renderExtension();
  await registered();
  expect(Object.keys(useWorkspaceSlots.getState().leftSidebarItems)).toHaveLength(1);
  act(() => {
    // Core Data keeps the previous record; only the data source tells the source changed.
    core.setState({ dataSource: { id: "file", type: "file" } } as never);
  });
  expect(useWorkspaceSlots.getState().leftSidebarItems).toEqual({});
});

it("takes over back / forward only while a camera is being annotated", async () => {
  renderExtension();
  await registered();
  expect(useWorkspaceSlots.getState().playbackStep).toEqual({});

  act(() => {
    segmentationChrome.setState({
      canvases: [
        {
          panelId: "Image!head",
          topic: "/camera/head/h264",
          enterInline() {},
          enterMaximize() {},
        },
      ],
    });
    segmentationSession.setState({
      open: true,
      panelId: "Image!head",
      // The lock overlay reads the propagation status; nothing else is used here.
      runtime: {
        store: createStore(() => ({ propagation: { status: "idle" } })),
      } as unknown as SegmentationRuntime,
    });
  });
  const [step] = Object.values(useWorkspaceSlots.getState().playbackStep);
  expect(step?.backwardLabel).toBe("Previous frame (head)");
  expect(step?.forwardLabel).toBe("Next frame (head)");

  act(() => {
    segmentationSession.setState({ open: false });
  });
  expect(useWorkspaceSlots.getState().playbackStep).toEqual({});
});

describe("leaving the page", () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  async function withUnsavedWork() {
    const runtime = createMockSegmentationRuntime(createSeedDocument());
    acquireSegmentationRuntime("record-unload", "panel-unload", () => runtime);
    await runtime.initialize();
    runtime.store.getState().addClass("Unsaved");
    return runtime;
  }
  afterEach(async () => {
    releaseSegmentationRuntime("panel-unload");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("asks first only while there is unsaved annotation work", async () => {
    renderExtension();
    await registered();
    expect(unload()).toBe(false);
    const runtime = await withUnsavedWork();
    expect(unload()).toBe(true);
    runtime.store.getState().undo();
    expect(unload()).toBe(false);
  });

  it("stops asking once the extension is gone", async () => {
    const { unmount } = renderExtension();
    await registered();
    await withUnsavedWork();
    unmount();
    expect(unload()).toBe(false);
  });
});

describe("Spatial annotation shortcuts column", () => {
  const openDialog = async () => {
    renderExtension(<KeyboardShortcutsDialog />);
    await registered();
    act(() => {
      openKeyboardShortcuts();
    });
  };

  it("is absent without an annotation session", async () => {
    await openDialog();
    expect(screen.queryByText("Spatial annotation")).toBeNull();
    expect(screen.queryByText("Fit to selection")).toBeNull();
  });

  it("shows Mac keys under a Mac user agent", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    act(() => {
      segmentationSession.setState({ open: true });
    });
    await openDialog();
    expect(screen.getByText("Spatial annotation")).toBeTruthy();
    expect(screen.getByText("Fit to selection")).toBeTruthy();
    expect(screen.getByText("⌘ + Z")).toBeTruthy();
    expect(screen.getByText("⌘ + Shift + Z")).toBeTruthy();
    expect(screen.getByText("Option + click")).toBeTruthy();
    expect(screen.queryByText("Ctrl + Y")).toBeNull();
  });

  it("shows Ctrl and Alt keys elsewhere, in the active language", async () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    act(() => {
      segmentationSession.setState({ open: true });
    });
    await openDialog();
    expect(screen.getByText("Ctrl + Z")).toBeTruthy();
    expect(screen.getByText("Ctrl + Shift + Z")).toBeTruthy();
    expect(screen.getByText("Ctrl + Y")).toBeTruthy();
    expect(screen.getByText("Alt + click")).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage("zh");
    });
    expect(screen.getByText("空间标注")).toBeTruthy();
    expect(screen.getByText("Alt + 点击")).toBeTruthy();
  });
});
