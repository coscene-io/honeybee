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

import { CurrentLayoutButton } from "./CurrentLayoutButton";

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => ({
    updateProjectLayout: {
      permission: () => true,
    },
  }),
}));

function ts(value: string): ISO8601Timestamp {
  return value as ISO8601Timestamp;
}

function makeRemotelyDeletedLayout(permission: LayoutPermission): Layout {
  const id = `${permission === "PERSONAL_WRITE" ? "users/u" : "warehouses/w/projects/p"}/layouts/1`;
  const data = {
    layout: "Panel!1",
    configById: {},
    globalVariables: {},
    userNodes: {},
  };

  return {
    id: id as LayoutID,
    parent: id.slice(0, id.lastIndexOf("/layouts/")),
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

function renderButton(layout: Layout, onOverwriteLayout = jest.fn()): void {
  render(
    <ThemeProvider isDark>
      <CurrentLayoutButton
        currentLayoutId={layout.id}
        layouts={{ allLayouts: [layout], personalFolders: [], projectFolders: [] }}
        onClick={jest.fn()}
        onOverwriteLayout={onOverwriteLayout}
        onRevertLayout={jest.fn()}
      />
    </ThemeProvider>,
  );
  // The component currently renders action buttons inside a ButtonBase.
  for (const [message] of jest.mocked(console.error).mock.calls) {
    expect(message).toContain("validateDOMNesting");
  }
  jest.mocked(console.error).mockClear();
}

describe("<CurrentLayoutButton />", () => {
  it("allows saving a remotely deleted personal layout with a draft", () => {
    const layout = makeRemotelyDeletedLayout("PERSONAL_WRITE");
    const onOverwriteLayout = jest.fn();
    renderButton(layout, onOverwriteLayout);

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(saveButton);
    expect(onOverwriteLayout).toHaveBeenCalledWith(layout);
  });

  it("keeps saving disabled for a remotely deleted project layout", () => {
    renderButton(makeRemotelyDeletedLayout("PROJECT_WRITE"));

    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });
});
