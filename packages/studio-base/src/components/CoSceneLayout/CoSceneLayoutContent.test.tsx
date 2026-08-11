/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, within } from "@testing-library/react";

import { CoSceneLayoutContent } from "@foxglove/studio-base/components/CoSceneLayout/CoSceneLayoutContent";
import type { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import type { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import type { RecommendedLayoutDescriptor } from "@foxglove/studio-base/services/RecommendedLayouts";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

jest.mock("@foxglove/studio-base/context/CoSceneCurrentUserContext", () => ({
  useCurrentUser: (selector: (store: { loginStatus: string }) => unknown) =>
    selector({ loginStatus: "alreadyLogin" }),
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (store: { externalInitConfig: { projectId: string } }) => unknown) =>
    selector({ externalInitConfig: { projectId: "project-a" } }),
}));

function storedLayout(id: string, name: string, permission: Layout["permission"]): Layout {
  return {
    id: id as LayoutID,
    parent: permission === "PERSONAL_WRITE" ? "users/u" : "warehouses/w/projects/p",
    folder: "",
    name,
    permission,
    baseline: {
      data: { configById: {}, globalVariables: {}, userNodes: {} },
      savedAt: undefined,
      modifier: undefined,
      modifierNickname: undefined,
    },
    working: undefined,
    syncInfo: undefined,
  };
}

function recommendation(transport: "default" | "h264"): RecommendedLayoutDescriptor {
  return {
    id: `recommended:RobotA:${transport}` as LayoutID,
    robot: "RobotA",
    resolution: "_default",
    transport,
    workflow: transport === "default" ? "review" : "inspect",
    role: "viewer",
    name: `${transport === "default" ? "review" : "inspect"} / viewer`,
    url: `https://honeybee-public-layouts.coscene.io/RobotA/${transport}.json`,
  };
}

function sameNameRecommendation(transport: "default" | "h264"): RecommendedLayoutDescriptor {
  return {
    ...recommendation(transport),
    workflow: "review",
    name: "review / viewer",
  };
}

describe("CoSceneLayoutContent", () => {
  it("keeps personal and project layouts while showing Default and H.264 recommendations", () => {
    const onSelectRecommendedLayout = jest.fn();
    const onCopyRecommendedLayout = jest.fn();
    render(
      <ThemeProvider isDark>
        <CoSceneLayoutContent
          supportsProjectWrite
          layouts={{
            allLayouts: [
              storedLayout("users/u/layouts/1", "Personal one", "PERSONAL_WRITE"),
              storedLayout("warehouses/w/projects/p/layouts/1", "Project one", "PROJECT_READ"),
            ],
            personalFolders: [],
            projectFolders: [],
          }}
          recommendedLayouts={[recommendation("default"), recommendation("h264")]}
          onSelectLayout={jest.fn()}
          onSelectRecommendedLayout={onSelectRecommendedLayout}
          onCopyRecommendedLayout={onCopyRecommendedLayout}
          onDeleteLayout={jest.fn()}
          onRenameLayout={jest.fn()}
          onExportLayout={jest.fn()}
          onOverwriteLayout={jest.fn()}
          onRevertLayout={jest.fn()}
          onCreateLayout={jest.fn()}
          onMoveLayout={jest.fn()}
          onClose={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Personal layout")).toBeDefined();
    expect(screen.getByText("Project layout")).toBeDefined();
    expect(screen.getByText("Recommended layouts")).toBeDefined();
    expect(screen.getByText("Default")).toBeDefined();
    expect(screen.getByText("H.264")).toBeDefined();
    expect(screen.getByText("Personal one")).toBeDefined();
    expect(screen.getByText("Project one")).toBeDefined();
    expect(screen.getByText("review / viewer")).toBeDefined();
    expect(screen.getByText("inspect / viewer")).toBeDefined();

    fireEvent.click(screen.getByText("review / viewer"));
    expect(onSelectRecommendedLayout).toHaveBeenCalledWith(recommendation("default"));

    const reviewRow = screen.getByText("review / viewer").closest('[role="row"]');
    if (!(reviewRow instanceof HTMLElement)) {
      throw new Error("Recommended layout row was not rendered");
    }
    fireEvent.click(within(reviewRow).getByRole("menuitem", { name: "Save a personal copy" }));
    expect(onCopyRecommendedLayout).toHaveBeenCalledWith(recommendation("default"));
  });

  it("hides the recommended entry when no matching layouts are available", () => {
    render(
      <ThemeProvider isDark>
        <CoSceneLayoutContent
          supportsProjectWrite
          layouts={{ allLayouts: [], personalFolders: [], projectFolders: [] }}
          recommendedLayouts={[]}
          onSelectLayout={jest.fn()}
          onSelectRecommendedLayout={jest.fn()}
          onCopyRecommendedLayout={jest.fn()}
          onDeleteLayout={jest.fn()}
          onRenameLayout={jest.fn()}
          onExportLayout={jest.fn()}
          onOverwriteLayout={jest.fn()}
          onRevertLayout={jest.fn()}
          onCreateLayout={jest.fn()}
          onMoveLayout={jest.fn()}
          onClose={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.queryByText("Recommended layouts")).toBeNull();
  });

  it("disambiguates same-name transports only in the combined layout view", () => {
    render(
      <ThemeProvider isDark>
        <CoSceneLayoutContent
          supportsProjectWrite
          layouts={{ allLayouts: [], personalFolders: [], projectFolders: [] }}
          recommendedLayouts={[sameNameRecommendation("default"), sameNameRecommendation("h264")]}
          onSelectLayout={jest.fn()}
          onSelectRecommendedLayout={jest.fn()}
          onCopyRecommendedLayout={jest.fn()}
          onDeleteLayout={jest.fn()}
          onRenameLayout={jest.fn()}
          onExportLayout={jest.fn()}
          onOverwriteLayout={jest.fn()}
          onRevertLayout={jest.fn()}
          onCreateLayout={jest.fn()}
          onMoveLayout={jest.fn()}
          onClose={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("review / viewer / Default")).toBeDefined();
    expect(screen.getByText("review / viewer / H.264")).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText("Layout name"), {
      target: { value: "H.264" },
    });
    expect(screen.queryByText("review / viewer / Default")).toBeNull();
    expect(screen.getByText("review / viewer / H.264")).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText("Layout name"), { target: { value: "" } });

    fireEvent.click(screen.getByText("Recommended layouts"));
    fireEvent.click(screen.getAllByText("Default")[0]!);
    expect(screen.getByText("review / viewer")).toBeDefined();
    expect(screen.queryByText("review / viewer / Default")).toBeNull();
  });
});
