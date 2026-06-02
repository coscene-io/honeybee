/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen, waitFor } from "@testing-library/react";
import * as _ from "lodash-es";
import type { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  EventsContext,
  type EventsStore,
  type TimelinePositionedEvent,
  type TimelinePositionedEventMark,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateContext,
  type SyncBounds,
  type TimelineInteractionStateStore,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import type { HoverValue } from "@foxglove/studio-base/types/hoverValue";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { EventsOverlay } from "./EventsOverlay";
import { makeTimelineViewport } from "./timelineViewport";

jest.mock("@foxglove/studio-base/components/Events/CreateEventContainer/index", () => ({
  CreateEventContainer: () => <div data-testid="create-event-container" />,
}));

jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: 1000, ref: jest.fn() }),
}));

const viewport = makeTimelineViewport(0, 10);

function makeEventsStore({
  eventMarks,
  setEventMarks,
}: {
  eventMarks: TimelinePositionedEventMark[];
  setEventMarks: jest.Mock<void, [TimelinePositionedEventMark[]]>;
}): StoreApi<EventsStore> {
  return createStore<EventsStore>((set) => ({
    eventFetchCount: 0,
    events: { loading: false, value: [] },
    filter: "",
    selectedEventId: undefined,
    deviceId: undefined,
    eventMarks,
    toModifyEvent: undefined,
    customFieldSchema: undefined,

    refreshEvents: () => {
      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },
    selectEvent: (id: undefined | string) => {
      set({ selectedEventId: id });
    },
    setEvents: (events: AsyncState<TimelinePositionedEvent[]>) => {
      set({ events, selectedEventId: undefined });
    },
    setFilter: (filter: string) => {
      set({ filter });
    },
    setDeviceId: (deviceId: string | undefined) => {
      set({ deviceId });
    },
    setEventMarks: (marks: TimelinePositionedEventMark[]) => {
      setEventMarks(marks);
      set({ eventMarks: marks });
    },
    setToModifyEvent: (toModifyEvent) => {
      set({ toModifyEvent });
    },
    setCustomFieldSchema: (customFieldSchema) => {
      set({ customFieldSchema });
    },
  }));
}

function makeTimelineInteractionStore(
  hoverValue: HoverValue = {
    componentId: "test-component",
    type: "PLAYBACK_SECONDS",
    value: 1,
  },
): StoreApi<TimelineInteractionStateStore> {
  return createStore<TimelineInteractionStateStore>((set) => ({
    eventsAtHoverValue: {},
    bagsAtHoverValue: {},
    globalBounds: undefined,
    hoveredEvent: undefined,
    hoveredBag: undefined,
    hoverValue,
    loopedEvent: undefined,

    clearHoverValue: (componentId: string) => {
      set((store) => ({
        hoverValue: store.hoverValue?.componentId === componentId ? undefined : store.hoverValue,
      }));
    },
    setEventsAtHoverValue: (eventsAtHoverValue: TimelinePositionedEvent[]) => {
      set({ eventsAtHoverValue: _.keyBy(eventsAtHoverValue, (event) => event.event.name) });
    },
    setBagsAtHoverValue: () => {
      set({ bagsAtHoverValue: {} });
    },
    setGlobalBounds: (
      newBounds:
        | undefined
        | SyncBounds
        | ((oldValue: undefined | SyncBounds) => undefined | SyncBounds),
    ) => {
      set((store) => ({
        globalBounds: typeof newBounds === "function" ? newBounds(store.globalBounds) : newBounds,
      }));
    },
    setHoveredEvent: (hoveredEvent: undefined | TimelinePositionedEvent) => {
      set({ hoveredEvent });
    },
    setHoveredBag: () => {
      set({ hoveredBag: undefined });
    },
    setHoverValue: (hoverValue: HoverValue) => {
      set({ hoverValue });
    },
    setLoopedEvent: (loopedEvent: undefined | TimelinePositionedEvent) => {
      set({ loopedEvent });
    },
  }));
}

function Wrapper({
  children,
  eventsStore,
  timelineInteractionStore,
}: React.PropsWithChildren<{
  eventsStore: StoreApi<EventsStore>;
  timelineInteractionStore: StoreApi<TimelineInteractionStateStore>;
}>): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider value={{} as never}>
          <MockMessagePipelineProvider
            startTime={{ sec: 0, nsec: 0 }}
            endTime={{ sec: 10, nsec: 0 }}
            currentTime={{ sec: 1, nsec: 0 }}
          >
            <TimelineInteractionStateContext.Provider value={timelineInteractionStore}>
              <EventsContext.Provider value={eventsStore}>{children}</EventsContext.Provider>
            </TimelineInteractionStateContext.Provider>
          </MockMessagePipelineProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>
  );
}

describe("<EventsOverlay />", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("hides the single create mark tooltip after three seconds", async () => {
    jest.useFakeTimers();

    const eventsStore = makeEventsStore({
      eventMarks: [{ key: "start", position: 0.1, time: { sec: 1, nsec: 0 } }],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={timelineInteractionStore}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging={false}
          eventContextMenuRequest={undefined}
          onEventContextMenuHandled={jest.fn()}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    expect(await screen.findByText("Start Point")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(screen.getByText("Start Point")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(screen.queryByText("Start Point")).toBeNull();
    });
  });

  it("keeps the create moment form open after the mark tooltip timeout", async () => {
    jest.useFakeTimers();

    const eventsStore = makeEventsStore({
      eventMarks: [
        { key: "start", position: 0.1, time: { sec: 1, nsec: 0 } },
        { key: "end", position: 0.5, time: { sec: 5, nsec: 0 } },
      ],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={timelineInteractionStore}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging={false}
          eventContextMenuRequest={undefined}
          onEventContextMenuHandled={jest.fn()}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    expect(await screen.findByTestId("create-event-container")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    expect(screen.getByTestId("create-event-container")).toBeTruthy();
  });

  it("does not rewrite event marks when a dragged create mark stays at the same position", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      eventMarks: [
        { key: "start", position: 0.1, time: { sec: 1, nsec: 0 } },
        { key: "end", position: 0.5, time: { sec: 5, nsec: 0 } },
      ],
      setEventMarks,
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={timelineInteractionStore}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging
          eventContextMenuRequest={undefined}
          onEventContextMenuHandled={jest.fn()}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(setEventMarks).not.toHaveBeenCalled();
    });
  });

  it("updates the dragged create mark when the hover position changes", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      eventMarks: [
        { key: "start", position: 0.1, time: { sec: 1, nsec: 0 } },
        { key: "end", position: 0.5, time: { sec: 5, nsec: 0 } },
      ],
      setEventMarks,
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={timelineInteractionStore}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging
          eventContextMenuRequest={undefined}
          onEventContextMenuHandled={jest.fn()}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    expect(setEventMarks).not.toHaveBeenCalled();

    act(() => {
      timelineInteractionStore.getState().setHoverValue({
        componentId: "test-component",
        type: "PLAYBACK_SECONDS",
        value: 2,
      });
    });

    await waitFor(() => {
      expect(setEventMarks).toHaveBeenCalledTimes(1);
    });
    expect(setEventMarks).toHaveBeenCalledWith([
      { key: "start", position: 0.2, time: { sec: 2, nsec: 0 } },
      { key: "end", position: 0.5, time: { sec: 5, nsec: 0 } },
    ]);
  });
});
