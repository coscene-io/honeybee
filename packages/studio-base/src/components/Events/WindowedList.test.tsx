/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { WindowedList } from "./WindowedList";

function StatefulRow({ name }: { name: string }): React.JSX.Element {
  const [value, setValue] = useState(0);
  return (
    <button
      onClick={() => {
        setValue(value + 1);
      }}
    >
      {name}:{value}
    </button>
  );
}

it("windows rows, locates unmounted IDs and retains the active row's state", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} />);
  expect(screen.getAllByRole("button").length).toBeLessThan(15);
  fireEvent.pointerDown(screen.getByText("row-0:0"));
  fireEvent.click(screen.getByText("row-0:0"));
  rerender(<WindowedList items={items} scrollToKey="row-900" />);
  expect(screen.getByText("row-900:0")).toBeDefined();
  expect(screen.getByText("row-0:1")).toBeDefined();
  expect(screen.getAllByRole("button").length).toBeLessThan(16);
  rerender(<WindowedList items={items} scrollToKey="row-0" />);
  expect(screen.getByText("row-0:1")).toBeDefined();
});

it("windows horizontal cards and removes stale pinned rows when the data changes", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 168,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} horizontal />);
  expect(screen.getAllByRole("button").length).toBeLessThan(10);
  fireEvent.pointerDown(screen.getByText("row-0:0"));
  rerender(<WindowedList items={items.slice(500)} horizontal scrollToKey="row-999" />);
  expect(screen.queryByText("row-0:0")).toBeNull();
  expect(screen.getByText("row-999:0")).toBeDefined();
});

it("preserves the visible item when estimates change with the display mode", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 100,
    content: <StatefulRow name={`row-${index}`} />,
  }));
  const { rerender } = render(<WindowedList items={items} scrollToKey="row-800" />);
  rerender(<WindowedList items={items} />);
  const visibleBefore = screen.getAllByRole("button").map((button) => button.textContent);
  const compact = items.map((item) => ({ ...item, estimatedSize: 50 }));
  rerender(<WindowedList items={compact} resetKey="compact" />);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(
    expect.arrayContaining(visibleBefore),
  );
});
