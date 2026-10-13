// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";

import { createTimelineInteractionStateStore } from "./TimelineInteractionStateProvider";

it("does not publish unchanged hover hits but preserves order and content updates", () => {
  const store = createTimelineInteractionStateStore();
  const events = makeMomentFixture(2);
  const listener = jest.fn();
  store.subscribe(listener);
  store.getState().setEventsAtHoverValue(events);
  const hits = store.getState().eventsAtHoverValue;
  listener.mockClear();
  store.getState().setEventsAtHoverValue([...events]);
  expect(listener).not.toHaveBeenCalled();
  expect(store.getState().eventsAtHoverValue).toBe(hits);
  store.getState().setEventsAtHoverValue([...events].reverse());
  expect(listener).toHaveBeenCalledTimes(1);
  store.getState().setEventsAtHoverValue([{ ...events[0]! }, events[1]!]);
  expect(listener).toHaveBeenCalledTimes(2);
});

it.each([0, 1])("does not let an old row clear a newer hover on event %s", (index) => {
  const store = createTimelineInteractionStateStore();
  const events = makeMomentFixture(2);
  const first = Symbol("first row");
  const second = Symbol("second row");
  store.getState().setHoveredEvent(events[0], first);
  store.getState().setHoveredEvent(events[index], second);
  const current = store.getState();
  const listener = jest.fn();
  store.subscribe(listener);
  store.getState().setHoveredEvent(undefined, first);
  expect(store.getState()).toBe(current);
  expect(listener).not.toHaveBeenCalled();
  store.getState().setHoveredEvent(undefined, second);
  expect(store.getState().hoveredEvent).toBeUndefined();
  expect(store.getState().hoverValue).toBeUndefined();
});

it("clears a row's hover without erasing a newer hover value from another component", () => {
  const store = createTimelineInteractionStateStore();
  const source = Symbol("row");
  store.getState().setHoveredEvent(makeMomentFixture(1)[0], source);
  const hoverValue = { componentId: "plot", type: "PLAYBACK_SECONDS", value: 42 } as const;
  store.getState().setHoverValue(hoverValue);
  store.getState().setHoveredEvent(undefined, source);
  expect(store.getState().hoveredEvent).toBeUndefined();
  expect(store.getState().hoverValue).toBe(hoverValue);
});

it("preserves unscoped hover updates and unconditional clearing", () => {
  const store = createTimelineInteractionStateStore();
  const event = makeMomentFixture(1)[0];
  const source = Symbol("row");
  store.getState().setHoveredEvent(event, source);
  store.getState().setHoveredEvent(event);
  const current = store.getState();
  store.getState().setHoveredEvent(undefined, source);
  expect(store.getState()).toBe(current);
  store.getState().setHoveredEvent(undefined);
  expect(store.getState().hoveredEvent).toBeUndefined();
  expect(store.getState().hoverValue).toBeUndefined();
});
