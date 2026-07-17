/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import MultiProvider from "@foxglove/studio-base/components/MultiProvider";
import StudioToastProvider from "@foxglove/studio-base/components/StudioToastProvider";
import CoSceneLayoutManagerContext from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  LayoutID,
  useCurrentLayoutActions,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import MockCoSceneCurrentUserProvider from "@foxglove/studio-base/providers/MockCoSceneCurrentUserProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import {
  ISO8601Timestamp,
  Layout,
  LayoutPermission,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import MockCoSceneLayoutManager from "@foxglove/studio-base/services/LayoutManager/MockCoSceneLayoutManager";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { CoSceneLayoutButton } from ".";

function layoutData(value: string): LayoutData {
  return {
    layout: "Panel!1",
    configById: { "Panel!1": { value } },
    globalVariables: {},
    userNodes: {},
  };
}

function layoutId(value: string): LayoutID {
  return value as LayoutID;
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
    <MockCoSceneCurrentUserProvider key="current-user" />,
    <CoSceneLayoutManagerContext.Provider key="layout-manager" value={layoutManager} />,
    <WorkspaceContextProvider key="workspace" />,
    <StudioToastProvider key="toast" />,
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
  it("does not restart a queued multi-save when the current layout changes during the save", async () => {
    const currentId = layoutId("mock-layout");
    const secondId = layoutId("users/u/layouts/2");
    const layouts = [
      makeLayout({ id: currentId, name: "Current", data: layoutData("current") }),
      makeLayout({ id: secondId, name: "Second", data: layoutData("second") }),
    ];
    const layoutManager = new MockCoSceneLayoutManager();
    layoutManager.isOnline = true;
    layoutManager.getLayouts.mockResolvedValue(layouts);
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

    if (!currentLayoutActions) {
      throw new Error("Current layout actions were not captured");
    }
    const actions = currentLayoutActions;
    await act(async () => {
      actions.setCurrentLayout({ id: currentId, data: layoutData("latest-before-save") });
      await Promise.resolve();
    });

    fireEvent.click(await screen.findByText("Current"));
    fireEvent.click(await screen.findByText("Second"), { shiftKey: true });
    const secondActionsButton = screen.getAllByTestId("layout-actions")[1];
    if (!secondActionsButton) {
      throw new Error("Second layout action button was not rendered");
    }
    fireEvent.click(secondActionsButton);
    fireEvent.click(await screen.findByText("Save"));

    await waitFor(() => {
      expect(layoutManager.overwriteLayout).toHaveBeenCalledTimes(1);
    });
    expect(overwriteCalls.map((call) => call.id)).toEqual([currentId]);
    expect(overwriteCalls[0]?.data).toEqual(layoutData("latest-before-save"));
    await act(async () => {
      actions.setCurrentLayout({ id: currentId, data: layoutData("changed") });
      await Promise.resolve();
    });

    expect(overwriteCalls.map((call) => call.id)).toEqual([currentId]);

    const currentLayout = layouts[0];
    if (!currentLayout) {
      throw new Error("Current layout was not created");
    }
    resolveOverwrite?.(currentLayout);
    await waitFor(() => {
      expect(overwriteCalls.map((call) => call.id)).toEqual([currentId, secondId]);
    });
  });
});
