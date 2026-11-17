/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, within } from "@testing-library/react";

import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import Table from "./Table";

it("sorts the displayed rows and keeps manual pagination working", () => {
  const values = Array.from({ length: 12 }, (_, i) => ({ rank: 12 - i }));
  const { container } = render(
    <ThemeProvider isDark>
      <Table value={values} accessorPath="" />
    </ThemeProvider>,
  );
  const rows = () => Array.from(container.querySelectorAll("tbody > tr"));
  expect(rows()).toHaveLength(10);
  fireEvent.click(screen.getByTestId("column-header-rank"));
  fireEvent.click(screen.getByTestId("column-header-rank"));
  expect(within(rows()[0]! as HTMLElement).getByText("3")).toBeDefined();
  const nextPage = screen.getByTestId("KeyboardArrowRightIcon").closest("button")!;
  fireEvent.click(nextPage);
  expect(rows()).toHaveLength(2);
  expect(screen.getByText("2 of 2")).toBeDefined();
  expect(nextPage.disabled).toBe(true);
  const previousPage = screen.getByTestId("KeyboardArrowLeftIcon").closest("button")!;
  fireEvent.click(previousPage);
  expect(rows()).toHaveLength(10);
});

it("expands nested message objects without losing typed-array values", () => {
  render(
    <ThemeProvider isDark>
      <Table value={[{ nested: { count: 42 }, samples: new Uint8Array([1, 2]) }]} accessorPath="" />
    </ThemeProvider>,
  );
  expect(screen.queryByText("42")).toBe(ReactNull);
  fireEvent.click(screen.getByTestId("expand-row-0"));
  expect(screen.getByText("42")).toBeDefined();
  expect(screen.getByText("1")).toBeDefined();
  expect(screen.getByText("2")).toBeDefined();
});

it.each([Float32Array, Float64Array])("preserves non-finite values in %p cells", (ArrayType) => {
  render(
    <ThemeProvider isDark>
      <Table
        value={[{ samples: new ArrayType([NaN, Infinity, -Infinity, 1.25]) }]}
        accessorPath=""
      />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByTestId("expand-row-0"));
  for (const value of ["NaN", "Infinity", "-Infinity", "1.25"]) {
    expect(screen.getByText(value, { exact: true })).toBeDefined();
  }
  expect(screen.queryByText("null", { exact: true })).toBe(ReactNull);
});
