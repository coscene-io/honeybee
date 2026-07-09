/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, waitFor } from "@testing-library/react";

import MultiProvider from "@foxglove/studio-base/components/MultiProvider";
import CoSceneLayoutManagerContext from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  LayoutID,
  useCurrentLayoutActions,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import {
  ISO8601Timestamp,
  Layout,
  LayoutPermission,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import MockCoSceneLayoutManager from "@foxglove/studio-base/services/LayoutManager/MockCoSceneLayoutManager";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { CoSceneLayoutButton } from "./CoSceneLayoutButton";

const currentId = "mock-layout" as LayoutID;
const secondId = "users/u/layouts/2" as LayoutID;
const mockDispatch = jest.fn();
const mockState = {
  busy: false,
  error: undefined,
  online: true,
  lastSelectedId: currentId,
  selectedIds: [currentId, secondId],
  multiAction: { action: "save" as const, ids: [currentId, secondId] },
};

jest.mock("@foxglove/studio-base/components/CoSceneLayoutBrowser/coSceneReducer", () => ({
  useLayoutBrowserReducer: () => [mockState, mockDispatch],
}));

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => ({
    createProjectLayout: {
      permission: () => true,
    },
  }),
}));

jest.mock("./CoSceneLayoutDrawer", () => ({
  CoSceneLayoutDrawer: () => undefined,
}));

jest.mock("./CurrentLayoutButton", () => ({
  CurrentLayoutButton: () => undefined,
}));

jest.mock("./hooks/useCurrentLayout", () => ({
  useCurrentLayout: () => ({
    loading: false,
    value: {
      allLayouts: [],
      personalFolders: [],
      projectFolders: [],
    },
  }),
}));

function layoutData(value: string): LayoutData {
  return {
    layout: "Panel!1",
    configById: { "Panel!1": { value } },
    globalVariables: {},
    userNodes: {},
  };
}

function ts(value: string): ISO8601Timestamp {
  return value as ISO8601Timestamp;
}

function makeLayout({
  id,
  name,
  data,
  permission = "PERSONAL_WRITE",
}: {
  id: LayoutID;
  name: string;
  data: LayoutData;
  permission?: LayoutPermission;
}): Layout {
  return {
    id,
    parent: "users/u",
    folder: "",
    name,
    permission,
    baseline: {
      data,
      savedAt: ts("2024-01-01T00:00:00.000Z"),
      modifier: undefined,
      modifierNickname: undefined,
    },
    working: {
      data,
      savedAt: ts("2024-01-01T00:00:01.000Z"),
    },
    syncInfo: {
      status: "tracked",
      lastRemoteSavedAt: ts("2024-01-01T00:00:00.000Z"),
      lastRemoteUpdatedAt: ts("2024-01-01T00:00:00.000Z"),
    },
  };
}

function CaptureCurrentLayoutActions({
  onCapture,
}: {
  onCapture: (actions: ReturnType<typeof useCurrentLayoutActions>) => void;
}): ReactNull {
  onCapture(useCurrentLayoutActions());
  return ReactNull;
}

function Wrapper({
  children,
  layoutManager,
  captureActions,
}: React.PropsWithChildren<{
  layoutManager: MockCoSceneLayoutManager;
  captureActions: (actions: ReturnType<typeof useCurrentLayoutActions>) => void;
}>): React.JSX.Element {
  const providers = [
    <DialogsProvider key="dialogs" />,
    <CoSceneLayoutManagerContext.Provider key="layout-manager" value={layoutManager} />,
    <WorkspaceContextProvider key="workspace" />,
    <MockCurrentLayoutProvider key="current-layout" initialState={layoutData("current")} />,
    <ThemeProvider key="theme" isDark />,
  ];
  return (
    <MultiProvider providers={providers}>
      <CaptureCurrentLayoutActions onCapture={captureActions} />
      {children}
    </MultiProvider>
  );
}

describe("<CoSceneLayoutButton />", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it("does not restart a queued multi-save when the current layout changes during the save", async () => {
    const currentLayout = makeLayout({
      id: currentId,
      name: "Current",
      data: layoutData("current"),
    });
    const layoutManager = new MockCoSceneLayoutManager();
    layoutManager.isOnline = true;
    const overwriteCalls: { id: LayoutID; data?: LayoutData | undefined }[] = [];
    let resolveOverwrite: ((layout: Layout) => void) | undefined;
    const overwriteResult = new Promise<Layout>((resolve) => {
      resolveOverwrite = resolve;
    });
    layoutManager.overwriteLayout.mockImplementation(
      async (params: { id: LayoutID; data?: LayoutData | undefined }) => {
        overwriteCalls.push(params);
        return await overwriteResult;
      },
    );
    let currentLayoutActions: ReturnType<typeof useCurrentLayoutActions> | undefined;

    render(
      <Wrapper
        layoutManager={layoutManager}
        captureActions={(actions) => {
          currentLayoutActions = actions;
        }}
      >
        <CoSceneLayoutButton />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(layoutManager.overwriteLayout).toHaveBeenCalledTimes(1);
    });
    expect(overwriteCalls.map((call) => call.id)).toEqual([currentId]);

    if (!currentLayoutActions) {
      throw new Error("Current layout actions were not captured");
    }
    const actions = currentLayoutActions;
    await act(async () => {
      actions.setCurrentLayout({ id: currentId, data: layoutData("changed") });
      await Promise.resolve();
    });

    expect(overwriteCalls.map((call) => call.id)).toEqual([currentId]);

    resolveOverwrite?.(currentLayout);
  });
});
