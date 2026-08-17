/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook, waitFor } from "@testing-library/react";

import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import type { CoreDataStore, DataSource } from "@foxglove/studio-base/context/CoreDataContext";
import {
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import type {
  CurrentLayoutActions,
  LayoutID,
  LayoutState,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useRecommendedLayouts } from "@foxglove/studio-base/context/RecommendedLayoutContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import type { WorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useSyncLayoutFromUrl } from "@foxglove/studio-base/hooks/useSyncLayoutFromUrl";
import {
  createDefaultRemoteMp4Layout,
  defaultRemoteMp4Layout,
  REMOTE_MP4_DEFAULT_LAYOUT_ID,
  REMOTE_MP4_DEFAULT_LAYOUT_NAME,
} from "@foxglove/studio-base/providers/CurrentLayoutProvider/defaultRemoteMp4Layout";
import type { ILayoutManager } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import type { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import type { RecommendedLayoutDescriptor } from "@foxglove/studio-base/services/RecommendedLayouts";
import type { AppURLState } from "@foxglove/studio-base/util/appURLState";

const mockEnqueueSnackbar = jest.fn();
jest.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}));

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
jest.mock("@foxglove/studio-base/context/RecommendedLayoutContext", () => ({
  useRecommendedLayouts: jest.fn(),
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

function recommendedLayout(transport: "default" | "h264"): RecommendedLayoutDescriptor {
  return {
    id: `recommended:RobotA:${transport}` as LayoutID,
    robot: "RobotA",
    resolution: "_default",
    transport,
    workflow: "review",
    role: "viewer",
    name: "review / viewer",
    url: `https://honeybee-public-layouts.coscene.io/RobotA/${transport}.json`,
  };
}

function makeCurrentLayoutActions(setSelectedLayoutId: jest.Mock): CurrentLayoutActions {
  return {
    getCurrentLayoutState: jest.fn(() => ({ selectedLayout: undefined })),
    setSelectedLayoutId,
    setCurrentLayout: jest.fn(),
    saveRecommendedLayout: jest.fn(),
    withRecommendedLayoutCopyLock: jest.fn(async (operation) => await operation()),
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
    resetPanels: jest.fn(),
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
  let dataSource: DataSource | undefined;
  let setSelectedLayoutId: jest.Mock;
  let openLayoutDrawer: jest.Mock;
  let layoutManager: Pick<ILayoutManager, "getLayout" | "getLayouts" | "getHistory">;
  let currentLayoutActions: CurrentLayoutActions;
  let recommendedLayoutState: ReturnType<typeof useRecommendedLayouts>;

  beforeEach(() => {
    mockEnqueueSnackbar.mockClear();
    selectedLayoutId = undefined;
    isReadyForSyncLayout = true;
    dataSource = undefined;
    setSelectedLayoutId = jest.fn();
    openLayoutDrawer = jest.fn();
    layoutManager = {
      getLayout: jest.fn(),
      getLayouts: jest.fn(),
      getHistory: jest.fn(),
    };
    currentLayoutActions = makeCurrentLayoutActions(setSelectedLayoutId);
    recommendedLayoutState = {
      status: "ready",
      layouts: [],
      loadLayout: jest.fn(),
    };

    jest.mocked(useLayoutManager).mockReturnValue(layoutManager as ILayoutManager);
    jest
      .mocked(useCoreData)
      .mockImplementation((selector) =>
        selector({ isReadyForSyncLayout, dataSource } as CoreDataStore),
      );
    jest.mocked(useCurrentLayoutSelector).mockImplementation((selector) =>
      selector({
        selectedLayout: selectedLayoutId ? { id: selectedLayoutId } : undefined,
      } as LayoutState),
    );
    jest.mocked(useCurrentLayoutActions).mockReturnValue(currentLayoutActions);
    jest.mocked(useRecommendedLayouts).mockImplementation(() => recommendedLayoutState);
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
      });
    });

    await waitFor(() => {
      expect(setSelectedLayoutId).toHaveBeenCalledWith(historyLayout.id);
    });
    expect(openLayoutDrawer).not.toHaveBeenCalled();
  });

  it("selects a valid ordinary URL layout without reading history or recommendations", async () => {
    const urlLayout = layout("users/u/layouts/url");
    jest.mocked(layoutManager.getLayout).mockResolvedValue(urlLayout);

    renderHook(() => {
      useSyncLayoutFromUrl({ layoutId: urlLayout.id });
    });

    await waitFor(() => {
      expect(setSelectedLayoutId).toHaveBeenCalledWith(urlLayout.id);
    });
    expect(layoutManager.getHistory).not.toHaveBeenCalled();
    expect(recommendedLayoutState.loadLayout).not.toHaveBeenCalled();
  });

  it("selects a valid recommended URL layout before history", async () => {
    const descriptor = recommendedLayout("default");
    const data = { layout: "Panel!1", configById: {}, globalVariables: {}, userNodes: {} };
    recommendedLayoutState = {
      status: "ready",
      layouts: [descriptor],
      automaticLayout: recommendedLayout("h264"),
      loadLayout: jest.fn().mockResolvedValue(data),
    };

    renderHook(() => {
      useSyncLayoutFromUrl({ layoutId: descriptor.id });
    });

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: descriptor.id,
        name: descriptor.name,
        data,
        source: "recommended",
        recommendedLayout: descriptor,
      });
    });
    expect(layoutManager.getHistory).not.toHaveBeenCalled();
  });

  it("restores history before loading the automatic recommendation", async () => {
    const historyLayout = layout("users/u/layouts/history");
    recommendedLayoutState = {
      status: "ready",
      layouts: [recommendedLayout("default")],
      automaticLayout: recommendedLayout("default"),
      loadLayout: jest.fn(),
    };
    jest.mocked(layoutManager.getHistory).mockResolvedValue(historyLayout);

    renderHook(() => {
      useSyncLayoutFromUrl(undefined);
    });

    await waitFor(() => {
      expect(setSelectedLayoutId).toHaveBeenCalledWith(historyLayout.id);
    });
    expect(recommendedLayoutState.loadLayout).not.toHaveBeenCalled();
  });

  it.each(["default", "h264"] as const)(
    "loads the %s automatic recommendation after URL and history are missing",
    async (transport) => {
      const descriptor = recommendedLayout(transport);
      const data = { layout: "Panel!1", configById: {}, globalVariables: {}, userNodes: {} };
      recommendedLayoutState = {
        status: "ready",
        layouts: [descriptor],
        automaticLayout: descriptor,
        loadLayout: jest.fn().mockResolvedValue(data),
      };
      jest.mocked(layoutManager.getHistory).mockResolvedValue(undefined);

      renderHook(() => {
        useSyncLayoutFromUrl(undefined);
      });

      await waitFor(() => {
        expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
          id: descriptor.id,
          name: descriptor.name,
          data,
          source: "recommended",
          recommendedLayout: descriptor,
        });
      });
      expect(openLayoutDrawer).not.toHaveBeenCalled();
    },
  );

  it("opens the drawer and reports an automatic recommendation load failure", async () => {
    const descriptor = recommendedLayout("default");
    recommendedLayoutState = {
      status: "ready",
      layouts: [descriptor],
      automaticLayout: descriptor,
      loadLayout: jest.fn().mockRejectedValue(new Error("layout unavailable")),
    };
    jest.mocked(layoutManager.getHistory).mockResolvedValue(undefined);

    renderHook(() => {
      useSyncLayoutFromUrl(undefined);
    });

    await waitFor(() => {
      expect(openLayoutDrawer).toHaveBeenCalledTimes(1);
    });
    expect(currentLayoutActions.setCurrentLayout).not.toHaveBeenCalled();
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining("layout unavailable"),
      { variant: "error" },
    );
  });

  it("always applies the built-in MP4 layout for remote-mp4", async () => {
    const historyLayout = layout("users/u/layouts/history");
    const urlLayout = layout("users/u/layouts/url");
    jest.mocked(layoutManager.getHistory).mockResolvedValue(historyLayout);
    jest.mocked(layoutManager.getLayout).mockResolvedValue(urlLayout);

    renderHook(() => {
      useSyncLayoutFromUrl({
        ds: "remote-mp4",
        layoutId: urlLayout.id,
      });
    });

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: defaultRemoteMp4Layout,
        transient: true,
      });
    });
    expect(layoutManager.getHistory).not.toHaveBeenCalled();
    expect(layoutManager.getLayout).not.toHaveBeenCalled();
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
    expect(openLayoutDrawer).not.toHaveBeenCalled();
  });

  it("subscribes the MP4 Image panel to ds.topic", async () => {
    renderHook(() => {
      useSyncLayoutFromUrl({
        ds: "remote-mp4",
        dsParams: { topic: "/vehicle/front" },
      });
    });

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: createDefaultRemoteMp4Layout("/vehicle/front"),
        transient: true,
      });
    });
  });

  it("applies the built-in MP4 layout when remote-mp4 is selected in-app", async () => {
    const historyLayout = layout("users/u/layouts/history");
    jest.mocked(layoutManager.getHistory).mockResolvedValue(historyLayout);
    dataSource = {
      id: "remote-mp4",
      type: "connection",
      params: { topic: "/cam/custom" },
    };

    renderHook(() => {
      useSyncLayoutFromUrl(undefined);
    });

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: createDefaultRemoteMp4Layout("/cam/custom"),
        transient: true,
      });
    });
    expect(layoutManager.getHistory).not.toHaveBeenCalled();
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
  });

  it("replaces a previously restored layout when remote-mp4 is selected later", async () => {
    const historyLayout = layout("users/u/layouts/history");
    jest.mocked(layoutManager.getHistory).mockResolvedValue(historyLayout);

    const { rerender } = renderHook(
      ({ urlState }: { urlState: AppURLState | undefined }) => {
        useSyncLayoutFromUrl(urlState);
      },
      { initialProps: { urlState: undefined as AppURLState | undefined } },
    );

    await waitFor(() => {
      expect(setSelectedLayoutId).toHaveBeenCalledWith(historyLayout.id);
    });

    selectedLayoutId = historyLayout.id;
    dataSource = {
      id: "remote-mp4",
      type: "connection",
      params: { topic: "/cam/custom" },
    };

    rerender({ urlState: undefined });

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: createDefaultRemoteMp4Layout("/cam/custom"),
        transient: true,
      });
    });
  });

  it("uses the live source default topic instead of the launch ds.topic", async () => {
    const urlState: AppURLState = { ds: "remote-mp4", dsParams: { topic: "/vehicle/front" } };

    const { rerender } = renderHook(
      ({ state }: { state: AppURLState | undefined }) => {
        useSyncLayoutFromUrl(state);
      },
      { initialProps: { state: urlState } },
    );

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: createDefaultRemoteMp4Layout("/vehicle/front"),
        transient: true,
      });
    });

    // The user picks a URL-only remote-mp4 recent: the live source has no topic
    // and publishes on the default, so the layout must follow it.
    jest.mocked(currentLayoutActions.setCurrentLayout).mockClear();
    selectedLayoutId = REMOTE_MP4_DEFAULT_LAYOUT_ID;
    dataSource = { id: "remote-mp4", type: "connection" };

    rerender({ state: urlState });

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith({
        id: REMOTE_MP4_DEFAULT_LAYOUT_ID,
        name: REMOTE_MP4_DEFAULT_LAYOUT_NAME,
        data: createDefaultRemoteMp4Layout(),
        transient: true,
      });
    });
  });

  it("does not keep the MP4 layout after switching away from a remote-mp4 deep link", async () => {
    dataSource = { id: "remote-mp4", type: "connection" };

    const { rerender } = renderHook(
      ({ urlState }: { urlState: AppURLState | undefined }) => {
        useSyncLayoutFromUrl(urlState);
      },
      { initialProps: { urlState: { ds: "remote-mp4" } } },
    );

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_MP4_DEFAULT_LAYOUT_ID }),
      );
    });

    jest.mocked(currentLayoutActions.setCurrentLayout).mockClear();
    selectedLayoutId = "users/u/layouts/personal" as LayoutID;
    dataSource = { id: "coscene-data-platform", type: "connection" };

    await act(async () => {
      rerender({ urlState: { ds: "remote-mp4" } });
    });

    expect(currentLayoutActions.setCurrentLayout).not.toHaveBeenCalled();
  });

  it("does not re-apply the MP4 layout after the remote-mp4 source is cleared", async () => {
    dataSource = { id: "remote-mp4", type: "connection" };

    const { rerender } = renderHook(
      ({ urlState }: { urlState: AppURLState | undefined }) => {
        useSyncLayoutFromUrl(urlState);
      },
      { initialProps: { urlState: { ds: "remote-mp4" } } },
    );

    await waitFor(() => {
      expect(currentLayoutActions.setCurrentLayout).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_MP4_DEFAULT_LAYOUT_ID }),
      );
    });

    jest.mocked(currentLayoutActions.setCurrentLayout).mockClear();
    selectedLayoutId = "users/u/layouts/personal" as LayoutID;
    dataSource = undefined;

    await act(async () => {
      rerender({ urlState: { ds: "remote-mp4" } });
    });

    expect(currentLayoutActions.setCurrentLayout).not.toHaveBeenCalled();
  });

  it("opens the layout drawer when the URL layout and history are missing", async () => {
    const urlLayoutId = "users/u/layouts/missing-url" as LayoutID;
    jest.mocked(layoutManager.getLayout).mockResolvedValue(undefined);
    jest.mocked(layoutManager.getHistory).mockResolvedValue(undefined);
    jest.mocked(layoutManager.getLayouts).mockResolvedValue([layout("users/u/layouts/personal-1")]);

    renderHook(() => {
      useSyncLayoutFromUrl({
        layoutId: urlLayoutId,
      });
    });

    await waitFor(() => {
      expect(openLayoutDrawer).toHaveBeenCalledTimes(1);
    });
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
    expect(layoutManager.getLayouts).not.toHaveBeenCalled();
  });
});
