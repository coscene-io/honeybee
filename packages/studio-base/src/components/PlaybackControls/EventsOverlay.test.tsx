/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import * as _ from "lodash-es";
import { useEffect } from "react";
import type { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";

import { add, fromSec, type Time } from "@foxglove/rostime";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { type CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useDialogs } from "@foxglove/studio-base/context/DialogsContext";
import {
  EventsContext,
  useEvents,
  type EventsStore,
  type TimelinePositionedEvent,
  type TimelinePositionedEventMark,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateContext,
  type SyncBounds,
  type TimelineInteractionStateStore,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import PlaybackInteractionStateProvider from "@foxglove/studio-base/providers/PlaybackInteractionStateProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import type { HoverValue } from "@foxglove/studio-base/types/hoverValue";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { EventsOverlay } from "./EventsOverlay";
import Scrubber from "./Scrubber";
import { getMomentTracks, layoutMomentTracks } from "./momentTracks";
import { makeTimelineViewport } from "./timelineViewport";

jest.mock("@foxglove/studio-base/components/Events/CreateEventContainer/index", () => ({
  CreateEventContainer: () => <div data-testid="create-event-container" />,
}));

jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: 1000, ref: jest.fn() }),
}));

const viewport = makeTimelineViewport(0, 10);

type ConsoleApi = NonNullable<React.ContextType<typeof CoSceneConsoleApiContext>>;

function makeConsoleApiMock(
  overrides: Partial<Record<keyof ConsoleApi, unknown>> = {},
): ConsoleApi {
  return overrides as unknown as ConsoleApi;
}

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
    eventToFocus: undefined,
    setEventToFocus: (eventToFocus) => {
      set({ eventToFocus });
    },

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

function TestDialogs(): React.JSX.Element {
  const dialogs = useDialogs((store) => store.dialogs);
  return (
    <>
      {Array.from(dialogs.entries()).map(([key, dialog]) => (
        <div key={key}>{dialog}</div>
      ))}
    </>
  );
}

function Wrapper({
  children,
  consoleApi = makeConsoleApiMock(),
  eventsStore,
  seekPlayback,
  currentTime = { sec: 1, nsec: 0 },
  timelineInteractionStore,
}: React.PropsWithChildren<{
  consoleApi?: React.ContextType<typeof CoSceneConsoleApiContext>;
  eventsStore: StoreApi<EventsStore>;
  seekPlayback?: (arg0: Time) => void;
  currentTime?: Time;
  timelineInteractionStore: StoreApi<TimelineInteractionStateStore>;
}>): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <WorkspaceContextProvider disablePersistence>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <CoSceneConsoleApiContext.Provider value={consoleApi}>
            <DialogsProvider>
              <TestDialogs />
              <MockMessagePipelineProvider
                startTime={{ sec: 0, nsec: 0 }}
                endTime={{ sec: 10, nsec: 0 }}
                currentTime={currentTime}
                seekPlayback={seekPlayback}
              >
                <TimelineInteractionStateContext.Provider value={timelineInteractionStore}>
                  <EventsContext.Provider value={eventsStore}>{children}</EventsContext.Provider>
                </TimelineInteractionStateContext.Provider>
              </MockMessagePipelineProvider>
            </DialogsProvider>
          </CoSceneConsoleApiContext.Provider>
        </AppConfigurationContext.Provider>
      </WorkspaceContextProvider>
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

let animationFrameId = 0;
const animationFrames = new Map<number, FrameRequestCallback>();
function flushAnimationFrame(): void {
  act(() => {
    const callbacks = Array.from(animationFrames.values());
    animationFrames.clear();
    callbacks.forEach((callback) => {
      callback(performance.now());
    });
  });
}

function firePointerMove(clientX: number): void {
  fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX }));
  flushAnimationFrame();
}

function firePointerUp(clientX: number): void {
  fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX }));
}

function renderOverlayWithSeek({
  consoleApi = makeConsoleApiMock({ updateEvent: jest.fn().mockResolvedValue({}) }),
  events,
  seekPlayback = jest.fn<void, [Time]>(),
  setCursor = jest.fn(),
}: {
  consoleApi?: React.ContextType<typeof CoSceneConsoleApiContext>;
  events: TimelinePositionedEvent[];
  seekPlayback?: jest.Mock<void, [Time]>;
  setCursor?: jest.Mock<void, [string]>;
}): { eventsStore: StoreApi<EventsStore>; seekPlayback: jest.Mock<void, [Time]> } {
  const eventsStore = makeEventsStore({
    events,
    eventMarks: [],
    setEventMarks: jest.fn(),
  });
  const timelineInteractionStore = makeTimelineInteractionStore();

  render(
    <Wrapper
      consoleApi={consoleApi}
      eventsStore={eventsStore}
      seekPlayback={seekPlayback}
      timelineInteractionStore={timelineInteractionStore}
    >
      <EventsOverlay
        componentId="test-component"
        canWriteEvents
        isDragging={false}
        eventContextMenuRequest={undefined}
        onEventContextMenuHandled={jest.fn()}
        onSeek={(playbackSeconds) => {
          seekPlayback(fromSec(playbackSeconds));
        }}
        setCursor={setCursor}
        viewport={viewport}
      />
    </Wrapper>,
  );

  return { eventsStore, seekPlayback };
}

function SeedCreateEventPopper(): ReactNull {
  const setDataSource = useCoreData((store: CoreDataStore) => store.setDataSource);
  const setProject = useCoreData((store: CoreDataStore) => store.setProject);
  const setRecord = useCoreData((store: CoreDataStore) => store.setRecord);
  const setEventMarks = useEvents((store: EventsStore) => store.setEventMarks);

  useEffect(() => {
    setDataSource({ id: "coscene-data-platform", type: "connection" });
    setProject({ loading: false, value: { isArchived: false } as never });
    setRecord({ loading: false, value: { isArchived: false } as never });
    setEventMarks([
      { key: "start", position: 0.1, time: { sec: 1, nsec: 0 } },
      { key: "end", position: 0.3, time: { sec: 3, nsec: 0 } },
    ]);
  }, [setDataSource, setEventMarks, setProject, setRecord]);

  return ReactNull;
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
  beforeEach(() => {
    animationFrames.clear();
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.set(++animationFrameId, callback);
      return animationFrameId;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      animationFrames.delete(id);
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the default cursor away from event resize hotspots", () => {
    const setCursor = jest.fn<void, [string]>();

    renderOverlayWithSeek({ events: [], setCursor });

    expect(setCursor).toHaveBeenLastCalledWith("default");
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
        "使用快捷键 Alt + 1 创建一刻，为数据打标注",
      );
      expect(screen.getByTestId("timeline-empty-event-create-icon")).toBeTruthy();
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

  it("keeps the create event popper above the timeline hover tooltip", async () => {
    render(
      <ThemeProvider isDark>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <CoSceneConsoleApiContext.Provider
            value={makeConsoleApiMock({
              deleteEvent: { permission: () => false },
              createEvent: { permission: () => false },
              updateEvent: { permission: () => true },
            })}
          >
            <CoreDataProvider>
              <WorkspaceContextProvider disablePersistence>
                <MockMessagePipelineProvider
                  startTime={{ sec: 0, nsec: 0 }}
                  endTime={{ sec: 10, nsec: 0 }}
                  currentTime={{ sec: 1, nsec: 0 }}
                >
                  <PlaybackInteractionStateProvider>
                    <TimelineInteractionStateProvider>
                      <CoScenePlaylistProvider>
                        <EventsProvider>
                          <SeedCreateEventPopper />
                          <div data-testid="scrubber-shell" style={{ height: 32, width: 1000 }}>
                            <Scrubber onSeek={jest.fn()} />
                          </div>
                        </EventsProvider>
                      </CoScenePlaylistProvider>
                    </TimelineInteractionStateProvider>
                  </PlaybackInteractionStateProvider>
                </MockMessagePipelineProvider>
              </WorkspaceContextProvider>
            </CoreDataProvider>
          </CoSceneConsoleApiContext.Provider>
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );

    const createEventContainer = await screen.findByTestId("create-event-container");
    const slider = screen.getByTestId("scrubber-slider");
    slider.getBoundingClientRect = () => ({
      bottom: 32,
      height: 32,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(slider, new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 20 }));
    flushAnimationFrame();

    const tooltip = await screen.findByTestId("timeline-hover-tooltip");
    const popper = createEventContainer.closest("#event-mark-popper");
    expect(popper).not.toBeNull();
    expect(popper!.parentElement).toBe(document.body);
    expect(tooltip.parentElement).toBe(document.body);
    expect(Number(getComputedStyle(popper!).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(tooltip).zIndex),
    );
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

  it("snaps a dragged create mark to a nearby event when linked adjustment is enabled", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/first", 1, 1)],
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
          rollingEditEnabled
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    act(() => {
      timelineInteractionStore.getState().setHoverValue({
        componentId: "test-component",
        type: "PLAYBACK_SECONDS",
        value: 1.99,
      });
    });

    await waitFor(() => {
      expect(setEventMarks).toHaveBeenCalledWith([
        { key: "start", position: 0.2, time: { sec: 2, nsec: 0 } },
        { key: "end", position: 0.5, time: { sec: 5, nsec: 0 } },
      ]);
    });
  });

  it("does not snap a dragged create mark when linked adjustment is disabled", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/first", 1, 1)],
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
          rollingEditEnabled={false}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    act(() => {
      timelineInteractionStore.getState().setHoverValue({
        componentId: "test-component",
        type: "PLAYBACK_SECONDS",
        value: 1.99,
      });
    });

    await waitFor(() => {
      expect(setEventMarks).toHaveBeenCalledWith([
        {
          key: "start",
          position: 0.199,
          time: add({ sec: 0, nsec: 0 }, fromSec(1.99)),
        },
        { key: "end", position: 0.5, time: { sec: 5, nsec: 0 } },
      ]);
    });
  });

  it("coalesces moves and commits the pointerup coordinate even before the next frame", async () => {
    const updateEvent = jest.fn().mockResolvedValue({});
    const { seekPlayback } = renderOverlayWithSeek({
      events: [makeEvent("events/body", 1, 2)],
      consoleApi: makeConsoleApiMock({ updateEvent }),
    });
    mockTimelineRect(screen.getByTestId("events-overlay"));
    firePointerDown(screen.getByTestId("timeline-event"), 100);
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 200 }));
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 300 }));
    expect(seekPlayback).not.toHaveBeenCalled();
    flushAnimationFrame();
    expect(seekPlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(3));
    await act(async () => {
      firePointerUp(500);
    });
    expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(5));
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent.mock.calls[0]![0].event.triggerTime.seconds).toBe(BigInt(5));
    const count = seekPlayback.mock.calls.length;
    flushAnimationFrame();
    expect(seekPlayback).toHaveBeenCalledTimes(count);
  });

  it("cancels pending previews without persisting a cancelled drag", () => {
    const updateEvent = jest.fn().mockResolvedValue({});
    const { seekPlayback } = renderOverlayWithSeek({
      events: [makeEvent("events/body", 1, 2)],
      consoleApi: makeConsoleApiMock({ updateEvent }),
    });
    mockTimelineRect(screen.getByTestId("events-overlay"));
    firePointerDown(screen.getByTestId("timeline-event"), 100);
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 400 }));
    fireEvent(window, new MouseEvent("pointercancel", { bubbles: true }));
    flushAnimationFrame();
    firePointerUp(400);
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("seeks to the pointer time while dragging a moment body", async () => {
    const { seekPlayback } = renderOverlayWithSeek({
      events: [makeEvent("events/body", 1, 2)],
    });
    mockTimelineRect(screen.getByTestId("events-overlay"));

    await act(async () => {
      firePointerDown(screen.getByTestId("timeline-event"), 100);
    });
    await act(async () => {
      firePointerMove(400);
    });

    expect(seekPlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(4));

    await act(async () => {
      firePointerUp(400);
    });
  });

  it.each([
    ["timeline-event-start-handle", 100, 200, 2],
    ["timeline-event-end-handle", 300, 400, 4],
  ])(
    "seeks to the edited boundary while dragging the %s",
    async (handleTestId, initialClientX, targetClientX, expectedSec) => {
      const { seekPlayback } = renderOverlayWithSeek({
        events: [makeEvent("events/edge", 1, 2)],
      });
      mockTimelineRect(screen.getByTestId("events-overlay"));

      await act(async () => {
        firePointerDown(screen.getByTestId(handleTestId), initialClientX);
      });
      await act(async () => {
        firePointerMove(targetClientX);
      });

      expect(seekPlayback).toHaveBeenCalledTimes(1);
      expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(expectedSec));

      await act(async () => {
        firePointerUp(targetClientX);
      });
    },
  );

  it("seeks to the rolling edit boundary while dragging adjacent moments", async () => {
    const updateEvent = jest.fn().mockResolvedValue({});
    const { seekPlayback } = renderOverlayWithSeek({
      consoleApi: makeConsoleApiMock({ updateEvent }),
      events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
    });
    mockTimelineRect();

    await act(async () => {
      firePointerDown(screen.getByTestId("timeline-rolling-edit-handle"), 500);
    });
    await act(async () => {
      firePointerMove(600);
    });

    expect(seekPlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(6));

    await act(async () => {
      firePointerUp(600);
    });
  });

  it.each(["pointercancel", "blur"])(
    "discards rolling previews and an immediate release after %s",
    async (eventType) => {
      const updateEvent = jest.fn().mockResolvedValue({});
      const { eventsStore, seekPlayback } = renderOverlayWithSeek({
        consoleApi: makeConsoleApiMock({ updateEvent }),
        events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
      });
      mockTimelineRect();
      firePointerDown(screen.getByTestId("timeline-rolling-edit-handle"), 500);
      firePointerMove(600);
      expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(6));
      seekPlayback.mockClear();
      await act(async () => {
        fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 700 }));
        fireEvent(window, new Event(eventType));
        // Release before React commits cancellation and removes the window listeners.
        firePointerUp(700);
      });
      flushAnimationFrame();
      expect(seekPlayback).not.toHaveBeenCalled();
      expect(updateEvent).not.toHaveBeenCalled();
      expect(getEventRanges(eventsStore)).toEqual([
        { startSec: 0, endSec: 5 },
        { startSec: 5, endSec: 10 },
      ]);
      // Cancelling must also leave the next interaction usable.
      await dragRollingEditBoundary(800);
      expect(updateEvent).toHaveBeenCalledTimes(2);
      expect(getEventRanges(eventsStore)).toEqual([
        { startSec: 0, endSec: 8 },
        { startSec: 8, endSec: 10 },
      ]);
    },
  );

  it("preserves the boundary when clicking a rolling edit handle away from its center", async () => {
    const updateEvent = jest.fn().mockResolvedValue({});
    const { eventsStore, seekPlayback } = renderOverlayWithSeek({
      consoleApi: makeConsoleApiMock({ updateEvent }),
      events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
    });
    mockTimelineRect();
    firePointerDown(screen.getByTestId("timeline-rolling-edit-handle"), 504);
    await act(async () => {
      firePointerUp(504);
    });
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(getEventRanges(eventsStore)).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 5, endSec: 10 },
    ]);
  });

  it.each(["release only", "pending move"])(
    "commits the final rolling edit release position with %s",
    async (input) => {
      const updateEvent = jest.fn().mockResolvedValue({});
      const { eventsStore, seekPlayback } = renderOverlayWithSeek({
        consoleApi: makeConsoleApiMock({ updateEvent }),
        events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
      });
      mockTimelineRect();
      firePointerDown(screen.getByTestId("timeline-rolling-edit-handle"), 504);
      if (input === "pending move") {
        fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 600 }));
      }
      await act(async () => {
        firePointerUp(700);
      });
      flushAnimationFrame();
      expect(seekPlayback).toHaveBeenCalledTimes(1);
      expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(7));
      expect(updateEvent).toHaveBeenCalledTimes(2);
      expect(getEventRanges(eventsStore)).toEqual([
        { startSec: 0, endSec: 7 },
        { startSec: 7, endSec: 10 },
      ]);
    },
  );

  it("discards a rolling edit and its pending preview when the mode is disabled", () => {
    const updateEvent = jest.fn().mockResolvedValue({});
    const consoleApi = makeConsoleApiMock({ updateEvent });
    const onSeek = jest.fn();
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();
    const content = ({ enabled }: { enabled: boolean }) => (
      <Wrapper
        consoleApi={consoleApi}
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
          rollingEditEnabled={enabled}
          onSeek={onSeek}
        />
      </Wrapper>
    );
    const { rerender } = render(content({ enabled: true }));
    mockTimelineRect();
    firePointerDown(screen.getByTestId("timeline-rolling-edit-handle"), 500);
    firePointerMove(600);
    expect(screen.getAllByTestId("timeline-event")[0]!.style.width).toBe("max(60%, 4px)");
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 700 }));
    rerender(content({ enabled: false }));
    flushAnimationFrame();
    expect(screen.getAllByTestId("timeline-event")[0]!.style.width).toBe("max(50%, 4px)");
    expect(onSeek).toHaveBeenCalledTimes(1);
    rerender(content({ enabled: true }));
    firePointerUp(800);
    expect(updateEvent).not.toHaveBeenCalled();
    expect(getEventRanges(eventsStore)).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 5, endSec: 10 },
    ]);
  });

  it("does not seek while a moment body move stays under the drag threshold", async () => {
    const { seekPlayback } = renderOverlayWithSeek({
      events: [makeEvent("events/body", 1, 2)],
    });
    mockTimelineRect(screen.getByTestId("events-overlay"));

    await act(async () => {
      firePointerDown(screen.getByTestId("timeline-event"), 100);
    });
    await act(async () => {
      firePointerMove(103);
    });

    expect(seekPlayback).not.toHaveBeenCalled();

    await act(async () => {
      firePointerUp(103);
    });
    expect(seekPlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenLastCalledWith(fromSec(1.03));
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
        consoleApi={makeConsoleApiMock({ updateEvent })}
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
        consoleApi={makeConsoleApiMock({ updateEvent })}
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
        consoleApi={makeConsoleApiMock({ updateEvent })}
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
        consoleApi={makeConsoleApiMock({ updateEvent })}
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
          consoleApi={makeConsoleApiMock({ updateEvent })}
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

  it("opens the single-event context menu for the moment that contains the playback time", () => {
    const onEventContextMenuHandled = jest.fn();
    const eventsStore = makeEventsStore({
      events: [
        makeEvent("events/before", 4, 1),
        makeEvent("events/current", 5, 1),
        makeEvent("events/after", 6, 1),
      ],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={makeTimelineInteractionStore()}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging={false}
          eventContextMenuRequest={{ playbackSeconds: 5, clientX: 500, clientY: 40 }}
          onEventContextMenuHandled={onEventContextMenuHandled}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    expect(onEventContextMenuHandled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: "Edit Moment" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "events/before" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "events/current" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "events/after" })).toBeNull();
  });

  it("opens the selection menu when two moments truly overlap the playback time", () => {
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/wide", 4, 4), makeEvent("events/inner", 5, 1)],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={makeTimelineInteractionStore()}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging={false}
          eventContextMenuRequest={{ playbackSeconds: 5.5, clientX: 500, clientY: 40 }}
          onEventContextMenuHandled={jest.fn()}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    expect(screen.getByRole("menuitem", { name: "events/wide" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "events/inner" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit Moment" })).toBeNull();
  });

  it("does not open a moment menu when no moment contains the playback time", () => {
    const onEventContextMenuHandled = jest.fn();
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/current", 5, 1)],
      eventMarks: [],
      setEventMarks: jest.fn(),
    });

    render(
      <Wrapper eventsStore={eventsStore} timelineInteractionStore={makeTimelineInteractionStore()}>
        <EventsOverlay
          componentId="test-component"
          canWriteEvents
          isDragging={false}
          eventContextMenuRequest={{ playbackSeconds: 4.5, clientX: 500, clientY: 40 }}
          onEventContextMenuHandled={onEventContextMenuHandled}
          setCursor={jest.fn()}
          viewport={viewport}
        />
      </Wrapper>,
    );

    expect(onEventContextMenuHandled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Moment context menu migration", () => {
  function mount({
    writable = true,
    deletable = true,
    events = [makeEvent("events/current", 2, 4)],
    updateEvent = jest.fn().mockResolvedValue({}),
    deleteEvent = jest.fn().mockResolvedValue({}),
    deleteFile = jest.fn().mockResolvedValue({}),
  } = {}) {
    const eventsStore = makeEventsStore({ events, eventMarks: [], setEventMarks: jest.fn() });
    const seek = jest.fn();
    const focus = jest.fn();
    const timelineStore = makeTimelineInteractionStore();
    const renderView = ({
      canWrite = writable,
      canDelete = deletable,
      currentTime = fromSec(3),
    } = {}) => (
      <Wrapper
        consoleApi={makeConsoleApiMock({ updateEvent, deleteEvent, deleteFile })}
        eventsStore={eventsStore}
        seekPlayback={seek}
        currentTime={currentTime}
        timelineInteractionStore={timelineStore}
      >
        <div
          onPointerDown={(event) => {
            if (event.button === 0) {
              seek();
            }
          }}
        >
          <EventsOverlay
            componentId="test-component"
            canWriteEvents={canWrite}
            canDeleteEvents={canDelete}
            onSeek={seek}
            onFocusEvent={focus}
            isDragging={false}
            eventContextMenuRequest={undefined}
            onEventContextMenuHandled={jest.fn()}
            setCursor={jest.fn()}
            viewport={viewport}
          />
        </div>
      </Wrapper>
    );
    const result = render(renderView());
    const open = (target: "body" | "start" | "end" = "body") => {
      const bar = screen.getAllByTestId("timeline-event")[0]!;
      const hit =
        target === "body" ? bar : within(bar).getByTestId(`timeline-event-${target}-handle`);
      fireEvent(
        hit,
        new MouseEvent("pointerdown", { bubbles: true, button: 2, clientX: 240, clientY: 100 }),
      );
      fireEvent(
        window,
        new MouseEvent("pointerup", { bubbles: true, button: 2, clientX: 240, clientY: 100 }),
      );
      fireEvent.contextMenu(hit, {
        clientX: 240,
        clientY: 100,
      });
    };
    return {
      ...result,
      eventsStore,
      seek,
      focus,
      updateEvent,
      deleteEvent,
      deleteFile,
      open,
      renderView,
    };
  }

  it("right-clicks the bar directly without seeking, then focuses without writing", () => {
    const state = mount();
    state.open();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit Moment",
      "Focus this moment",
      "Align start to cursor",
      "Align end to cursor",
      "Delete",
      "Loop Play",
    ]);
    expect(state.seek).not.toHaveBeenCalled();
    fireEvent(
      screen.getByRole("menuitem", { name: "Focus this moment" }),
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 240 }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Focus this moment" }));
    expect(state.focus).toHaveBeenCalledWith(state.eventsStore.getState().events.value![0]);
    expect(state.seek).not.toHaveBeenCalled();
    expect(state.updateEvent).not.toHaveBeenCalled();
  });

  it.each(["body", "start", "end"] as const)(
    "does not seek or clear editor marks when right-clicking the %s",
    (target) => {
      const state = mount();
      const marks = [{ key: "mark", time: fromSec(2), position: 0.2 }];
      act(() => {
        state.eventsStore.getState().setEventMarks(marks);
      });
      state.open(target);
      expect(state.seek).not.toHaveBeenCalled();
      expect(state.eventsStore.getState().eventMarks).toBe(marks);
      expect(state.updateEvent).not.toHaveBeenCalled();
    },
  );

  it("offers read-only details with public metadata and no editor or write actions", () => {
    const event = makeEvent("events/current", 2, 4);
    event.event.description = "Public description";
    event.event.customizedFields = {
      visible: "public value",
      _source: "user-provided source",
      _doubtful: "true",
    };
    const state = mount({ writable: false, deletable: false, events: [event] });
    state.open();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View Moment",
      "Focus this moment",
      "Loop Play",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "View Moment" }));
    expect(screen.getByRole("dialog", { name: "View Moment" })).toBeTruthy();
    expect(screen.getByText("Public description")).toBeTruthy();
    expect(screen.getByText("public value")).toBeTruthy();
    expect(screen.getByText("_source")).toBeTruthy();
    expect(screen.getByText("user-provided source")).toBeTruthy();
    expect(screen.queryByText("_doubtful")).toBeNull();
    expect(state.eventsStore.getState().toModifyEvent).toBeUndefined();
    expect(state.seek).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["start", 3, 3],
    ["end", 2, 1],
  ])(
    "aligns %s with only timestamp and duration in the field mask",
    async (edge, start, duration) => {
      const state = mount();
      state.open();
      fireEvent.click(screen.getByRole("menuitem", { name: `Align ${edge} to cursor` }));
      await waitFor(() => {
        expect(state.updateEvent).toHaveBeenCalledTimes(1);
      });
      const request = state.updateEvent.mock.calls[0]![0];
      expect(request.updateMask.paths).toEqual(["trigger_time", "duration_nanos", "duration"]);
      expect(request.event.triggerTime.seconds).toBe(BigInt(start));
      expect(request.event.duration.seconds).toBe(BigInt(duration));
      expect(state.seek).not.toHaveBeenCalled();
    },
  );

  it("uses the latest cursor and event while the menu is open", async () => {
    const state = mount();
    state.open();
    state.rerender(state.renderView({ currentTime: fromSec(4.125) }));
    act(() => {
      state.eventsStore
        .getState()
        .setEvents({ loading: false, value: [makeEvent("events/current", 2, 5)] });
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Align start to cursor" }));
    await waitFor(() => {
      expect(state.updateEvent).toHaveBeenCalledTimes(1);
    });
    expect(state.updateEvent.mock.calls[0]![0].event.triggerTime.nanos).toBe(125000000);
    expect(state.updateEvent.mock.calls[0]![0].event.duration.seconds).toBe(2n);
    expect(state.updateEvent.mock.calls[0]![0].event.duration.nanos).toBe(875000000);
  });

  it("disables invalid alignment and removes stale menus when a Moment disappears", () => {
    const state = mount();
    state.open();
    state.rerender(state.renderView({ currentTime: fromSec(6) }));
    expect(
      screen.getByRole("menuitem", { name: "Align start to cursor" }).getAttribute("aria-disabled"),
    ).toBe("true");
    act(() => {
      state.eventsStore.getState().setEvents({ loading: false, value: [] });
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("requires confirmation, respects cancellation and preserves file cleanup", async () => {
    const event = makeEvent("events/current", 2, 4);
    event.event.files = ["files/image"];
    const state = mount({ events: [event] });
    state.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(state.deleteEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(state.deleteEvent).not.toHaveBeenCalled();
    state.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(state.deleteEvent).toHaveBeenCalledWith({ eventName: event.event.name });
    });
    expect(state.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ name: "files/image" }));
  });

  it("checks delete permission again after confirmation and independently of edit permission", async () => {
    const state = mount({ writable: false });
    state.open();
    expect(screen.queryByRole("menuitem", { name: "Edit Moment" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    state.rerender(state.renderView({ canWrite: false, canDelete: false }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {});
    expect(state.deleteEvent).not.toHaveBeenCalled();
  });

  it("rolls back a failed alignment and the open editor's time marks", async () => {
    const pending = defer<unknown>();
    const state = mount({ updateEvent: jest.fn().mockReturnValue(pending.promise) });
    state.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Moment" }));
    const marks = state.eventsStore.getState().eventMarks;
    const events = state.eventsStore.getState().events.value;
    state.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Align start to cursor" }));
    expect(state.eventsStore.getState().eventMarks[0]?.time.sec).toBe(3);
    expect(state.eventsStore.getState().events.value![0]!.secondsSinceStart).toBe(3);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      pending.reject(new Error("alignment rejected"));
      await pending.promise.catch(() => {});
    });
    expect(state.eventsStore.getState().events.value).toBe(events);
    expect(state.eventsStore.getState().eventMarks).toBe(marks);
    log.mockRestore();
  });

  it("locks duplicate time writes and does not restore an old record on late failure", async () => {
    const pending = defer<unknown>();
    const update = jest.fn().mockReturnValue(pending.promise);
    const state = mount({ updateEvent: update });
    state.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Align start to cursor" }));
    state.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Align end to cursor" }));
    expect(update).toHaveBeenCalledTimes(1);
    const next = [makeEvent("events/new-record", 4, 3)];
    act(() => {
      state.eventsStore.getState().setEvents({ loading: false, value: next });
    });
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      pending.reject(new Error("late failure"));
      await pending.promise.catch(() => {});
    });
    expect(state.eventsStore.getState().events.value).toBe(next);
    log.mockRestore();
  });
});

it("limits time-based right clicks to the actual track row, including overlap sublanes", () => {
  const events = [makeEvent("events/first", 2, 4), makeEvent("events/second", 2, 4)];
  const eventsStore = makeEventsStore({ events, eventMarks: [], setEventMarks: jest.fn() });
  const trackLayout = layoutMomentTracks({ tracks: getMomentTracks(events), view: {}, viewport });
  const props = {
    componentId: "test-component",
    canWriteEvents: true,
    isDragging: false,
    eventContextMenuRequest: undefined,
    onEventContextMenuHandled: jest.fn(),
    setCursor: jest.fn(),
    viewport,
    trackLayout,
  };
  const state = render(
    <Wrapper eventsStore={eventsStore} timelineInteractionStore={makeTimelineInteractionStore()}>
      <EventsOverlay {...props} />
    </Wrapper>,
  );
  mockTimelineRect();
  state.rerender(
    <Wrapper eventsStore={eventsStore} timelineInteractionStore={makeTimelineInteractionStore()}>
      <EventsOverlay
        {...props}
        eventContextMenuRequest={{ playbackSeconds: 3, clientX: 300, clientY: 35 }}
      />
    </Wrapper>,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit Moment" }));
  expect(eventsStore.getState().toModifyEvent?.name).toBe("events/second");
});

it("does not align a Moment while its linked boundary update is still pending", async () => {
  const pending = defer<unknown>();
  const updateEvent = jest.fn().mockReturnValue(pending.promise);
  renderOverlayWithSeek({
    consoleApi: makeConsoleApiMock({ updateEvent }),
    events: [makeEvent("events/first", 0, 5), makeEvent("events/second", 5, 5)],
  });
  await dragRollingEditBoundary(600);
  expect(updateEvent).toHaveBeenCalledTimes(2);
  fireEvent.contextMenu(screen.getAllByTestId("timeline-event")[0]!, { clientX: 100, clientY: 40 });
  fireEvent.click(screen.getByRole("menuitem", { name: "Align end to cursor" }));
  expect(updateEvent).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending.resolve({});
    await pending.promise;
  });
});
