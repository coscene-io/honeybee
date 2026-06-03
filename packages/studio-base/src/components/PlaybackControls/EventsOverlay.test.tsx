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

import { add, fromSec } from "@foxglove/rostime";
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

function defer<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return { promise, reject, resolve };
}

function makeEvent(name: string, startSec: number, durationSec: number): TimelinePositionedEvent {
  const startTime = fromSec(startSec);
  const duration = fromSec(durationSec);
  const endTime = add(startTime, duration);

  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, {
        seconds: BigInt(startTime.sec),
        nanos: startTime.nsec,
      }),
      duration: create(DurationSchema, {
        seconds: BigInt(duration.sec),
        nanos: duration.nsec,
      }),
    }),
    startTime,
    endTime,
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + durationSec) / 10,
    secondsSinceStart: startSec,
  };
}

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

function mockTimelineRect(element: Element = screen.getByTestId("events-overlay")): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
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

function firePointerDown(element: Element | Window, clientX: number): void {
  fireEvent(element, new MouseEvent("pointerdown", { bubbles: true, clientX }));
}

function firePointerMove(clientX: number): void {
  fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX }));
}

function firePointerUp(clientX: number): void {
  fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX }));
}

async function dragRollingEditBoundary(targetClientX: number): Promise<void> {
  mockTimelineRect();
  const handle = screen.getByTestId("timeline-rolling-edit-handle");

  await act(async () => {
    firePointerDown(handle, 500);
  });
  await act(async () => {
    firePointerMove(targetClientX);
  });
  await act(async () => {
    firePointerUp(targetClientX);
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

  it("waits for every rolling edit update before refreshing after a partial failure", async () => {
    const failedUpdate = defer<unknown>();
    const pendingUpdate = defer<unknown>();
    const failure = new Error("first failed");
    const updateEvent = jest
      .fn()
      .mockImplementationOnce(async () => await failedUpdate.promise)
      .mockImplementationOnce(async () => await pendingUpdate.promise);
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

    await act(async () => {
      failedUpdate.reject(failure);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console.error).not.toHaveBeenCalledWith(failure);
    expect(eventsStore.getState().eventFetchCount).toBe(0);
    expect(getEventRanges(eventsStore)).toEqual([
      { startSec: 0, endSec: 6 },
      { startSec: 6, endSec: 10 },
    ]);

    await act(async () => {
      pendingUpdate.resolve({});
      await pendingUpdate.promise;
    });

    await waitFor(() => {
      expect(eventsStore.getState().eventFetchCount).toBe(1);
    });
    expect(console.error).toHaveBeenCalledWith(failure);
    (console.error as jest.Mock).mockClear();
    expect(getEventRanges(eventsStore)).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 5, endSec: 10 },
    ]);
  });

  it("keeps moment loop playback when a timeline moment press stays under the drag threshold", () => {
    const event = makeEvent("events/looped", 1, 2);
    const eventsStore = makeEventsStore({
      events: [event],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();
    timelineInteractionStore.getState().setLoopedEvent(event);

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
    mockTimelineRect(screen.getByTestId("events-overlay"));

    firePointerDown(screen.getByTestId("timeline-event"), 100);
    firePointerMove(103);

    expect(timelineInteractionStore.getState().loopedEvent?.event.name).toBe("events/looped");

    firePointerUp(103);
  });

  it("clears moment loop playback when dragging a timeline moment body past the threshold", () => {
    const updateEvent = jest.fn();
    const event = makeEvent("events/looped", 1, 2);
    const eventsStore = makeEventsStore({
      events: [event],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();
    timelineInteractionStore.getState().setLoopedEvent(event);

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
    mockTimelineRect(screen.getByTestId("events-overlay"));

    firePointerDown(screen.getByTestId("timeline-event"), 100);
    firePointerMove(106);

    expect(timelineInteractionStore.getState().loopedEvent).toBeUndefined();

    firePointerUp(106);
  });

  it.each(["timeline-event-start-handle", "timeline-event-end-handle"])(
    "clears moment loop playback when dragging the %s past the threshold",
    (handleTestId) => {
      const updateEvent = jest.fn();
      const event = makeEvent("events/looped", 1, 2);
      const eventsStore = makeEventsStore({
        events: [event],
        eventMarks: [],
        setEventMarks: jest.fn(),
      });
      const timelineInteractionStore = makeTimelineInteractionStore();
      timelineInteractionStore.getState().setLoopedEvent(event);

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
      mockTimelineRect(screen.getByTestId("events-overlay"));

      firePointerDown(screen.getByTestId(handleTestId), 100);
      firePointerMove(106);

      expect(timelineInteractionStore.getState().loopedEvent).toBeUndefined();

      firePointerUp(106);
    },
  );
});
