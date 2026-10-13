/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";

import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import { TimelineInteractionStateContext } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { createTimelineInteractionStateStore } from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";

import { useMomentHover } from "./useMomentHover";

function Row({ event, name }: { event: TimelinePositionedEvent; name: string }) {
  const { onHoverStart, onHoverEnd } = useMomentHover();
  return (
    <button
      onMouseEnter={() => {
        onHoverStart(event);
      }}
      onMouseLeave={onHoverEnd}
    >
      {name}
    </button>
  );
}

it.each([false, true])(
  "does not clear another view of the same event when a row unmounts (previously hovered: %s)",
  (hoverFirst) => {
    const store = createTimelineInteractionStateStore();
    const event = makeMomentFixture(1)[0]!;
    const content = ({ first }: { first: boolean }) => (
      <StrictMode>
        <TimelineInteractionStateContext.Provider value={store}>
          {first && <Row event={event} name="first" />}
          <Row event={event} name="second" />
        </TimelineInteractionStateContext.Provider>
      </StrictMode>
    );
    const { rerender, unmount } = render(content({ first: true }));
    if (hoverFirst) {
      fireEvent.mouseEnter(screen.getByText("first"));
    }
    fireEvent.mouseEnter(screen.getByText("second"));
    const hovered = store.getState();
    rerender(content({ first: false }));
    expect(store.getState()).toBe(hovered);
    unmount();
    expect(store.getState().hoveredEvent).toBeUndefined();
    expect(store.getState().hoverValue).toBeUndefined();
  },
);

it("releases the hover on mouseleave and ignores later unmount cleanup", () => {
  const store = createTimelineInteractionStateStore();
  const event = makeMomentFixture(1)[0]!;
  const { unmount } = render(
    <TimelineInteractionStateContext.Provider value={store}>
      <Row event={event} name="row" />
    </TimelineInteractionStateContext.Provider>,
  );
  fireEvent.mouseEnter(screen.getByText("row"));
  fireEvent.mouseLeave(screen.getByText("row"));
  expect(store.getState().hoveredEvent).toBeUndefined();
  expect(store.getState().hoverValue).toBeUndefined();
  store.getState().setHoveredEvent(event);
  const hovered = store.getState();
  unmount();
  expect(store.getState()).toBe(hovered);
});
