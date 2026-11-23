/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { createStore } from "zustand/vanilla";

import { KeyboardShortcutsDialog } from "@foxglove/studio-base/components/PlaybackControls/KeyboardShortcutsDialog";
import {
  closeKeyboardShortcuts,
  openKeyboardShortcuts,
} from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcutsDialogStore";
import { useWorkspaceSlots } from "@foxglove/studio-base/context/WorkspaceSlots";

import { annotationRecord } from "../annotationRecord";
import { SEMANTIC_SEGMENTATION_FEATURE_FLAG } from "../featureFlag";
import { segmentationSession, type SegmentationRuntime } from "../runtime";
import { segmentationChrome } from "../segmentationChrome";
import { SegmentationWorkspaceExtension } from "./SegmentationWorkspaceExtension";

const RECORD = "warehouses/w/projects/p/records/r";
const originalUserAgent = navigator.userAgent;
const setUserAgent = (value: string) => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value });
};

beforeEach(async () => {
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
    annotationRecord.setState({ recordName: undefined });
    segmentationChrome.setState({ canvases: [] });
    segmentationSession.setState({ open: false, runtime: undefined, panelId: undefined });
  });
});

it("registers nothing while the rollout flag is off, even on a cloud record", () => {
  window.cosConfig = undefined;
  annotationRecord.setState({ recordName: RECORD });
  const { container } = render(<SegmentationWorkspaceExtension />);
  const slots = useWorkspaceSlots.getState();
  expect(slots.appBarItems).toEqual({});
  expect(slots.leftSidebarItems).toEqual({});
  expect(slots.playbackStep).toEqual({});
  expect(slots.shortcutColumns).toEqual({});
  expect(slots.momentValueRenderers).toEqual({});
  expect(container.innerHTML).toBe("");
});

it("registers the app bar entry, and the Space sidebar only for a cloud record", () => {
  render(<SegmentationWorkspaceExtension />);
  expect(Object.keys(useWorkspaceSlots.getState().appBarItems)).toEqual(["semanticSegmentation"]);
  expect(useWorkspaceSlots.getState().leftSidebarItems).toEqual({});

  act(() => {
    annotationRecord.setState({ recordName: RECORD });
  });
  const sidebar = Object.values(useWorkspaceSlots.getState().leftSidebarItems);
  expect(sidebar.map(({ key, item }) => [key, item.title])).toEqual([["space", "Space"]]);

  act(() => {
    annotationRecord.setState({ recordName: "local.mcap" });
  });
  expect(useWorkspaceSlots.getState().leftSidebarItems).toEqual({});
});

it("takes over back / forward only while a camera is being annotated", () => {
  render(<SegmentationWorkspaceExtension />);
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

describe("Spatial annotation shortcuts column", () => {
  const openDialog = () => {
    render(
      <>
        <SegmentationWorkspaceExtension />
        <KeyboardShortcutsDialog />
      </>,
    );
    act(() => {
      openKeyboardShortcuts();
    });
  };

  it("is absent without an annotation session", () => {
    openDialog();
    expect(screen.queryByText("Spatial annotation")).toBeNull();
    expect(screen.queryByText("Fit to selection")).toBeNull();
  });

  it("shows Mac keys under a Mac user agent", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    act(() => {
      segmentationSession.setState({ open: true });
    });
    openDialog();
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
    openDialog();
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
