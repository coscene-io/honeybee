/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { act, render, waitFor } from "@testing-library/react";
import * as _ from "lodash-es";
import { useContext, useEffect } from "react";
import type { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";

import { subtract, toSec } from "@foxglove/rostime";
import { ContextInternal } from "@foxglove/studio-base/components/MessagePipeline";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  type BagFileInfo,
  CoScenePlaylistContext,
  type CoScenePlaylistStore,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { type CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
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
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import type {
  EventList,
  SingleFileGetEventsRequest,
} from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

import { EventsSyncAdapter } from "./EventsSyncAdapter";

type MockPipelineStore = NonNullable<React.ContextType<typeof ContextInternal>>;
type MockPipelineProps = {
  startTime: { sec: number; nsec: number };
  endTime: { sec: number; nsec: number };
  currentTime: { sec: number; nsec: number };
};
type MockSetPropsDispatch = (action: {
  type: "set-mock-props";
  mockProps: MockPipelineProps;
}) => void;

function dispatchMockPipelineProps(store: MockPipelineStore, mockProps: MockPipelineProps): void {
  (store.getState().dispatch as unknown as MockSetPropsDispatch)({
    type: "set-mock-props",
    mockProps,
  });
}

function makeEvent(name: string, startSec: number, durationSec: number): TimelinePositionedEvent {
  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, {
        seconds: BigInt(startSec),
        nanos: 0,
      }),
      duration: create(DurationSchema, {
        seconds: BigInt(durationSec),
        nanos: 0,
      }),
    }),
    startTime: { sec: startSec, nsec: 0 },
    endTime: { sec: startSec + durationSec, nsec: 0 },
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + durationSec) / 10,
    secondsSinceStart: startSec,
  };
}

function makeEventsStore({
  events,
  eventMarks,
  setEventMarks,
}: {
  events: TimelinePositionedEvent[];
  eventMarks?: TimelinePositionedEventMark[];
  setEventMarks: jest.Mock<void, [TimelinePositionedEventMark[]]>;
}): StoreApi<EventsStore> {
  return createStore<EventsStore>((set) => ({
    eventFetchCount: 0,
    events: { loading: false, value: events },
    filter: "",
    selectedEventId: undefined,
    deviceId: undefined,
    eventMarks: eventMarks ?? [],
    toModifyEvent: undefined,
    customFieldSchema: undefined,

    refreshEvents: () => {
      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },
    selectEvent: (id: undefined | string) => {
      set({ selectedEventId: id });
    },
    setEvents: (nextEvents: AsyncState<TimelinePositionedEvent[]>) => {
      set({ events: nextEvents, selectedEventId: undefined });
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

function makeTimelineInteractionStore(): StoreApi<TimelineInteractionStateStore> {
  return createStore<TimelineInteractionStateStore>((set) => ({
    eventsAtHoverValue: {},
    bagsAtHoverValue: {},
    globalBounds: undefined,
    hoveredEvent: undefined,
    hoveredBag: undefined,
    hoverValue: undefined,
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
    setHoverValue: (hoverValue) => {
      set({ hoverValue });
    },
    setLoopedEvent: (loopedEvent: undefined | TimelinePositionedEvent) => {
      set({ loopedEvent });
    },
  }));
}

function SeedEventFeature({ enabled }: { enabled: boolean }): ReactNull {
  const setDataSource = useCoreData((store: CoreDataStore) => store.setDataSource);

  useEffect(() => {
    setDataSource(enabled ? { id: "coscene-data-platform", type: "connection" } : undefined);
  }, [enabled, setDataSource]);

  return ReactNull;
}

function MessagePipelineStoreProbe({
  onStore,
}: {
  onStore: (store: MockPipelineStore) => void;
}): ReactNull {
  const store = useContext(ContextInternal);

  useEffect(() => {
    if (store) {
      onStore(store);
    }
  }, [onStore, store]);

  return ReactNull;
}

function Wrapper({
  children,
  consoleApi = {} as never,
  currentTime,
  startTime = { sec: 0, nsec: 0 },
  endTime = { sec: 10, nsec: 0 },
  eventEnabled = false,
  eventsStore,
  rollingEditEnabled = true,
  timelineInteractionStore,
}: React.PropsWithChildren<{
  consoleApi?: React.ContextType<typeof CoSceneConsoleApiContext>;
  currentTime: { sec: number; nsec: number };
  startTime?: { sec: number; nsec: number };
  endTime?: { sec: number; nsec: number };
  eventEnabled?: boolean;
  eventsStore: StoreApi<EventsStore>;
  rollingEditEnabled?: boolean;
  timelineInteractionStore: StoreApi<TimelineInteractionStateStore>;
}>): React.JSX.Element {
  return (
    <CoSceneConsoleApiContext.Provider value={consoleApi}>
      <CoreDataProvider>
        <WorkspaceContextProvider
          disablePersistence
          initialState={{ playbackControls: { rollingEditEnabled } }}
        >
          <CoScenePlaylistProvider>
            <MockMessagePipelineProvider
              startTime={startTime}
              endTime={endTime}
              currentTime={currentTime}
            >
              <TimelineInteractionStateContext.Provider value={timelineInteractionStore}>
                <EventsContext.Provider value={eventsStore}>
                  <DialogsProvider>
                    <SeedEventFeature enabled={eventEnabled} />
                    {children}
                  </DialogsProvider>
                </EventsContext.Provider>
              </TimelineInteractionStateContext.Provider>
            </MockMessagePipelineProvider>
          </CoScenePlaylistProvider>
        </WorkspaceContextProvider>
      </CoreDataProvider>
    </CoSceneConsoleApiContext.Provider>
  );
}

describe("<EventsSyncAdapter />", () => {
  it.each([
    ["NORMAL_FILE", 363_000_000],
    ["NORMAL_FILE", 2_000_000],
    ["GHOST_RESULT_FILE", 363_000_000],
    ["GHOST_RESULT_FILE", 2_000_000],
  ] as const)(
    "retains moments at both %s file bounds after refreshing (start nanos: %i)",
    async (fileType, startNanos) => {
      const startTime = { sec: 1_785_401_051, nsec: startNanos };
      const endTime = { sec: 1_785_401_229, nsec: 899_000_000 };
      const boundaryEvents: EventList = [startTime, endTime].map((time, index) => ({
        event: create(EventSchema, {
          name: `events/boundary-${index}`,
          triggerTime: create(TimestampSchema, {
            seconds: BigInt(time.sec),
            nanos: time.nsec,
          }),
          duration: create(DurationSchema, { seconds: index === 0 ? 1n : 0n }),
        }),
        projectDisplayName: "project",
        recordDisplayName: "record",
      }));
      // Model a server comparing its nanosecond timestamps against numeric query bounds.
      const getEvents = jest.fn(
        async ({ fileList }: { fileList: SingleFileGetEventsRequest[] }) => {
          const file = fileList[0]!;
          const lowerBound = BigInt(file.startTime.toFixed(9).replace(".", ""));
          const upperBound = BigInt(file.endTime.toFixed(9).replace(".", ""));
          return boundaryEvents.filter(({ event }) => {
            const triggerTime = event.triggerTime!;
            const nanos = triggerTime.seconds * 1_000_000_000n + BigInt(triggerTime.nanos);
            return nanos >= lowerBound && nanos <= upperBound;
          });
        },
      );
      const eventsStore = makeEventsStore({ events: [], setEventMarks: jest.fn() });
      const bagFiles: BagFileInfo[] = [
        {
          name:
            fileType === "NORMAL_FILE"
              ? "warehouses/warehouse/projects/project/records/record/files/file"
              : "warehouses/warehouse/projects/project/workflowRuns/workflow/outputs/file",
          displayName: "file",
          fileType,
          mediaStatues: "OK",
          startTime,
          endTime,
        },
      ];
      const playlistStore = createStore<CoScenePlaylistStore>(() => ({
        bagFiles: { loading: false, value: bagFiles },
        setBagFiles: jest.fn(),
        setCurrentBagFiles: jest.fn(),
      }));

      render(
        <Wrapper
          consoleApi={{ getEvents } as never}
          currentTime={startTime}
          startTime={startTime}
          endTime={endTime}
          eventsStore={eventsStore}
          timelineInteractionStore={makeTimelineInteractionStore()}
        >
          <CoScenePlaylistContext.Provider value={playlistStore}>
            <EventsSyncAdapter />
          </CoScenePlaylistContext.Provider>
        </Wrapper>,
      );

      const expectBoundaryEvents = () => {
        expect(eventsStore.getState().events.value?.map(({ event }) => event.name)).toEqual([
          "events/boundary-0",
          "events/boundary-1",
        ]);
      };
      await waitFor(expectBoundaryEvents);

      getEvents.mockClear();
      act(() => {
        eventsStore.getState().refreshEvents();
      });
      await waitFor(() => {
        expect(getEvents).toHaveBeenCalledTimes(1);
        expect(eventsStore.getState().events.loading).toBe(false);
        expectBoundaryEvents();
      });
    },
  );

  it("snaps shortcut-created marks to nearby event boundaries when linked adjustment is enabled", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/first", 1, 1)],
      setEventMarks,
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        currentTime={{ sec: 1, nsec: 990_000_000 }}
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
        <EventsSyncAdapter />
      </Wrapper>,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "1",
          code: "Digit1",
          altKey: true,
          bubbles: true,
        }),
      );
    });

    await waitFor(() => {
      expect(setEventMarks).toHaveBeenCalledTimes(1);
    });
    expect(setEventMarks).toHaveBeenCalledWith([
      expect.objectContaining({
        position: 0.2,
        time: { sec: 2, nsec: 0 },
      }),
    ]);
  });

  it("does not snap shortcut-created marks when linked adjustment is disabled", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      events: [makeEvent("events/first", 1, 1)],
      setEventMarks,
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        currentTime={{ sec: 1, nsec: 990_000_000 }}
        eventsStore={eventsStore}
        rollingEditEnabled={false}
        timelineInteractionStore={timelineInteractionStore}
      >
        <EventsSyncAdapter />
      </Wrapper>,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "1",
          code: "Digit1",
          altKey: true,
          bubbles: true,
        }),
      );
    });

    await waitFor(() => {
      expect(setEventMarks).toHaveBeenCalledTimes(1);
    });
    expect(setEventMarks).toHaveBeenCalledWith([
      expect.objectContaining({
        time: { sec: 1, nsec: 990_000_000 },
      }),
    ]);
  });

  it("does not re-check event permissions when only playback time changes", async () => {
    const startTime = { sec: 0, nsec: 0 };
    const endTime = { sec: 10, nsec: 0 };
    const updatePermission = jest.fn(() => true);
    const deletePermission = jest.fn(() => true);
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      events: [],
      setEventMarks,
    });
    const timelineInteractionStore = makeTimelineInteractionStore();
    let pipelineStore: MockPipelineStore | undefined;

    render(
      <Wrapper
        consoleApi={
          {
            updateEvent: { permission: updatePermission },
            deleteEvent: { permission: deletePermission },
          } as never
        }
        currentTime={{ sec: 1, nsec: 0 }}
        eventEnabled
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
        <MessagePipelineStoreProbe
          onStore={(store) => {
            pipelineStore = store;
          }}
        />
        <EventsSyncAdapter />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(updatePermission).toHaveBeenCalled();
      expect(deletePermission).toHaveBeenCalled();
      expect(pipelineStore).toBeDefined();
    });

    updatePermission.mockClear();
    deletePermission.mockClear();

    await act(async () => {
      dispatchMockPipelineProps(pipelineStore!, {
        startTime,
        endTime,
        currentTime: { sec: 2, nsec: 0 },
      });
      await Promise.resolve();
    });

    expect(updatePermission).not.toHaveBeenCalled();
    expect(deletePermission).not.toHaveBeenCalled();
  });

  it("sets eventsAtHoverValue from exact playback-time containment", async () => {
    const setEventMarks = jest.fn<void, [TimelinePositionedEventMark[]]>();
    const eventsStore = makeEventsStore({
      events: [
        makeEvent("events/before", 4, 1),
        makeEvent("events/current", 5, 1),
        makeEvent("events/after", 6, 1),
      ],
      setEventMarks,
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        currentTime={{ sec: 0, nsec: 0 }}
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
        <EventsSyncAdapter />
      </Wrapper>,
    );

    act(() => {
      timelineInteractionStore.getState().setHoverValue({
        componentId: "test-hover",
        type: "PLAYBACK_SECONDS",
        value: 5,
      });
    });

    await waitFor(() => {
      expect(Object.keys(timelineInteractionStore.getState().eventsAtHoverValue).sort()).toEqual([
        "events/current",
      ]);
    });
  });

  it("matches synchronized chart hovers at fractional boundaries and the recording end", async () => {
    const startTime = { sec: 1_700_000_000, nsec: 0 };
    const boundary = { sec: 1_700_001_500, nsec: 123_456_789 };
    const endTime = { sec: 1_700_003_000, nsec: 123_456_789 };
    const first = {
      ...makeEvent("events/first", startTime.sec, 1500),
      startTime,
      endTime: boundary,
    };
    const second = {
      ...makeEvent("events/second", boundary.sec, 1500),
      startTime: boundary,
      endTime,
    };
    const eventsStore = makeEventsStore({
      events: [first, second],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        startTime={startTime}
        endTime={endTime}
        currentTime={startTime}
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
        <EventsSyncAdapter />
      </Wrapper>,
    );

    for (const time of [boundary, endTime]) {
      act(() => {
        timelineInteractionStore.getState().setHoverValue({
          componentId: "chart-hover",
          type: "PLAYBACK_SECONDS",
          value: toSec(subtract(time, startTime)),
        });
      });

      await waitFor(() => {
        expect(Object.keys(timelineInteractionStore.getState().eventsAtHoverValue)).toEqual([
          "events/second",
        ]);
      });
    }
  });

  it("matches extension preview boundaries at the precision of the supplied absolute number", async () => {
    const startTime = { sec: 1_700_000_000, nsec: 123_456_789 };
    const boundary = { sec: 1_700_000_001, nsec: 987_654_321 };
    const endTime = { sec: 1_700_000_003, nsec: 123_456_789 };
    const eventsStore = makeEventsStore({
      events: [
        { ...makeEvent("events/first", startTime.sec, 1), startTime, endTime: boundary },
        { ...makeEvent("events/second", boundary.sec, 2), startTime: boundary, endTime },
        { ...makeEvent("events/point", boundary.sec, 0), startTime: boundary, endTime: boundary },
      ],
      setEventMarks: jest.fn(),
    });
    const timelineInteractionStore = makeTimelineInteractionStore();

    render(
      <Wrapper
        startTime={startTime}
        endTime={endTime}
        currentTime={startTime}
        eventsStore={eventsStore}
        timelineInteractionStore={timelineInteractionStore}
      >
        <EventsSyncAdapter />
      </Wrapper>,
    );

    for (const [time, expected] of [
      [boundary, ["events/second", "events/point"]],
      [endTime, ["events/second"]],
    ] as const) {
      act(() => {
        timelineInteractionStore.getState().setHoverValue({
          componentId: "extension-hover",
          type: "PLAYBACK_SECONDS",
          value: toSec(time) - toSec(startTime),
          absoluteSeconds: toSec(time),
        });
      });
      await waitFor(() => {
        expect(Object.keys(timelineInteractionStore.getState().eventsAtHoverValue)).toEqual(
          expected,
        );
      });
    }

    act(() => {
      timelineInteractionStore.getState().clearHoverValue("extension-hover");
    });
    expect(timelineInteractionStore.getState().eventsAtHoverValue).toEqual({});
  });
});
