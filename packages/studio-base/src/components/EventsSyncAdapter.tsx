// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/coscene/proto/v1alpha2";
import { useEffect, useMemo } from "react";
import { useAsyncFn } from "react-use";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, Time, toSec, fromNanoSec, add } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

function positionEvents(
  events: Event[],
  startTime: Time,
  endTime: Time,
): TimelinePositionedEvent[] {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  return events.map((event) => {
    const eventStartTime = fromNanoSec(
      BigInt(event.getTriggerTime()!.getSeconds() * 1e9 + event.getTriggerTime()!.getNanos()),
    );
    const eventEndTime = add(eventStartTime, fromNanoSec(BigInt(event.getDuration() * 1e9)));

    const startTimeInSeconds = toSec(eventStartTime);
    const endTimeInSeconds = toSec(eventEndTime);

    const startPosition = scale(startTimeInSeconds, startSecs, endSecs, 0, 1);
    const endPosition = scale(endTimeInSeconds, startSecs, endSecs, 0, 1);

    return {
      event,
      startTime: eventStartTime,
      endTime: eventEndTime,
      endPosition,
      startPosition,
      time: startTimeInSeconds,
      secondsSinceStart: startTimeInSeconds - startSecs,
    };
  });
}

const selectEventFetchCount = (store: EventsStore) => store.eventFetchCount;
const selectEvents = (store: EventsStore) => store.events;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSetEventsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setEventsAtHoverValue;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;

/**
 * Syncs events from server and syncs hovered event with hovered time.
 */
export function EventsSyncAdapter(): ReactNull {
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();
  const setEvents = useEvents(selectSetEvents);
  const setEventsAtHoverValue = useTimelineInteractionState(selectSetEventsAtHoverValue);
  const hoverValue = useHoverValue();
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const events = useEvents(selectEvents);
  const eventFetchCount = useEvents(selectEventFetchCount);

  const timeRange = useMemo(() => {
    if (!startTime || !endTime) {
      return undefined;
    }

    return toSec(subtract(endTime, startTime));
  }, [endTime, startTime]);

  // const currentUserPresent = currentUser != undefined;

  // Sync events with console API.
  const [_events, syncEvents] = useAsyncFn(async () => {
    // Compare start and end time to avoid a redundant fetch as the
    // datasource bootstraps through the state where they are not
    // completely determined.

    const parent = `warehouses/${urlState?.parameters?.warehousesId}/projects/${urlState?.parameters?.projectId}`;

    const recordId = urlState?.parameters?.recordsId;

    if (parent && recordId && startTime && endTime) {
      try {
        const eventList = await consoleApi.getEvents({ parent, recordId });
        setEvents({ loading: false, value: positionEvents(eventList, startTime, endTime) });
      } catch (error) {
        log.error(error);
        setEvents({ loading: false, error });
      }
    }
  }, [consoleApi, endTime, setEvents, startTime, urlState?.parameters]);

  useEffect(() => {
    syncEvents().catch((error) => log.error(error));
  }, [syncEvents, eventFetchCount]);

  // Sync hovered value and hovered events.
  useEffect(() => {
    if (hoverValue && timeRange != undefined && timeRange > 0) {
      const hoverPosition = scale(hoverValue.value, 0, timeRange, 0, 1);
      const hoveredEvents = (events.value ?? []).filter((event) => {
        return (
          hoverPosition >= event.startPosition * (1 - HOVER_TOLERANCE) &&
          hoverPosition <= event.endPosition * (1 + HOVER_TOLERANCE)
        );
      });
      setEventsAtHoverValue(hoveredEvents);
    } else {
      setEventsAtHoverValue([]);
    }
  }, [hoverValue, setEventsAtHoverValue, timeRange, events]);

  return ReactNull;
}
