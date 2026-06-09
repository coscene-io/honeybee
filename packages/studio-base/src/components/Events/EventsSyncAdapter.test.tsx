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
import type { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
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
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";

import { EventsSyncAdapter } from "./EventsSyncAdapter";

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

function Wrapper({
  children,
  currentTime,
  eventsStore,
  timelineInteractionStore,
}: React.PropsWithChildren<{
  currentTime: { sec: number; nsec: number };
  eventsStore: StoreApi<EventsStore>;
  timelineInteractionStore: StoreApi<TimelineInteractionStateStore>;
}>): React.JSX.Element {
  return (
    <CoSceneConsoleApiContext.Provider value={{} as never}>
      <CoreDataProvider>
        <CoScenePlaylistProvider>
          <MockMessagePipelineProvider
            startTime={{ sec: 0, nsec: 0 }}
            endTime={{ sec: 10, nsec: 0 }}
            currentTime={currentTime}
          >
            <TimelineInteractionStateContext.Provider value={timelineInteractionStore}>
              <EventsContext.Provider value={eventsStore}>{children}</EventsContext.Provider>
            </TimelineInteractionStateContext.Provider>
          </MockMessagePipelineProvider>
        </CoScenePlaylistProvider>
      </CoreDataProvider>
    </CoSceneConsoleApiContext.Provider>
  );
}

describe("<EventsSyncAdapter />", () => {
  it("snaps shortcut-created marks to nearby event boundaries", async () => {
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
});
