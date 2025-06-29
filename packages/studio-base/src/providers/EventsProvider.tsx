// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CustomFieldSchema } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import {
  EventsContext,
  EventsStore,
  TimelinePositionedEvent,
  TimelinePositionedEventMark,
  ToModifyEvent,
} from "@foxglove/studio-base/context/EventsContext";

const NO_EVENTS: TimelinePositionedEvent[] = [];

function createEventsStore() {
  return createStore<EventsStore>((set) => ({
    eventFetchCount: 0,
    events: { loading: false, value: NO_EVENTS },
    filter: "",
    selectedEventId: undefined,
    deviceId: undefined,
    eventMarks: [],
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
    setEventMarks: (mark: TimelinePositionedEventMark[]) => {
      set({ eventMarks: mark });
    },
    setToModifyEvent: (toModifyEvent: undefined | ToModifyEvent) => {
      set({ toModifyEvent });
    },
    setCustomFieldSchema: (customFieldSchema?: CustomFieldSchema) => {
      set({ customFieldSchema });
    },
  }));
}

export default function EventsProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  const [store] = useState(createEventsStore);

  return <EventsContext.Provider value={store}>{children}</EventsContext.Provider>;
}
