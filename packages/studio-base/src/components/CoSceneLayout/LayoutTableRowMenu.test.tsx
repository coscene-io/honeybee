/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import {
  ISO8601Timestamp,
  Layout,
  LayoutPermission,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { LayoutTableRowMenu } from "./LayoutTableRowMenu";

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => ({
    deleteProjectLayout: { permission: () => true },
    updateProjectLayout: { permission: () => true },
  }),
}));

jest.mock("@foxglove/studio-base/hooks/useConfirm", () => ({
  useConfirm: () => jest.fn(),
}));

function ts(value: string): ISO8601Timestamp {
  return value as ISO8601Timestamp;
}

function makeRemotelyDeletedLayout(permission: LayoutPermission): Layout {
  const parent = permission === "PERSONAL_WRITE" ? "users/u" : "warehouses/w/projects/p";
  const data = {
    layout: "Panel!1",
    configById: {},
    globalVariables: {},
    userNodes: {},
  };

  return {
    id: `${parent}/layouts/1` as LayoutID,
    parent,
    folder: "",
    name: "Layout",
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
      status: "remotely-deleted",
      lastRemoteSavedAt: undefined,
      lastRemoteUpdatedAt: undefined,
    },
  };
}

function renderMenu(layout: Layout, onOverwriteLayout = jest.fn()): void {
  const anchorEl = document.createElement("button");
  document.body.appendChild(anchorEl);

  render(
    <ThemeProvider isDark>
      <LayoutTableRowMenu
        anchorEl={anchorEl}
        layout={layout}
        handleMenuClose={jest.fn()}
        handleOpenDialog={jest.fn()}
        onDeleteLayout={jest.fn()}
        onExportLayout={jest.fn()}
        onOverwriteLayout={onOverwriteLayout}
        onRevertLayout={jest.fn()}
      />
    </ThemeProvider>,
  );
}

describe("<LayoutTableRowMenu />", () => {
  it("allows saving a remotely deleted personal layout with a draft", () => {
    const layout = makeRemotelyDeletedLayout("PERSONAL_WRITE");
    const onOverwriteLayout = jest.fn();
    renderMenu(layout, onOverwriteLayout);

    const saveItem = screen.getByTestId("save-changes");
    expect(saveItem.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(saveItem);
    expect(onOverwriteLayout).toHaveBeenCalledWith(layout);
  });

  it("keeps saving disabled for a remotely deleted project layout", () => {
    renderMenu(makeRemotelyDeletedLayout("PROJECT_WRITE"));

    expect(screen.getByTestId("save-changes").getAttribute("aria-disabled")).toBe("true");
  });
});
