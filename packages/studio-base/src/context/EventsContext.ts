// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import {
  CustomFieldSchema,
  CustomFieldValue,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";
import { Time } from "@foxglove/rostime";

export type KeyValue = { key: string; value: string };

export type ToModifyEvent = {
  name: string;
  eventName: string;
  startTime: undefined | Date;
  duration: undefined | number;
  durationUnit: "sec" | "nsec";
  description: undefined | string;
  metadataEntries: KeyValue[];
  enabledCreateNewTask: boolean;
  fileName: string;
  imageFile?: File;
  imgUrl?: string;
  record: string;
  customFieldValues?: CustomFieldValue[];
};

/**
 * DataSourceEvent representings a single event within a data source.
 */
export type DataSourceEvent = {
  id: string;
  createdAt: string;
  deviceId: string;
  durationNanos: string;
  endTime: Time;
  endTimeInSeconds: number;
  metadata: Record<string, string>;
  startTime: Time;
  startTimeInSeconds: number;
  timestampNanos: string;
  updatedAt: string;
};

/**
 * Represents an event including its fractional position on the timeline.
 */
export type TimelinePositionedEvent = {
  /** The event. */
  event: Event;

  startTime: Time;

  endTime: Time;

  imgUrl?: string;

  projectDisplayName?: string;

  recordDisplayName?: string;

  /** The color mapped to the recordId of this event. */
  color: string;

  /** The end position of the event, as a value 0-1 relative to the timeline. */
  endPosition: number;

  /** The start position of the event, as a value 0-1 relative to the timeline. */
  startPosition: number;

  /** The time, in seconds, relative to the start of the timeline. */
  secondsSinceStart: number;
};

export type TimelinePositionedEventMark = {
  time: Time;
  position: number;
  key: string;
};

export type EventsStore = {
  /** Used to signal event refreshes. */
  eventFetchCount: number;

  /** Fetched events for this session. */
  events: AsyncState<TimelinePositionedEvent[]>;

  /** The marks on the timeline representing events. */
  eventMarks: TimelinePositionedEventMark[];

  /** The current event filter expression. */
  filter: string;

  /** The currently selected event, if any. */
  selectedEventId: undefined | string;

  /** The active device under which new events should be created. */
  deviceId: string | undefined;

  toModifyEvent: ToModifyEvent | undefined;

  // customFieldValues: CustomFieldValue[];
  customFieldSchema?: CustomFieldSchema;

  /** Refreshes events from api. */
  refreshEvents: () => void;

  /** Select an event by id or clear the selection. */
  selectEvent: (id: undefined | string) => void;

  /** Set the fetched events. */
  setEvents: (events: AsyncState<TimelinePositionedEvent[]>) => void;

  /** Update the current filter expression. */
  setFilter: (filter: string) => void;

  /** Set the active device. */
  setDeviceId: (deviceId: string | undefined) => void;

  /** Set the marks on the timeline representing events. */
  setEventMarks: (marks: TimelinePositionedEventMark[]) => void;

  setToModifyEvent: (toModifyEvent: ToModifyEvent | undefined) => void;

  setCustomFieldSchema: (customFieldSchema?: CustomFieldSchema) => void;
};

export const EventsContext = createContext<undefined | StoreApi<EventsStore>>(undefined);

export function useEvents<T>(selector: (store: EventsStore) => T): T {
  const context = useGuaranteedContext(EventsContext);
  return useStore(context, selector);
}
