/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, renderHook, screen } from "@testing-library/react";

import { WindowedList } from "./WindowedList";
import { useMomentScrollTarget } from "./useMomentScrollTarget";

it("lets new hover override a later static selection, then pauses and resumes on list interaction", () => {
  const order = new Map([
    ["early", 0],
    ["late", 1],
  ]);
  const { result, rerender } = renderHook((props) => useMomentScrollTarget({ ...props, order }), {
    initialProps: { selected: "late", hovered: new Set<string>(), disabled: false },
  });
  expect(result.current).toEqual({ key: "late" });
  rerender({ selected: "late", hovered: new Set(["early"]), disabled: false });
  expect(result.current).toEqual({ key: "early" });
  rerender({ selected: "late", hovered: new Set(["early"]), disabled: true });
  expect(result.current).toBeUndefined();
  rerender({ selected: "late", hovered: new Set(["early"]), disabled: false });
  expect(result.current).toEqual({ key: "late" });
});

it("reissues the same target for a new active state but reuses requests for unchanged content", () => {
  const order = new Map([["moment", 0]]);
  const { result, rerender } = renderHook(
    ({ hovered }) => useMomentScrollTarget({ selected: "moment", hovered, order }),
    { initialProps: { hovered: new Set<string>() } },
  );
  const selection = result.current;
  rerender({ hovered: new Set(["moment"]) });
  const hover = result.current;
  expect(hover).toEqual(selection);
  expect(hover).not.toBe(selection);
  rerender({ hovered: new Set(["moment"]) });
  expect(result.current).toBe(hover);
});

it("returns to a selected card on new hover after manual scrolling, without repeating unchanged hover", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    key: `row-${index}`,
    estimatedSize: 168,
    content: <button>row-{index}</button>,
  }));
  const order = new Map(items.map((item, index) => [item.key, index]));
  function List({ hovered }: { hovered: Set<string> }) {
    const target = useMomentScrollTarget({ selected: "row-0", hovered, order });
    return <WindowedList items={items} horizontal scrollRequest={target} />;
  }
  const { container, rerender } = render(<List hovered={new Set()} />);
  const viewport = container.firstElementChild!.firstElementChild as HTMLElement;
  Object.defineProperties(viewport, {
    clientWidth: { value: 300 },
    scrollWidth: { value: 168000 },
  });
  fireEvent.scroll(viewport, { target: { scrollLeft: 151200 } });
  expect(screen.queryByText("row-0")).toBeNull();
  rerender(<List hovered={new Set(["row-0"])} />);
  expect(viewport.scrollLeft).toBe(0);
  expect(screen.getByText("row-0")).toBeDefined();

  fireEvent.scroll(viewport, { target: { scrollLeft: 151200 } });
  rerender(<List hovered={new Set(["row-0"])} />);
  expect(viewport.scrollLeft).toBe(151200);
  expect(screen.queryByText("row-0")).toBeNull();
});

it("keeps the latest request when existing rows refresh or reorder without changing active state", () => {
  const order = new Map([
    ["early", 0],
    ["late", 1],
  ]);
  const { result, rerender } = renderHook((props) => useMomentScrollTarget(props), {
    initialProps: { selected: "late", hovered: new Set<string>(), order },
  });
  rerender({ selected: "late", hovered: new Set(["early"]), order });
  const hoverRequest = result.current;
  expect(hoverRequest).toEqual({ key: "early" });
  rerender({ selected: "late", hovered: new Set(["early"]), order: new Map(order) });
  expect(result.current).toBe(hoverRequest);
  rerender({
    selected: "late",
    hovered: new Set(["early"]),
    order: new Map([
      ["late", 0],
      ["early", 1],
    ]),
  });
  expect(result.current).toBe(hoverRequest);
});

it("locates an active row when it first appears and forgets a removed target", () => {
  const { result, rerender } = renderHook(
    ({ order }) => useMomentScrollTarget({ selected: "moment", hovered: new Set(), order }),
    { initialProps: { order: new Map<string, number>() } },
  );
  expect(result.current).toBeUndefined();
  rerender({ order: new Map([["moment", 0]]) });
  const firstRequest = result.current;
  expect(firstRequest).toEqual({ key: "moment" });
  rerender({ order: new Map() });
  expect(result.current).toBeUndefined();
  rerender({ order: new Map([["moment", 0]]) });
  expect(result.current).toEqual(firstRequest);
  expect(result.current).not.toBe(firstRequest);
});
