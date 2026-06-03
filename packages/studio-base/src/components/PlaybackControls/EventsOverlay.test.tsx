/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
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
  events = [],
  eventMarks,
  setEventMarks,
}: {
  events?: TimelinePositionedEvent[];
  eventMarks: TimelinePositionedEventMark[];
  setEventMarks: jest.Mock<void, [TimelinePositionedEventMark[]]>;
}): StoreApi<EventsStore> {
  return createStore<EventsStore>((set) => ({
    eventFetchCount: 0,
    events: { loading: false, value: events },
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

function makeEvent(name: string, startSec: number, durationSec: number): TimelinePositionedEvent {
  const startTime = { sec: startSec, nsec: 0 };
  const endTime = { sec: startSec + durationSec, nsec: 0 };

  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, { seconds: BigInt(startSec), nanos: 0 }),
      duration: create(DurationSchema, { seconds: BigInt(durationSec), nanos: 0 }),
    }),
    startTime,
    endTime,
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + durationSec) / 10,
    secondsSinceStart: startSec,
  };
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
  consoleApi = {} as React.ContextType<typeof CoSceneConsoleApiContext>,
  eventsStore,
  timelineInteractionStore,
}: React.PropsWithChildren<{
  consoleApi?: React.ContextType<typeof CoSceneConsoleApiContext>;
  eventsStore: StoreApi<EventsStore>;
  timelineInteractionStore: StoreApi<TimelineInteractionStateStore>;
}>): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider value={consoleApi}>
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

function mockTimelineRect(): void {
  const overlay = screen.getByTestId("events-overlay");
  jest.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    bottom: 28,
    height: 28,
    left: 0,
    right: 1000,
    top: 0,
    width: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function getEventRanges(
  eventsStore: StoreApi<EventsStore>,
): { endSec: number; startSec: number }[] {
  return (eventsStore.getState().events.value ?? []).map((event) => ({
    endSec: event.secondsSinceStart + event.endTime.sec - event.startTime.sec,
    startSec: event.secondsSinceStart,
  }));
}

function makePointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pageX: { value: clientX },
    screenX: { value: clientX },
  });
  return event;
}

async function dragRollingEditBoundary(targetClientX: number): Promise<void> {
  mockTimelineRect();
  const handle = screen.getByTestId("timeline-rolling-edit-handle");

  await act(async () => {
    fireEvent(handle, makePointerEvent("pointerdown", 500));
  });
  await act(async () => {
    window.dispatchEvent(makePointerEvent("pointermove", targetClientX));
  });
  await act(async () => {
    window.dispatchEvent(makePointerEvent("pointerup", targetClientX));
  });
}

describe("<EventsOverlay />", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the shortcut hint when the timeline has no moments", async () => {
    const originalLanguage = i18n.language;
    await act(async () => {
      await i18n.changeLanguage("zh");
    });

    try {
      const eventsStore = makeEventsStore({
        eventMarks: [],
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

      expect(screen.getByTestId("timeline-empty-event-hint").textContent).toBe(
        "使用快捷键 Alt+1 创建一刻，为数据打标注",
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage(originalLanguage || "en");
      });
    }
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

  it("optimistically updates adjacent moments while a rolling edit request is pending", async () => {
    const updateEvent = jest.fn(async () => {
      await new Promise<void>(() => {});
    });
    const first = makeEvent("events/first", 0, 5);
    const second = makeEvent("events/second", 5, 5);
    const eventsStore = makeEventsStore({
      events: [first, second],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        consoleApi={{ updateEvent } as React.ContextType<typeof CoSceneConsoleApiContext>}
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
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

    await dragRollingEditBoundary(600);

    expect(updateEvent).toHaveBeenCalledTimes(2);
    expect(getEventRanges(eventsStore)).toEqual([
      { startSec: 0, endSec: 6 },
      { startSec: 6, endSec: 10 },
    ]);
  });

  it("rolls back adjacent moments when a rolling edit request fails", async () => {
    const updateEvent = jest.fn().mockRejectedValue(new Error("update failed"));
    const first = makeEvent("events/first", 0, 5);
    const second = makeEvent("events/second", 5, 5);
    const eventsStore = makeEventsStore({
      events: [first, second],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        consoleApi={{ updateEvent } as React.ContextType<typeof CoSceneConsoleApiContext>}
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
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

    await dragRollingEditBoundary(600);

    expect(updateEvent).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(getEventRanges(eventsStore)).toEqual([
        { startSec: 0, endSec: 5 },
        { startSec: 5, endSec: 10 },
      ]);
    });
    expect(console.error).toHaveBeenCalledWith(new Error("update failed"));
    (console.error as jest.Mock).mockClear();
  });
});
