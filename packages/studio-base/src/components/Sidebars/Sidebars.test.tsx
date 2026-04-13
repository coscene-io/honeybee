/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { SidebarItem } from "./Sidebar";
import { Sidebars } from "./Sidebars";

type LeftKey = "panel-settings" | "topics" | "tasks";
type RightKey = "record-info" | "variables" | "extensions";

const LEFT_ITEMS_WITHOUT_TASKS = new Map<LeftKey, SidebarItem>([
  ["panel-settings", { title: "Panel", component: () => <>Left Panel Settings</> }],
  ["topics", { title: "Topics", component: () => <>Left Topics</> }],
]);

const LEFT_ITEMS_WITH_TASKS = new Map<LeftKey, SidebarItem>([
  ["panel-settings", { title: "Panel", component: () => <>Left Panel Settings</> }],
  ["topics", { title: "Topics", component: () => <>Left Topics</> }],
  ["tasks", { title: "Tasks", component: () => <>Left Tasks</> }],
]);

const RIGHT_ITEMS_WITHOUT_RECORD_INFO = new Map<RightKey, SidebarItem>([
  ["variables", { title: "Variables", component: () => <>Right Variables</> }],
  ["extensions", { title: "Extensions", component: () => <>Right Extensions</> }],
]);

const RIGHT_ITEMS_WITH_RECORD_INFO = new Map<RightKey, SidebarItem>([
  ["record-info", { title: "Record Info", component: () => <>Right Record Info</> }],
  ["variables", { title: "Variables", component: () => <>Right Variables</> }],
  ["extensions", { title: "Extensions", component: () => <>Right Extensions</> }],
]);

function TestHarness({
  initialLeftKey,
  initialRightKey,
  leftItems,
  rightItems,
}: {
  initialLeftKey?: LeftKey;
  initialRightKey?: RightKey;
  leftItems: Map<LeftKey, SidebarItem>;
  rightItems: Map<RightKey, SidebarItem>;
}): React.JSX.Element {
  const [selectedLeftKey, setSelectedLeftKey] = useState<LeftKey | undefined>(initialLeftKey);
  const [selectedRightKey, setSelectedRightKey] = useState<RightKey | undefined>(initialRightKey);
  const [leftSidebarSize, setLeftSidebarSize] = useState<number | undefined>();
  const [rightSidebarSize, setRightSidebarSize] = useState<number | undefined>();

  return (
    <ThemeProvider isDark>
      <DndProvider backend={HTML5Backend}>
        <div style={{ height: 600, width: 800 }}>
          <Sidebars
            leftItems={leftItems}
            selectedLeftKey={selectedLeftKey}
            onSelectLeftKey={setSelectedLeftKey}
            leftSidebarSize={leftSidebarSize}
            setLeftSidebarSize={setLeftSidebarSize}
            rightItems={rightItems}
            selectedRightKey={selectedRightKey}
            onSelectRightKey={setSelectedRightKey}
            rightSidebarSize={rightSidebarSize}
            setRightSidebarSize={setRightSidebarSize}
          >
            <div>Main content</div>
          </Sidebars>
        </div>
      </DndProvider>
    </ThemeProvider>
  );
}

describe("<Sidebars />", () => {
  it("restores the preferred right sidebar item once it becomes available", () => {
    const { rerender } = render(
      <TestHarness
        initialRightKey="record-info"
        leftItems={LEFT_ITEMS_WITH_TASKS}
        rightItems={RIGHT_ITEMS_WITHOUT_RECORD_INFO}
      />,
    );

    expect(screen.getByText("Right Variables")).toBeTruthy();

    rerender(
      <TestHarness
        initialRightKey="record-info"
        leftItems={LEFT_ITEMS_WITH_TASKS}
        rightItems={RIGHT_ITEMS_WITH_RECORD_INFO}
      />,
    );

    expect(screen.getByText("Right Record Info")).toBeTruthy();
  });

  it("does not switch away from a manual fallback selection when the original right item appears", () => {
    const { rerender } = render(
      <TestHarness
        initialRightKey="record-info"
        leftItems={LEFT_ITEMS_WITH_TASKS}
        rightItems={RIGHT_ITEMS_WITHOUT_RECORD_INFO}
      />,
    );

    fireEvent.click(screen.getByTestId("extensions-right"));
    expect(screen.getByText("Right Extensions")).toBeTruthy();

    rerender(
      <TestHarness
        initialRightKey="record-info"
        leftItems={LEFT_ITEMS_WITH_TASKS}
        rightItems={RIGHT_ITEMS_WITH_RECORD_INFO}
      />,
    );

    expect(screen.getByText("Right Extensions")).toBeTruthy();
  });

  it("restores the preferred left sidebar item once it becomes available", () => {
    const { rerender } = render(
      <TestHarness
        initialLeftKey="tasks"
        leftItems={LEFT_ITEMS_WITHOUT_TASKS}
        rightItems={RIGHT_ITEMS_WITH_RECORD_INFO}
      />,
    );

    expect(screen.getByText("Left Panel Settings")).toBeTruthy();

    rerender(
      <TestHarness
        initialLeftKey="tasks"
        leftItems={LEFT_ITEMS_WITH_TASKS}
        rightItems={RIGHT_ITEMS_WITH_RECORD_INFO}
      />,
    );

    expect(screen.getByText("Left Tasks")).toBeTruthy();
  });
});
