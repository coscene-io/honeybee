// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha, Tooltip } from "@mui/material";
import Fade from "@mui/material/Fade";
import Popper from "@mui/material/Popper";
import * as _ from "lodash-es";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { scaleValue as scale } from "@foxglove/den/math";
import { toSec, add, fromSec } from "@foxglove/rostime";
import { CreateEventContainer } from "@foxglove/studio-base/components/Events/CreateEventContainer/index";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
  TimelinePositionedEventMark,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

import EventMarkIcon from "../../assets/event-mark.svg";

// Hotspot as a percentage of the progress bar
const HOTSPOT_WIDTH_PER_CENT = 0.01;

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
    boxShadow: `0px 8px 20px 0px rgba(0, 0, 0, 0.25);`,
    maxHeight: "calc(100vh - 100px)",
    overflowY: "auto",
  },
}));

const selectEvents = (store: EventsStore) => store.events;
const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectSetEventMarks = (store: EventsStore) => store.setEventMarks;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectSetToModifyEvent = (store: EventsStore) => store.setToModifyEvent;
const selectLoopedEvent = (store: TimelineInteractionStateStore) => store.loopedEvent;

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;

function EventTick({ event }: { event: TimelinePositionedEvent }): React.JSX.Element {
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const selectedEventId = useEvents(selectSelectedEventId);
  const loopedEvent = useTimelineInteractionState(selectLoopedEvent);

  const { classes, cx } = useStyles();

  const left = `calc(${_.clamp(event.startPosition, 0, 1) * 100}% - 1px)`;
  const right = `calc(100% - ${_.clamp(event.endPosition, 0, 1) * 100}% - 1px)`;

  const isHovered =
    (hoveredEvent != undefined && event.event.name === hoveredEvent.event.name) ||
    eventsAtHoverValue[event.event.name] != undefined ||
    loopedEvent?.event.name === event.event.name;

  return (
    <div
      className={cx(classes.tick, {
        [classes.tickHovered]: isHovered,
        [classes.tickSelected]: selectedEventId === event.event.name,
      })}
      style={{ left, right }}
    />
  );
}

const MemoEventTick = React.memo(EventTick);

function EventMark({
  marks,
  isHiddenCreateMomentPopper,
}: {
  marks: TimelinePositionedEventMark[];
  isHiddenCreateMomentPopper: boolean;
}): React.JSX.Element {
  const leftMarkRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const { position: leftMarkPosition } = marks[0] ?? {};
  const { position: rightMarkPosition } = marks[1] ?? {};
  const [anchorEl, setAnchorEl] = useState<ReactNull | HTMLElement>(ReactNull);
  const [open, setOpen] = useState(false);
  const setEventMarks = useEvents(selectSetEventMarks);
  const setToModifyEvent = useEvents(selectSetToModifyEvent);
  const { t } = useTranslation("cosEvent");

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
      <Tooltip
        title={t("startPoint")}
        placement="top"
        open={marks.length === 1}
        slotProps={{
          popper: {
            modifiers: [
              {
                name: "offset",
                options: {
                  // Offset popper to hug the track better.
                  offset: [0, 4],
                },
              },
            ],
          },
        }}
      >
        <div
          ref={leftMarkRef}
          aria-describedby={id}
          style={{
            position: "absolute",
            left: leftMark ?? 0,
          }}
        />
      </Tooltip>
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
        style={{
          opacity: isHiddenCreateMomentPopper ? 0 : 1,
        }}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps}>
            <div className={classes.creatEventContainer}>
              <CreateEventContainer
                onClose={() => {
                  setOpen(false);
                  setTimeout(() => {
                    setEventMarks([]);
                    setToModifyEvent(undefined);
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

type Props = {
  componentId: string;
  isDragging: boolean;
  setCursor: (cursor: string) => void;
};

function UnmemoizedEventsOverlay(props: Props): React.JSX.Element | ReactNull {
  const { componentId, isDragging, setCursor } = props;

  const events = useEvents(selectEvents);
  const { classes } = useStyles();
  const eventMarks = useEvents(selectEventMarks);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);

  const setEventMarks = useEvents(selectSetEventMarks);

  const hoverValue = useHoverValue({ componentId, isPlaybackSeconds: true });

  // 拖拽的起始点，用来判断是否选中某个 mark 以及是否开始拖拽
  const [dragPointKey, setDragPointKey] = useState<string | undefined>(undefined);

  const startSecs = startTime && toSec(startTime);
  const endSecs = endTime && toSec(endTime);

  const hoverTimePosition =
    hoverValue && endSecs != undefined && startSecs != undefined
      ? scale(hoverValue.value, 0, endSecs - startSecs, 0, 1)
      : undefined;

  const [leftMark, rightMark] = eventMarks;

  const [isHiddenCreateMomentPopper, setIsHiddenCreateMomentPopper] = useState(false);

  // set cursor style
  useEffect(() => {
    if (
      (hoverTimePosition != undefined &&
        ((leftMark != undefined &&
          Math.abs(hoverTimePosition - leftMark.position) < HOTSPOT_WIDTH_PER_CENT) ||
          (rightMark != undefined &&
            Math.abs(hoverTimePosition - rightMark.position) < HOTSPOT_WIDTH_PER_CENT))) ||
      isDragging
    ) {
      setCursor("ew-resize");
    } else {
      setCursor("pointer");
    }
  }, [hoverTimePosition, isDragging, leftMark, rightMark, setCursor]);

  // Determine the mark of a drag and drop
  useEffect(() => {
    if (isDragging) {
      const leftPointGap =
        hoverTimePosition != undefined && leftMark != undefined
          ? Math.abs(hoverTimePosition - leftMark.position)
          : undefined;

      const rightPointGap =
        hoverTimePosition != undefined && rightMark != undefined
          ? Math.abs(hoverTimePosition - rightMark.position)
          : undefined;

      if (
        leftMark &&
        leftPointGap != undefined &&
        leftPointGap < HOTSPOT_WIDTH_PER_CENT &&
        (rightPointGap == undefined || leftPointGap <= rightPointGap)
      ) {
        setDragPointKey(leftMark.key);
        setIsHiddenCreateMomentPopper(true);
      } else if (
        rightMark &&
        rightPointGap != undefined &&
        rightPointGap < HOTSPOT_WIDTH_PER_CENT &&
        (leftPointGap == undefined || rightPointGap < leftPointGap)
      ) {
        setDragPointKey(rightMark.key);
        setIsHiddenCreateMomentPopper(true);
      } else {
        setDragPointKey(undefined);
        setIsHiddenCreateMomentPopper(false);
      }
    } else {
      setDragPointKey(undefined);
      setIsHiddenCreateMomentPopper(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  useEffect(() => {
    if (dragPointKey != undefined) {
      const targetMark = eventMarks.find((mark) => mark.key === dragPointKey);
      if (targetMark && hoverValue && startTime && hoverTimePosition != undefined) {
        setEventMarks(
          [
            ...eventMarks.filter((mark) => mark.key !== dragPointKey),
            {
              ...targetMark,
              time: add(startTime, fromSec(hoverValue.value)),
              position: hoverTimePosition,
            },
          ].sort((a, b) => a.position - b.position),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragPointKey, hoverTimePosition, hoverValue, setEventMarks, startTime]);

  return (
    <div className={classes.root}>
      {(events.value ?? []).map((event) => (
        <MemoEventTick key={event.event.name} event={event} />
      ))}
      <MemoEventMark marks={eventMarks} isHiddenCreateMomentPopper={isHiddenCreateMomentPopper} />
    </div>
  );
}

export const EventsOverlay = React.memo(UnmemoizedEventsOverlay);
