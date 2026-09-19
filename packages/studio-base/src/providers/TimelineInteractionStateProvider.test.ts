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
