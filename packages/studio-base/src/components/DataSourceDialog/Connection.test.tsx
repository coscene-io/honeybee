/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import type { UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import type { IDataSourceFactory } from "@foxglove/studio-base/context/PlayerSelectionContext";
import type { WorkspaceContextStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";

import Connection from "./Connection";

const mockSelectSource = jest.fn();
const mockClose = jest.fn();
const mockAnalytics = { logEvent: jest.fn(async () => {}) };
let mockSources: IDataSourceFactory[] = [];
const mockDialog = { activeDataSource: undefined };
const mockDialogActions = { dataSource: { close: mockClose } };

jest.mock("@foxglove/studio-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ availableSources: mockSources, selectSource: mockSelectSource }),
}));
jest.mock("@foxglove/studio-base/context/CoSceneCurrentUserContext", () => ({
  useCurrentUser: (selector: (state: Partial<UserStore>) => unknown) =>
    selector({ user: undefined, loginStatus: "notLogin" }),
}));
jest.mock("@foxglove/studio-base/context/Workspace/WorkspaceContext", () => ({
  useWorkspaceStore: (selector: (state: Partial<WorkspaceContextStore>) => unknown) =>
    selector({ dialogs: { dataSource: mockDialog } } as Partial<WorkspaceContextStore>),
}));
jest.mock("@foxglove/studio-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: () => ({ dialogActions: mockDialogActions }),
}));
jest.mock("@foxglove/studio-base/context/AnalyticsContext", () => ({
  useAnalytics: () => mockAnalytics,
}));
jest.mock("./View", () => ({
  __esModule: true,
  default: ({ children, onOpen }: PropsWithChildren<{ onOpen?: () => void }>) => (
    <div>
      {children}
      <button onClick={onOpen}>Open</button>
    </div>
  ),
}));
jest.mock("./FormField", () => ({ FormField: () => ReactNull }));

it.each(["connection", "persistent-cache"] as const)(
  "opens a visible %s source with its declared type and form values",
  (type) => {
    jest.clearAllMocks();
    mockSources = [
      {
        id: "dialog-source",
        type,
        displayName: "Dialog source",
        initialize: jest.fn(),
        formConfig: {
          fields: [{ id: "sessionId", label: "Session", defaultValue: "dialog-session" }],
        },
      },
    ];
    const view = render(<Connection />);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(mockSelectSource).toHaveBeenCalledWith("dialog-source", {
        type,
        params: { sessionId: "dialog-session" },
      });
      expect(mockClose).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  },
);
