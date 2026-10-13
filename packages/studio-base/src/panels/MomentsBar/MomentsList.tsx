// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Stack, Typography, alpha } from "@mui/material";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { makeStyles } from "tss-react/mui";

import { toDate } from "@foxglove/rostime";
import { WindowedList } from "@foxglove/studio-base/components/Events/WindowedList";
import { useMomentHover } from "@foxglove/studio-base/components/Events/useMomentHover";
import { useMomentScrollTarget } from "@foxglove/studio-base/components/Events/useMomentScrollTarget";
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

const SingleMomentView = memo(function SingleMomentView({
  event,
  onClick,
}: {
  event: TimelinePositionedEvent;
  onClick: (event: TimelinePositionedEvent) => void;
}) {
  const { classes, cx } = useStyles();
  const name = event.event.name;
  const { onHoverStart, onHoverEnd } = useMomentHover();
  const isHovered = useTimelineInteractionState(
    useCallback(
      (store: TimelineInteractionStateStore) =>
        store.hoveredEvent?.event.name === name ||
        store.eventsAtHoverValue[name] != undefined ||
        store.loopedEvent?.event.name === name,
      [name],
    ),
  );
  const isSelected = useEvents(
    useCallback((store: EventsStore) => store.selectedEventId === name, [name]),
  );
  const currentEvent = event;
  return (
    <div>
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
          onHoverEnd();
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
});

export default function MomentsList({
  events,
}: {
  events: TimelinePositionedEvent[];
}): React.JSX.Element {
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const loopedEvent = useTimelineInteractionState(selectLoopedEvent);
  const selectedEventId = useEvents(selectSelectedEventId);
  const seek = useMessagePipeline(selectSeek);
  const selectEvent = useEvents(selectSelectEvent);

  const { classes } = useStyles();
  const [disabledScroll, setDisabledScroll] = useState(false);
  const pointerInside = useRef(false);
  const selectedRef = useRef(selectedEventId);
  selectedRef.current = selectedEventId;

  useEffect(() => {
    if (events.length === 0) {
      // Removing the hovered container does not dispatch mouseleave.
      pointerInside.current = false;
      setDisabledScroll(false);
    }
  }, [events.length]);

  const onClick = useCallback(
    (event: TimelinePositionedEvent) => {
      if (event.event.name === selectedRef.current) {
        selectEvent(undefined);
      } else {
        selectEvent(event.event.name);
      }

      if (seek) {
        seek(event.startTime);
      }
    },
    [seek, selectEvent],
  );

  const items = useMemo(
    () =>
      events.map((event, index) => ({
        key: event.event.name,
        estimatedSize: index === events.length - 1 ? 160 : 168,
        content: <SingleMomentView event={event} onClick={onClick} />,
      })),
    [events, onClick],
  );
  const order = useMemo(
    () => new Map(events.map((event, index) => [event.event.name, index])),
    [events],
  );
  const hoveredNames = useMemo(() => {
    const names = new Set(Object.keys(eventsAtHoverValue));
    if (hoveredEvent != undefined) {
      names.add(hoveredEvent.event.name);
    }
    if (loopedEvent != undefined) {
      names.add(loopedEvent.event.name);
    }
    return names;
  }, [eventsAtHoverValue, hoveredEvent, loopedEvent]);
  const target = useMomentScrollTarget({
    selected: selectedEventId,
    hovered: hoveredNames,
    order,
    // Store hover updates can commit before the mouse-enter state update.
    disabled: disabledScroll || pointerInside.current,
  });

  return events.length > 0 ? (
    <Stack
      width={1}
      className={classes.container}
      onMouseEnter={() => {
        pointerInside.current = true;
        setDisabledScroll(true);
      }}
      onMouseLeave={() => {
        pointerInside.current = false;
        setDisabledScroll(false);
      }}
    >
      <WindowedList items={items} horizontal scrollRequest={target} />
    </Stack>
  ) : (
    <></>
  );
}
