// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Stack, Typography, alpha } from "@mui/material";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef } from "react";
import { makeStyles } from "tss-react/mui";

import { toDate } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  useEvents,
  EventsStore,
  TimelinePositionedEvent,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectSetHoveredEvent = (store: TimelineInteractionStateStore) => store.setHoveredEvent;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;
const selectLoopedEvent = (store: TimelineInteractionStateStore) => store.loopedEvent;

const useStyles = makeStyles()((theme, _params) => ({
  momentMain: {
    cursor: "pointer",
    wordBreak: "break-all",
    backgroundColor: theme.palette.background.default,
    border: `1px solid rgba(0, 0, 0, 0)`,
  },
  momentDisplayName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  momentImage: {
    width: "28px",
    height: "18px",
    display: "block",
  },
  container: {
    backgroundColor: theme.palette.background.paper,
  },
  eventSelected: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.activatedOpacity),
  },
  eventHovered: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
    border: `1px solid ${theme.palette.info.main}`,
  },
}));

const SingleMomentView: ({
  event,
  isHovered,
  isSelected,
  onClick,
  onHoverStart,
  onHoverEnd,
}: {
  event: TimelinePositionedEvent;
  isHovered: boolean;
  isSelected: boolean;
  onClick: (event: TimelinePositionedEvent) => void;
  onHoverStart: (event: TimelinePositionedEvent) => void;
  onHoverEnd: (event: TimelinePositionedEvent) => void;
}) => JSX.Element = ({ event, isHovered, isSelected, onClick, onHoverStart, onHoverEnd }) => {
  const { classes, cx } = useStyles();
  const scrollRef = useRef<HTMLDivElement>(ReactNull);

  useEffect(() => {
    if (isSelected || isHovered) {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView();
      }
    }
  }, [isSelected, isHovered]);

  const currentEvent = event;
  return (
    <div ref={scrollRef}>
      <Stack
        height="46px"
        padding="2px"
        paddingRight="8px"
        borderRadius="4px"
        display="flex"
        flexDirection="row"
        width="160px"
        minWidth="160px"
        className={cx(classes.momentMain, {
          [classes.eventSelected]: isSelected,
          [classes.eventHovered]: isHovered,
        })}
        onClick={() => {
          onClick(event);
        }}
        onMouseEnter={() => {
          onHoverStart(event);
        }}
        onMouseLeave={() => {
          onHoverEnd(event);
        }}
      >
        <Stack
          width="2px"
          borderRadius="1px"
          height={1}
          marginRight="8px"
          style={{ backgroundColor: currentEvent.color }}
        />
        <Stack justifyContent="space-between" flex={1} width="0">
          <Stack flex={1} flexDirection="row" justifyContent="center" alignContent="center">
            <Typography
              variant="button"
              display="block"
              className={classes.momentDisplayName}
              gutterBottom
            >
              {currentEvent.event.displayName}
            </Typography>
            {currentEvent.imgUrl && (
              <img className={classes.momentImage} src={currentEvent.imgUrl} />
            )}
          </Stack>
          <Stack flex={1} justifyContent="center" flexDirection="column-reverse">
            <Typography variant="caption" display="block" gutterBottom>
              {dayjs(toDate(currentEvent.startTime)).format("HH:mm:ss")}
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </div>
  );
};

export default function MomentsList({
  events,
}: {
  events: TimelinePositionedEvent[];
}): JSX.Element {
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const loopedEvent = useTimelineInteractionState(selectLoopedEvent);
  const selectedEventId = useEvents(selectSelectedEventId);
  const seek = useMessagePipeline(selectSeek);
  const selectEvent = useEvents(selectSelectEvent);

  const { classes } = useStyles();

  const onHoverEnd = useCallback(() => {
    setHoveredEvent(undefined);
  }, [setHoveredEvent]);

  const onHoverStart = useCallback(
    (event: TimelinePositionedEvent) => {
      setHoveredEvent(event);
    },
    [setHoveredEvent],
  );

  const onClick = useCallback(
    (event: TimelinePositionedEvent) => {
      if (event.event.name === selectedEventId) {
        selectEvent(undefined);
      } else {
        selectEvent(event.event.name);
      }

      if (seek) {
        seek(event.startTime);
      }
    },
    [seek, selectEvent, selectedEventId],
  );

  return events.length > 0 ? (
    <Stack
      width={1}
      display="flex"
      flexDirection="row"
      gap="8px"
      paddingBottom="4px"
      overflow="auto"
      className={classes.container}
    >
      {events.map((event) => {
        const isHovered =
          (hoveredEvent != undefined && event.event.name === hoveredEvent.event.name) ||
          eventsAtHoverValue[event.event.name] != undefined ||
          loopedEvent?.event.name === event.event.name;

        return (
          <SingleMomentView
            event={event}
            key={event.event.name}
            isHovered={isHovered}
            isSelected={event.event.name === selectedEventId}
            onClick={onClick}
            onHoverStart={onHoverStart}
            onHoverEnd={onHoverEnd}
          />
        );
      })}
    </Stack>
  ) : (
    <></>
  );
}
