/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { useContext } from "react";
import { createStore, type StoreApi } from "zustand";

import { KeyboardShortcutsDialog } from "@foxglove/studio-base/components/PlaybackControls/KeyboardShortcutsDialog";
import {
  KeyboardShortcutsDialogProvider,
  createKeyboardShortcutsDialogStore,
} from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcutsDialogStore";
import { CoreDataContext, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import {
  WorkspaceSlotsProvider,
  createWorkspaceSlotsStore,
} from "@foxglove/studio-base/context/WorkspaceSlots";

import { SEMANTIC_SEGMENTATION_FEATURE_FLAG } from "../featureFlag";
import type { SegmentationRuntime } from "../runtime";
import { SegmentationHostContext, type SegmentationHost } from "../segmentationHostContext";
import { SegmentationWorkspaceExtension } from "./SegmentationWorkspaceExtension";
import { CLOUD_RECORD, createCoreDataSourceStore } from "../testing/coreDataSource";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument } from "../testing/mockService";

const RECORD = CLOUD_RECORD;
let core: StoreApi<CoreDataStore>;
let slots = createWorkspaceSlotsStore();
let shortcuts = createKeyboardShortcutsDialogStore();
/** What the extension's children see in context: the host it created, once it has. */
let seenHost: SegmentationHost | undefined;

const setRecord = (name: string | undefined) => {
  core.setState({
    record: { loading: false, value: name == undefined ? undefined : { name } },
  } as never);
};
const flag = (state: "on" | "off") => {
  window.cosConfig =
    state === "on"
      ? ({
          FEATURE_FLAG_GROWTHBOOK: { [SEMANTIC_SEGMENTATION_FEATURE_FLAG]: true },
        } as typeof window.cosConfig)
      : undefined;
};

function Child(): React.JSX.Element {
  seenHost = useContext(SegmentationHostContext);
  return <div data-testid="child" />;
}

/** The workspace around the extension, as the Workspace mounts it. */
function tree(extra?: React.ReactNode): React.JSX.Element {
  return (
    <CoreDataContext.Provider value={core}>
      <WorkspaceSlotsProvider store={slots}>
        <KeyboardShortcutsDialogProvider store={shortcuts}>
          <SegmentationWorkspaceExtension>
            <Child />
            {extra}
          </SegmentationWorkspaceExtension>
        </KeyboardShortcutsDialogProvider>
      </WorkspaceSlotsProvider>
    </CoreDataContext.Provider>
  );
}
function renderExtension(extra?: React.ReactNode) {
  return render(tree(extra));
}
async function hostReady(): Promise<SegmentationHost> {
  await waitFor(() => {
    expect(seenHost).toBeDefined();
  });
  return seenHost!;
}
async function registered(): Promise<SegmentationHost> {
  const host = await hostReady();
  await waitFor(() => {
    expect(Object.keys(slots.getState().appBarItems)).toEqual(["semanticSegmentation"]);
  });
  return host;
}
const originalUserAgent = navigator.userAgent;
const setUserAgent = (value: string) => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value });
};

beforeEach(async () => {
  core = createCoreDataSourceStore();
  slots = createWorkspaceSlotsStore();
  shortcuts = createKeyboardShortcutsDialogStore();
  seenHost = undefined;
  flag("on");
  await i18n.changeLanguage("en");
});

afterEach(() => {
  window.cosConfig = undefined;
  setUserAgent(originalUserAgent);
});

it("has no host and registers nothing while the rollout flag is off, even on a cloud record", async () => {
  flag("off");
  const { getByTestId } = renderExtension();
  // The workspace still renders: only the editor is absent.
  expect(getByTestId("child")).toBeTruthy();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(seenHost).toBeUndefined();
  const state = slots.getState();
  expect(state.appBarItems).toEqual({});
  expect(state.leftSidebarItems).toEqual({});
  expect(state.playbackStep).toEqual({});
  expect(state.shortcutColumns).toEqual({});
});

it("provides a host to everything below it once the flag is on", async () => {
  renderExtension();
  const host = await hostReady();
  expect(host.registry.heldCount()).toBe(0);
  expect(host.session.getState().open).toBe(false);
});

it("does not remount its children when the flag turns on, or off again", async () => {
  flag("off");
  const view = renderExtension();
  const child = view.getByTestId("child");
  flag("on");
  view.rerender(tree());
  const host = await hostReady();
  expect(view.getByTestId("child")).toBe(child);
  flag("off");
  view.rerender(tree());
  await waitFor(() => {
    expect(seenHost).toBeUndefined();
  });
  expect(view.getByTestId("child")).toBe(child);
  // Turning it off disposed what the host held.
  expect(host.maskOverlay.get()).toBeUndefined();
});

it("disposes the host, and the runtimes it holds, when it unmounts", async () => {
  const view = renderExtension();
  const host = await hostReady();
  const runtime = createMockSegmentationRuntime(createSeedDocument());
  const dispose = jest.spyOn(runtime, "dispose");
  host.registry.acquire("record-x", "panel-x", () => runtime);
  expect(host.registry.heldCount()).toBe(1);
  view.unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(host.registry.heldCount()).toBe(0);
});

it("registers the app bar entry, and the Space sidebar only for a cloud record", async () => {
  setRecord(undefined);
  renderExtension();
  await registered();
  expect(slots.getState().leftSidebarItems).toEqual({});

  act(() => {
    setRecord(RECORD);
  });
  const sidebar = Object.values(slots.getState().leftSidebarItems);
  expect(sidebar.map(({ key, item }) => [key, item.title])).toEqual([["space", "Space"]]);

  act(() => {
    setRecord("local.mcap");
  });
  expect(slots.getState().leftSidebarItems).toEqual({});
});

it("offers no Space sidebar once a local file replaces the cloud source", async () => {
  renderExtension();
  await registered();
  expect(Object.keys(slots.getState().leftSidebarItems)).toHaveLength(1);
  act(() => {
    // Core Data keeps the previous record; only the data source tells the source changed.
    core.setState({ dataSource: { id: "file", type: "file" } } as never);
  });
  expect(slots.getState().leftSidebarItems).toEqual({});
});

it("takes over back / forward only while a camera is being annotated", async () => {
  renderExtension();
  const host = await registered();
  expect(slots.getState().playbackStep).toEqual({});

  act(() => {
    host.chrome.setState({
      canvases: [
        {
          panelId: "Image!head",
          topic: "/camera/head/h264",
          enterInline() {},
          enterMaximize() {},
        },
      ],
    });
    host.session.setState({
      open: true,
      panelId: "Image!head",
      // The lock overlay reads the propagation status; nothing else is used here.
      runtime: {
        store: createStore(() => ({ propagation: { status: "idle" } })),
      } as unknown as SegmentationRuntime,
    });
  });
  const [step] = Object.values(slots.getState().playbackStep);
  expect(step?.backwardLabel).toBe("Previous frame (head)");
  expect(step?.forwardLabel).toBe("Next frame (head)");

  act(() => {
    host.session.setState({ open: false });
  });
  expect(slots.getState().playbackStep).toEqual({});
});

describe("leaving the page", () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  async function withUnsavedWork(host: SegmentationHost) {
    const runtime = createMockSegmentationRuntime(createSeedDocument());
    host.registry.acquire("record-unload", "panel-unload", () => runtime);
    await runtime.initialize();
    runtime.store.getState().addClass("Unsaved");
    return runtime;
  }

  it("asks first only while there is unsaved annotation work", async () => {
    renderExtension();
    const host = await registered();
    expect(unload()).toBe(false);
    const runtime = await withUnsavedWork(host);
    expect(unload()).toBe(true);
    runtime.store.getState().undo();
    expect(unload()).toBe(false);
  });

  it("stops asking once the extension is gone", async () => {
    const view = renderExtension();
    const host = await registered();
    await withUnsavedWork(host);
    view.unmount();
    expect(unload()).toBe(false);
  });
});

describe("Spatial annotation shortcuts column", () => {
  const openDialog = async (opts: { annotating: boolean }) => {
    renderExtension(<KeyboardShortcutsDialog />);
    const host = await registered();
    act(() => {
      host.session.setState({ open: opts.annotating });
      shortcuts.setState({ open: true });
    });
  };

  it("is absent without an annotation session", async () => {
    await openDialog({ annotating: false });
    expect(screen.queryByText("Spatial annotation")).toBeNull();
    expect(screen.queryByText("Fit to selection")).toBeNull();
  });

  it("shows Mac keys under a Mac user agent", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    await openDialog({ annotating: true });
    expect(screen.getByText("Spatial annotation")).toBeTruthy();
    expect(screen.getByText("Fit to selection")).toBeTruthy();
    expect(screen.getByText("⌘ + Z")).toBeTruthy();
    expect(screen.getByText("⌘ + Shift + Z")).toBeTruthy();
    expect(screen.getByText("Option + click")).toBeTruthy();
    expect(screen.queryByText("Ctrl + Y")).toBeNull();
  });

  it("shows Ctrl and Alt keys elsewhere, in the active language", async () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    await openDialog({ annotating: true });
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
