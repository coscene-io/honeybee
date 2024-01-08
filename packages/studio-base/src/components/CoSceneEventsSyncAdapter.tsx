// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import { useEffect, useMemo, useState } from "react";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, Time, toSec, fromNanoSec, add } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { BagFileInfo } from "@foxglove/studio-base/context/CoScenePlaylistContext";
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
import { SingleFileGetEventsRequest } from "@foxglove/studio-base/services/CoSceneConsoleApi";
import { stringToColor } from "@foxglove/studio-base/util/coscene";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

function positionEvents(
  events: Event[],
  bagFiles: readonly BagFileInfo[],
  timeMode: "relativeTime" | "absoluteTime",
  startTime: Time,
  endTime: Time,
  color: string,
): TimelinePositionedEvent[] {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  events.sort((a, b) => {
    if (!a.triggerTime || !b.triggerTime) {
      return 0;
    }
    return Number(a.triggerTime.seconds - b.triggerTime.seconds);
  });

  return events.map((event) => {
    if (!event.triggerTime) {
      throw new Error("Event does not have a trigger time");
    }

    const bagFile = bagFiles.find((file) => {
      if (!file.startTime || !file.endTime) {
        return false;
      }
      if (file.name.includes(event.record)) {
        return true;
      }
      return false;
    });

    let eventStartTime = fromNanoSec(
      event.triggerTime.seconds * BigInt(1e9) + event.triggerTime.seconds,
    );
    let eventEndTime = add(eventStartTime, fromNanoSec(BigInt(event.duration * 1e9)));

    if (timeMode === "relativeTime" && bagFile?.startTime != undefined) {
      eventStartTime = subtract(eventStartTime, bagFile.startTime);
      eventEndTime = subtract(eventEndTime, bagFile.startTime);
    }

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
      color,
    };
  });
}

const selectEventFetchCount = (store: EventsStore) => store.eventFetchCount;
const selectEvents = (store: EventsStore) => store.events;
const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSetEventsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setEventsAtHoverValue;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;

/**
 * Syncs events from server and syncs hovered event with hovered time.
 */
export function CoSceneEventsSyncAdapter(): ReactNull {
  const consoleApi = useConsoleApi();
  const setEvents = useEvents(selectSetEvents);
  const setEventsAtHoverValue = useTimelineInteractionState(selectSetEventsAtHoverValue);
  const [hoverComponentId] = useState<string>(() => uuidv4());
  const hoverValue = useHoverValue({ componentId: hoverComponentId, isPlaybackSeconds: true });
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const events = useEvents(selectEvents);
  const eventFetchCount = useEvents(selectEventFetchCount);
  const bagFiles = usePlaylist(selectBagFiles);

  const timeRange = useMemo(() => {
    if (!startTime || !endTime) {
      return undefined;
    }

    return toSec(subtract(endTime, startTime));
  }, [endTime, startTime]);

  const timeMode = useMemo(() => {
    return localStorage.getItem("CoScene_timeMode") === "relativeTime"
      ? "relativeTime"
      : "absoluteTime";
  }, []);

  // const currentUserPresent = currentUser != undefined;

  // Sync events with console API.
  const [_events, syncEvents] = useAsyncFn(async () => {
    // Compare start and end time to avoid a redundant fetch as the
    // datasource bootstraps through the state where they are not
    // completely determined.

    if (!bagFiles.loading && bagFiles.value && bagFiles.value.length > 0) {
      const getEventsRequest: SingleFileGetEventsRequest[] = [];
      let color = "#ffffff";

      bagFiles.value.forEach((bagFile) => {
        if (!bagFile.startTime || !bagFile.endTime) {
          return;
        }

        const fileSource = bagFile.name;
        const currentBagStartTime = toSec(bagFile.startTime);
        const currentBagEndTime = toSec(bagFile.endTime);

        if (bagFile.fileType === "GHOST_RESULT_FILE") {
          const projectName = fileSource.split("/workflowRuns/")[0];
          const filter = `record.job_run="${fileSource}"`;

          if (projectName == undefined) {
            throw new Error("wrong source name");
          }

          getEventsRequest.push({
            projectName,
            filter,
            startTime: currentBagStartTime,
            endTime: currentBagEndTime,
          });
        } else {
          const projectName = fileSource.split("/records/")[0];
          const revisionSha256 = fileSource.split("/revisions/")[1]?.split("/files/")[0];
          const recordId = fileSource.split("/records/")[1]?.split("/revisions/")[0];
          const filter = `revision.sha256="${revisionSha256}"`;

          color = stringToColor(recordId ?? "");

          if (projectName == undefined) {
            throw new Error("wrong source name");
          }

          getEventsRequest.push({
            projectName,
            filter,
            startTime: currentBagStartTime,
            endTime: currentBagEndTime,
          });
        }
      });

      if (startTime && endTime) {
        try {
          const eventList = await consoleApi.getEvents({ fileList: getEventsRequest });
          setEvents({
            loading: false,
            value: positionEvents(eventList, bagFiles.value, timeMode, startTime, endTime, color),
          });
        } catch (error) {
          log.error(error);
          setEvents({ loading: false, error });
        }
      }
    }
  }, [bagFiles.loading, bagFiles.value, startTime, endTime, consoleApi, timeMode, setEvents]);

  useEffect(() => {
    syncEvents().catch((error) => {
      log.error(error);
    });
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
