// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BinaryOperator, CosQuery, SerializeOption } from "@coscene-io/coscene/cosel";
import { QueryFields } from "@coscene-io/coscene/queries";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { useEffect, useMemo, useState } from "react";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, Time, toSec, fromNanoSec, add } from "@foxglove/rostime";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  EventsStore,
  TimelinePositionedEvent,
  TimelinePositionedEventMark,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import CoSceneConsoleApi, {
  SingleFileGetEventsRequest,
  EventList,
} from "@foxglove/studio-base/services/CoSceneConsoleApi";
import { stringToColor } from "@foxglove/studio-base/util/coscene";
import { ducationToNanoSeconds } from "@foxglove/studio-base/util/time";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

async function positionEvents(
  events: EventList,
  bagFiles: readonly BagFileInfo[],
  timeMode: "relativeTime" | "absoluteTime",
  startTime: Time,
  endTime: Time,
  api: CoSceneConsoleApi,
): Promise<TimelinePositionedEvent[]> {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  const fullEvents = await Promise.all(
    events.map(async (eventInfo) => {
      const event = eventInfo.event;
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
        event.triggerTime.seconds * BigInt(1e9) + BigInt(event.triggerTime.nanos),
      );
      let eventEndTime = add(eventStartTime, fromNanoSec(ducationToNanoSeconds(event.duration)));

      if (timeMode === "relativeTime" && bagFile?.startTime != undefined) {
        eventStartTime = subtract(eventStartTime, bagFile.startTime);
        eventEndTime = subtract(eventEndTime, bagFile.startTime);
      }

      const startTimeInSeconds = toSec(eventStartTime);
      const endTimeInSeconds = toSec(eventEndTime);

      const startPosition = scale(startTimeInSeconds, startSecs, endSecs, 0, 1);
      const endPosition = scale(endTimeInSeconds, startSecs, endSecs, 0, 1);

      let imgUrl;
      const imgFileName = event.files[0];

      if (imgFileName != undefined) {
        const imgFile = new File({
          name: imgFileName,
        });

        const res = await api.generateFileDownloadUrl({ file: imgFile });

        imgUrl = res.preSignedUrl;
      }

      return {
        event,
        startTime: eventStartTime,
        endTime: eventEndTime,
        endPosition,
        startPosition,
        time: startTimeInSeconds,
        secondsSinceStart: startTimeInSeconds - startSecs,
        color: stringToColor(event.record),
        imgUrl,
        recordDisplayName: eventInfo.recordDisplayName,
        projectDisplayName: eventInfo.projectDisplayName,
      };
    }),
  );

  return fullEvents.sort((a, b) => a.startPosition - b.startPosition);
}

function positionEventMarks({
  currentTime,
  startTime,
  endTime,
}: {
  currentTime: Time;
  startTime: Time;
  endTime: Time;
}): TimelinePositionedEventMark {
  const uuid = uuidv4();

  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  const currentTimeInSeconds = toSec(currentTime);

  const currentTimePosition = scale(currentTimeInSeconds, startSecs, endSecs, 0, 1);

  return {
    time: currentTime,
    position: currentTimePosition,
    key: uuid,
  };
}

const selectEventFetchCount = (store: EventsStore) => store.eventFetchCount;
const selectEvents = (store: EventsStore) => store.events;
const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSetEventsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setEventsAtHoverValue;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectSetEventMarks = (store: EventsStore) => store.setEventMarks;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;

/**
 * Syncs events from server and syncs hovered event with hovered time.
 */
export function CoSceneEventsSyncAdapter(): JSX.Element {
  const consoleApi = useConsoleApi();
  const setEvents = useEvents(selectSetEvents);
  const setEventsAtHoverValue = useTimelineInteractionState(selectSetEventsAtHoverValue);
  const eventMarks = useEvents(selectEventMarks);
  const setEventMarks = useEvents(selectSetEventMarks);
  const [hoverComponentId] = useState<string>(() => uuidv4());
  const hoverValue = useHoverValue({ componentId: hoverComponentId, isPlaybackSeconds: true });
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const events = useEvents(selectEvents);
  const eventFetchCount = useEvents(selectEventFetchCount);
  const bagFiles = usePlaylist(selectBagFiles);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const pause = useMessagePipeline(selectPause);

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

  // Sync events with console API.
  const [_events, syncEvents] = useAsyncFn(async () => {
    // Compare start and end time to avoid a redundant fetch as the
    // datasource bootstraps through the state where they are not
    // completely determined.

    if (!bagFiles.loading && bagFiles.value && bagFiles.value.length > 0) {
      const getEventsRequest: SingleFileGetEventsRequest[] = [];

      bagFiles.value.forEach((bagFile) => {
        if (!bagFile.startTime || !bagFile.endTime) {
          return;
        }

        const fileSource = bagFile.name;
        const currentBagStartTime = toSec(bagFile.startTime);
        const currentBagEndTime = toSec(bagFile.endTime);

        if (bagFile.fileType === "GHOST_RESULT_FILE") {
          const projectName = fileSource.split("/workflowRuns/")[0];
          const jubRunName = fileSource.split("/outputs/")[0];
          const filter = `record.job_run="${jubRunName}"`;

          if (projectName == undefined) {
            throw new Error("wrong source name");
          }

          getEventsRequest.push({
            projectName,
            filter,
            startTime: currentBagStartTime,
            endTime: currentBagEndTime,
            projectDisplayName: bagFile.projectDisplayName ?? "",
            recordDisplayName: bagFile.recordDisplayName ?? "",
          });
        } else {
          const projectName = fileSource.split("/records/")[0];
          const recordId = fileSource.split("/files/")[0]?.split("/").pop();
          const defaultFilter = CosQuery.Companion.empty();

          if (projectName == undefined) {
            throw new Error("wrong source name");
          }

          if (recordId == undefined) {
            throw new Error("wrong recordId");
          }

          defaultFilter.setField(QueryFields.RECORD_DOT_ID, [BinaryOperator.EQ], [recordId]);
          defaultFilter.setField(QueryFields.RECORD_JOB_RUN, [BinaryOperator.EQ], ["null"]);
          getEventsRequest.push({
            projectName,
            filter: defaultFilter.toQueryString(new SerializeOption(false)),
            startTime: currentBagStartTime,
            endTime: currentBagEndTime,
            projectDisplayName: bagFile.projectDisplayName ?? "",
            recordDisplayName: bagFile.recordDisplayName ?? "",
          });
        }
      });

      if (startTime && endTime) {
        try {
          const eventList = await consoleApi.getEvents({ fileList: getEventsRequest });
          setEvents({
            loading: false,
            value: await positionEvents(
              eventList,
              bagFiles.value,
              timeMode,
              startTime,
              endTime,
              consoleApi,
            ),
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

  const { keyDownHandlers } = useMemo(
    () => ({
      keyDownHandlers: {
        Digit1: (e: KeyboardEvent) => {
          if (e.altKey && currentTime && startTime && endTime && eventMarks.length < 2) {
            // Pause playback when the second marker is added
            if (eventMarks.length === 1 && pause) {
              pause();
            }

            setEventMarks(
              [...eventMarks, positionEventMarks({ currentTime, startTime, endTime })].sort(
                (a, b) => a.position - b.position,
              ),
            );
          }
        },
      },
    }),
    [currentTime, endTime, eventMarks, pause, setEventMarks, startTime],
  );

  return <KeyListener global keyDownHandlers={keyDownHandlers} />;
}
