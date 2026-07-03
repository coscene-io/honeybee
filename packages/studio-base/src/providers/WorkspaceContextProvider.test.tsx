/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";

import { TIMELINE_MIN_HEIGHT_PX } from "@foxglove/studio-base/components/PlaybackControls/constants";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";

import WorkspaceContextProvider from "./WorkspaceContextProvider";

const NORMAL_KEY = "fox.workspace";
const SHARE_KEY = "fox.workspace.shareManifest";
const SHARE_URL =
  "http://localhost/viz?ds=coscene-share-manifest#manifestUrl=https%3A%2F%2Fstorage.example.com%2Fmanifest.json";
const NORMAL_URL = "http://localhost/viz?ds=coscene-data-platform";

function persistedWorkspace({
  leftOpen,
  timelineHeight,
}: {
  leftOpen: boolean;
  timelineHeight: number;
}): string {
  return (
    JSON.stringify({
      version: 1,
      state: {
        sidebars: {
          left: { item: "playlist", open: leftOpen, size: 400 },
          right: { item: undefined, open: false, size: undefined },
        },
        playbackControls: { timelineHeight },
      },
    }) ?? ""
  );
}

function renderWithProvider(): {
  leftOpen: boolean;
  rightOpen: boolean;
  timelineHeight: number;
} {
  const captured = { leftOpen: true, rightOpen: false, timelineHeight: -1 };
  function Capture(): ReactNull {
    captured.leftOpen = useWorkspaceStore((s) => s.sidebars.left.open);
    captured.rightOpen = useWorkspaceStore((s) => s.sidebars.right.open);
    captured.timelineHeight = useWorkspaceStore((s) => s.playbackControls.timelineHeight);
    return ReactNull;
  }
  render(
    <WorkspaceContextProvider>
      <Capture />
    </WorkspaceContextProvider>,
  );
  return captured;
}

describe("WorkspaceContextProvider share-manifest branch", () => {
  const originalUrl = window.location.href;

  afterEach(() => {
    window.history.replaceState(undefined, "", originalUrl);
    window.localStorage.clear();
  });

  it("applies share defaults (sidebars hidden, timeline min) on a first share visit", () => {
    window.history.replaceState(undefined, "", SHARE_URL);

    const state = renderWithProvider();

    expect(state.leftOpen).toBe(false);
    expect(state.rightOpen).toBe(false);
    expect(state.timelineHeight).toBe(TIMELINE_MIN_HEIGHT_PX);
  });

  it("respects the viewer's persisted share-store state on a return share visit", () => {
    window.localStorage.setItem(SHARE_KEY, persistedWorkspace({ leftOpen: true, timelineHeight: 250 }));
    window.history.replaceState(undefined, "", SHARE_URL);

    const state = renderWithProvider();

    // Persisted viewer changes win over the share defaults.
    expect(state.leftOpen).toBe(true);
    expect(state.timelineHeight).toBe(250);
  });

  it("reads only the share key in share mode, ignoring normal-mode state", () => {
    // Normal-mode store says left CLOSED; share mode must not read it.
    window.localStorage.setItem(NORMAL_KEY, persistedWorkspace({ leftOpen: false, timelineHeight: 999 }));
    window.history.replaceState(undefined, "", SHARE_URL);

    const state = renderWithProvider();

    // No share-key persistence => share defaults, NOT the normal-key values.
    expect(state.leftOpen).toBe(false);
    expect(state.timelineHeight).toBe(TIMELINE_MIN_HEIGHT_PX);
    expect(state.timelineHeight).not.toBe(999);
  });

  it("uses normal defaults and reads the normal key for a non-share URL", () => {
    window.history.replaceState(undefined, "", NORMAL_URL);

    const state = renderWithProvider();

    expect(state.leftOpen).toBe(true);
    expect(state.timelineHeight).toBe(200);
  });

  it("reads only the normal key in normal mode, ignoring share-mode state", () => {
    window.localStorage.setItem(SHARE_KEY, persistedWorkspace({ leftOpen: false, timelineHeight: 126 }));
    window.history.replaceState(undefined, "", NORMAL_URL);

    const state = renderWithProvider();

    // Normal mode must not pick up the share-store's hidden-sidebar state.
    expect(state.leftOpen).toBe(true);
    expect(state.timelineHeight).toBe(200);
  });
});
