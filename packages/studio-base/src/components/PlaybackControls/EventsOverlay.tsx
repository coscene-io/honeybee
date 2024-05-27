// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import Fade from "@mui/material/Fade";
import Popper from "@mui/material/Popper";
import * as _ from "lodash-es";
import { useEffect, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { CoSceneCreateEventContainer } from "@foxglove/studio-base/components/CoSceneCreateEventContainer";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
  TimelinePositionedEventMark,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

import EventMarkIcon from "../../assets/event-mark.svg";

const useStyles = makeStyles()(({ transitions, palette }) => ({
  root: {
    inset: 0,
    pointerEvents: "none",
    position: "absolute",
    display: "flex",
    alignItems: "center",
  },
  tick: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundBlendMode: "overlay",
    backgroundColor: alpha(palette.info.main, 0.58),
    position: "absolute",
    height: 6,
  },
  leftMark: {
    position: "absolute",
    transform: "translate(-5px, -15px)",
  },
  rightMark: {
    position: "absolute",
    transform: "scaleX(-1) translate(0px, -15px)",
  },
  markGap: {
    height: "23px",
    top: "1px",
    position: "absolute",
    backgroundColor: alpha(palette.info.main, 0.58),
  },
  tickHovered: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundColor: alpha(palette.info.main, 0.58),
    border: `1px solid ${palette.info.main}`,
    height: 12,
  },
  tickSelected: {
    transition: transitions.create("height", {
      duration: transitions.duration.shortest,
    }),
    backgroundColor: alpha(palette.info.main, 0.67),
    height: 12,
  },
  creatEventContainer: {
    backgroundColor: palette.background.paper,
    marginBottom: "35px",
  },
}));

const selectEvents = (store: EventsStore) => store.events;
const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectSetEventMarks = (store: EventsStore) => store.setEventMarks;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;

function EventTick({ event }: { event: TimelinePositionedEvent }): JSX.Element {
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const selectedEventId = useEvents(selectSelectedEventId);
  const { classes, cx } = useStyles();

  const left = `calc(${_.clamp(event.startPosition, 0, 1) * 100}% - 1px)`;
  const right = `calc(100% - ${_.clamp(event.endPosition, 0, 1) * 100}% - 1px)`;

  return (
    <div
      className={cx(classes.tick, {
        [classes.tickHovered]: hoveredEvent
          ? event.event.name === hoveredEvent.event.name
          : eventsAtHoverValue[event.event.name] != undefined,
        [classes.tickSelected]: selectedEventId === event.event.name,
      })}
      style={{ left, right }}
    />
  );
}

const MemoEventTick = React.memo(EventTick);

function EventMark({ marks }: { marks: TimelinePositionedEventMark[] }): JSX.Element {
  const leftMarkRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const { position: leftMarkPosition } = marks[0] ?? {};
  const { position: rightMarkPosition } = marks[1] ?? {};
  const [anchorEl, setAnchorEl] = useState<ReactNull | HTMLElement>(ReactNull);
  const [open, setOpen] = useState(false);
  const setEventMarks = useEvents(selectSetEventMarks);

  const leftMark =
    leftMarkPosition != undefined ? `${_.clamp(leftMarkPosition, 0, 1) * 100}%` : undefined;
  const rightMark =
    rightMarkPosition != undefined ? `${_.clamp(rightMarkPosition, 0, 1) * 100}%` : undefined;

  const gapWidth =
    rightMarkPosition != undefined && leftMarkPosition != undefined
      ? `${_.clamp(rightMarkPosition - leftMarkPosition, 0, 1) * 100}%`
      : undefined;

  const { classes } = useStyles();

  useEffect(() => {
    if (marks.length === 2) {
      setOpen(true);
      setAnchorEl(leftMarkRef.current);
    }
  }, [marks]);

  const id = open ? "simple-popper" : undefined;

  return (
    <div>
      <div
        ref={leftMarkRef}
        aria-describedby={id}
        style={{
          position: "absolute",
          left: leftMark ?? 0,
        }}
      />
      {leftMark && (
        <>
          <EventMarkIcon
            style={{
              left: leftMark,
            }}
            className={classes.leftMark}
          />
        </>
      )}
      {gapWidth && (
        <div
          className={classes.markGap}
          style={{
            width: gapWidth,
            left: leftMark,
          }}
        />
      )}
      {rightMark && (
        <EventMarkIcon
          style={{
            left: rightMark,
          }}
          className={classes.rightMark}
        />
      )}
      <Popper
        placement="top-start"
        open={open}
        anchorEl={anchorEl}
        transition
        id="event-mark-popper"
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={350}>
            <div className={classes.creatEventContainer}>
              <CoSceneCreateEventContainer
                onClose={() => {
                  setOpen(false);
                  setTimeout(() => {
                    setEventMarks([]);
                  }, 400);
                }}
              />
            </div>
          </Fade>
        )}
      </Popper>
    </div>
  );
}

const MemoEventMark = React.memo(EventMark);

export function EventsOverlay(): JSX.Element {
  const events = useEvents(selectEvents);
  const { classes } = useStyles();
  const eventMarks = useEvents(selectEventMarks);

  return (
    <div className={classes.root}>
      {(events.value ?? []).map((event) => (
        <MemoEventTick key={event.event.name} event={event} />
      ))}
      <MemoEventMark marks={eventMarks} />
    </div>
  );
}
