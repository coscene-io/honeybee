/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, waitFor } from "@testing-library/react";

import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import type { CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import {
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import type {
  CurrentLayoutActions,
  LayoutID,
  LayoutState,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import type { WorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useSyncLayoutFromUrl } from "@foxglove/studio-base/hooks/useSyncLayoutFromUrl";
import type { ILayoutManager } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import type { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import type { AppURLState } from "@foxglove/studio-base/util/appURLState";

jest.mock("@foxglove/studio-base/context/CoSceneLayoutManagerContext", () => ({
  useLayoutManager: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: jest.fn(),
  useCurrentLayoutSelector: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: jest.fn(),
}));

function layout(id: string, permission: Layout["permission"] = "PERSONAL_WRITE"): Layout {
  return {
    id: id as LayoutID,
    parent: permission === "PERSONAL_WRITE" ? "users/u" : "warehouses/w/projects/p",
    folder: "",
    name: id,
    permission,
    baseline: {
      data: { layout: "Panel!1", configById: {}, globalVariables: {}, userNodes: {} },
      savedAt: undefined,
      modifier: undefined,
      modifierNickname: undefined,
    },
    working: undefined,
    syncInfo: undefined,
  };
}

function makeCurrentLayoutActions(setSelectedLayoutId: jest.Mock): CurrentLayoutActions {
  return {
    getCurrentLayoutState: jest.fn(() => ({ selectedLayout: undefined })),
    setSelectedLayoutId,
    setCurrentLayout: jest.fn(),
    updateSharedPanelState: jest.fn(),
    savePanelConfigs: jest.fn(),
    updatePanelConfigs: jest.fn(),
    createTabPanel: jest.fn(),
    changePanelLayout: jest.fn(),
    overwriteGlobalVariables: jest.fn(),
    setGlobalVariables: jest.fn(),
    setUserScripts: jest.fn(),
    closePanel: jest.fn(),
    splitPanel: jest.fn(),
    swapPanel: jest.fn(),
    moveTab: jest.fn(),
    addPanel: jest.fn(),
    dropPanel: jest.fn(),
    startDrag: jest.fn(),
    endDrag: jest.fn(),
  };
}

function makeWorkspaceActions(openLayoutDrawer: jest.Mock): WorkspaceActions {
  return {
    dialogActions: {
      dataSource: {
        close: jest.fn(),
        open: jest.fn(),
      },
      openFile: {
        open: jest.fn(async () => {}),
      },
      preferences: {
        close: jest.fn(),
        open: jest.fn(),
      },
    },
    featureTourActions: {
      startTour: jest.fn(),
      finishTour: jest.fn(),
    },
    openPanelSettings: jest.fn(),
    layoutDrawer: {
      close: jest.fn(),
      open: openLayoutDrawer,
    },
    playbackControlActions: {
      setRepeat: jest.fn(),
      setRollingEditEnabled: jest.fn(),
      setSpeed: jest.fn(),
      setTimelineHeight: jest.fn(),
      setMomentSubtitleEnabled: jest.fn(),
      setMomentSubtitleFontSize: jest.fn(),
      setMomentSubtitlePosition: jest.fn(),
    },
    sidebarActions: {
      left: {
        selectItem: jest.fn(),
        setOpen: jest.fn(),
        setSize: jest.fn(),
      },
      right: {
        selectItem: jest.fn(),
        setOpen: jest.fn(),
        setSize: jest.fn(),
      },
    },
  };
}

describe("useSyncLayoutFromUrl", () => {
  let selectedLayoutId: LayoutID | undefined;
  let isReadyForSyncLayout: boolean;
  let setSelectedLayoutId: jest.Mock;
  let openLayoutDrawer: jest.Mock;
  let layoutManager: Pick<ILayoutManager, "getLayout" | "getLayouts" | "getHistory">;

  beforeEach(() => {
    selectedLayoutId = undefined;
    isReadyForSyncLayout = true;
    setSelectedLayoutId = jest.fn();
    openLayoutDrawer = jest.fn();
    layoutManager = {
      getLayout: jest.fn(),
      getLayouts: jest.fn(),
      getHistory: jest.fn(),
    };

    jest.mocked(useLayoutManager).mockReturnValue(layoutManager as ILayoutManager);
    jest
      .mocked(useCoreData)
      .mockImplementation((selector) => selector({ isReadyForSyncLayout } as CoreDataStore));
    jest.mocked(useCurrentLayoutSelector).mockImplementation((selector) =>
      selector({
        selectedLayout: selectedLayoutId ? { id: selectedLayoutId } : undefined,
      } as LayoutState),
    );
    jest
      .mocked(useCurrentLayoutActions)
      .mockReturnValue(makeCurrentLayoutActions(setSelectedLayoutId));
    jest.mocked(useWorkspaceActions).mockReturnValue(makeWorkspaceActions(openLayoutDrawer));
  });

  it("restores history when the URL layout is missing", async () => {
    const urlLayoutId = "users/u/layouts/missing-url" as LayoutID;
    const historyLayout = layout("users/u/layouts/history");
    jest.mocked(layoutManager.getLayout).mockResolvedValue(undefined);
    jest.mocked(layoutManager.getHistory).mockResolvedValue(historyLayout);

    renderHook(() => {
      useSyncLayoutFromUrl({
        layoutId: urlLayoutId,
      } as AppURLState);
    });

    await waitFor(() => {
      expect(setSelectedLayoutId).toHaveBeenCalledWith(historyLayout.id);
    });
    expect(openLayoutDrawer).not.toHaveBeenCalled();
  });

  it("opens the layout drawer when the URL layout and history are missing", async () => {
    const urlLayoutId = "users/u/layouts/missing-url" as LayoutID;
    jest.mocked(layoutManager.getLayout).mockResolvedValue(undefined);
    jest.mocked(layoutManager.getHistory).mockResolvedValue(undefined);
    jest.mocked(layoutManager.getLayouts).mockResolvedValue([layout("users/u/layouts/personal-1")]);

    renderHook(() => {
      useSyncLayoutFromUrl({
        layoutId: urlLayoutId,
      } as AppURLState);
    });

    await waitFor(() => {
      expect(openLayoutDrawer).toHaveBeenCalledTimes(1);
    });
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
    expect(layoutManager.getLayouts).not.toHaveBeenCalled();
  });
});
