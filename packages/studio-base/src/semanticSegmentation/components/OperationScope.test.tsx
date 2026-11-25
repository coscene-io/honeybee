/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { act, screen } from "@testing-library/react";
import i18n from "i18next";

import { OperationScope } from "./OperationScope";
import { render, useSegmentationTestHost } from "../testing/host";

useSegmentationTestHost();

const operation = {
  id: "op",
  labelKey: "opLabelCreateClass" as const,
  patch: { classes: { c: { id: "c", name: "Cup", color: "#fff" } } },
};

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

it("shows the operation type in the active language", async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  render(<OperationScope operation={operation} />);
  expect(screen.getByText("Type: Create class")).toBeTruthy();
});

it("shows the operation type in Chinese, not the English label", async () => {
  await act(async () => {
    await i18n.changeLanguage("zh");
  });
  render(<OperationScope operation={operation} />);
  expect(screen.getByText("类型：新建类别")).toBeTruthy();
  expect(screen.queryByText(/Create class/)).toBeNull();
});
