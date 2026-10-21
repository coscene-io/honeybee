/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import TimeBasedChartTooltipContent from "./TimeBasedChartTooltipContent";

it.each([false, true])("shows the formatted playback time for multiDataset=%s", (multiDataset) => {
  render(
    <ThemeProvider isDark>
      <TimeBasedChartTooltipContent
        content={[{ configIndex: 0, value: 42, timeLabel: "00:00:14.605" }]}
        multiDataset={multiDataset}
      />
    </ThemeProvider>,
  );
  expect(screen.getByText("00:00:14.605")).toBeTruthy();
  expect(screen.getByText("42")).toBeTruthy();
});
