/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, act } from "@testing-library/react";
import { PropsWithChildren } from "react";

import { TIMELINE_MIN_HEIGHT_PX } from "@foxglove/studio-base/components/PlaybackControls/constants";
import PlayerSelectionContext, {
  PlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";

import { useWorkspaceStore } from "./WorkspaceContext";
import { useWorkspaceActions } from "./useWorkspaceActions";

const mockPlayerSelection: PlayerSelection = {
  selectSource: jest.fn(),
  selectRecent: jest.fn(),
  reloadCurrentSource: jest.fn(async () => {}),
  availableSources: [],
  recentSources: [],
  selectedSource: undefined,
};

function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
  return (
    <PlayerSelectionContext.Provider value={mockPlayerSelection}>
      <WorkspaceContextProvider
        disablePersistence
        initialState={
          {
            sidebars: {
              left: { item: "playlist", open: true, size: 300 },
              right: { item: "variables", open: true, size: 220 },
            },
            playbackControls: { timelineHeight: 320 },
          } as never
        }
      >
        {children}
      </WorkspaceContextProvider>
    </PlayerSelectionContext.Provider>
  );
}

describe("useWorkspaceActions resetPanels", () => {
  it("resets sidebar visibility + size and timeline height to share-manifest defaults", () => {
    const { result } = renderHook(
      () => ({
        actions: useWorkspaceActions(),
        left: useWorkspaceStore((store) => store.sidebars.left),
        right: useWorkspaceStore((store) => store.sidebars.right),
        timelineHeight: useWorkspaceStore((store) => store.playbackControls.timelineHeight),
      }),
      { wrapper: Wrapper },
    );

    // Precondition: dirtied panel state from initialState.
    expect(result.current.left.open).toBe(true);
    expect(result.current.left.size).toBe(300);
    expect(result.current.right.open).toBe(true);
    expect(result.current.timelineHeight).toBe(320);

    act(() => {
      result.current.actions.resetPanels();
    });

    expect(result.current.left.open).toBe(false);
    expect(result.current.left.size).toBeUndefined();
    expect(result.current.right.open).toBe(false);
    expect(result.current.right.size).toBeUndefined();
    expect(result.current.timelineHeight).toBe(TIMELINE_MIN_HEIGHT_PX);
  });

  it("leaves sidebar tab selection (item) untouched", () => {
    const { result } = renderHook(
      () => ({
        actions: useWorkspaceActions(),
        left: useWorkspaceStore((store) => store.sidebars.left),
        right: useWorkspaceStore((store) => store.sidebars.right),
      }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.actions.resetPanels();
    });

    expect(result.current.left.item).toBe("playlist");
    expect(result.current.right.item).toBe("variables");
  });
});
