/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { CoSceneLayoutDrawer } from "./CoSceneLayoutDrawer";

jest.mock("@mui/material", () => {
  const actual = jest.requireActual("@mui/material");
  return {
    ...actual,
    Drawer: (props: { ModalProps?: { disableRestoreFocus?: boolean } }) => (
      <div
        data-testid="layout-drawer"
        data-disable-restore-focus={String(props.ModalProps?.disableRestoreFocus === true)}
      />
    ),
  };
});

describe("<CoSceneLayoutDrawer />", () => {
  it("does not restore focus to the opener when the drawer closes", () => {
    render(
      <ThemeProvider isDark>
        <CoSceneLayoutDrawer
          open
          supportsProjectWrite={false}
          recommendedLayouts={[]}
          onClose={jest.fn()}
          onSelectLayout={jest.fn()}
          onDeleteLayout={jest.fn()}
          onRenameLayout={jest.fn()}
          onMoveLayout={jest.fn()}
          onExportLayout={jest.fn()}
          onOverwriteLayout={jest.fn()}
          onRevertLayout={jest.fn()}
          onCreateLayout={jest.fn()}
          onSelectRecommendedLayout={jest.fn()}
          onCopyRecommendedLayout={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("layout-drawer").getAttribute("data-disable-restore-focus")).toBe(
      "true",
    );
  });
});
