// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { alpha, Menu, MenuItem, type PopoverPosition, Tooltip } from "@mui/material";
import Fade from "@mui/material/Fade";
import Popper from "@mui/material/Popper";
import * as _ from "lodash-es";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useResizeDetector } from "react-resize-detector";
import { makeStyles } from "tss-react/mui";

import { add, areEqual, fromSec, subtract, toSec } from "@foxglove/rostime";
import { CreateEventContainer } from "@foxglove/studio-base/components/Events/CreateEventContainer/index";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { type EventContextMenuRequest } from "@foxglove/studio-base/components/PlaybackControls/Scrubber";
import { getSnappedEventMark } from "@foxglove/studio-base/components/PlaybackControls/eventSnap";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  type EventsStore,
  type TimelinePositionedEvent,
  type TimelinePositionedEventMark,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import {
  type TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { durationToSeconds } from "@foxglove/studio-base/util/time";

import { EVENT_LANE_HEIGHT_PX } from "./constants";
import { LaneSnapCache, snapRangeToLaneBoundaries } from "./eventLaneSnap";
import {
  getEventLaneRenderStyle,
  indexEventLanes,
  reuseEventLaneItems,
  getCachedEventLaneLayout,
  EVENT_BAR_HEIGHT_PX,
  type EventLaneLayout,
  type EventLaneLayoutItem,
} from "./eventLanes";
import {
  buildRollingEditUpdates,
  clampRollingEditBoundary,
  findRollingEditPairs,
  ROLLING_EDIT_HANDLE_HITBOX_PX,
  type RollingEditPair,
} from "./eventRollingEdit";
import {
  buildEventTimeUpdate,
  calculateBodyDragRange,
  calculateResizeRange,
  createBodyDragAnchor,
  type BodyDragAnchor,
  type EventResizeEdge,
  type EventTimeRange,
} from "./eventTimeEdit";
import { EMPTY_EVENTS, getEventTimeIndex } from "./eventTimeIndex";
import { frameInput } from "./frameInput";
import { SHORTCUTS } from "./keyboardShortcuts";
import {
  clientXToFraction,
  clientXToTime,
  timeToFraction,
  timelinePointToPercent,
  type TimelineViewport,
} from "./timelineViewport";
import { useVisibleEventLanes } from "./useVisibleEventLanes";
import EventCreateInactiveIcon from "../../assets/event-create-inactive.svg";
import EventMarkIcon from "../../assets/event-mark.svg";

const HOTSPOT_WIDTH_PER_CENT = 0.01;
const EVENT_CLICK_DRAG_THRESHOLD_PX = 4;
const EVENT_MARK_TOOLTIP_AUTO_HIDE_MS = 3_000;

const useStyles = makeStyles()(({ transitions, palette }) => ({
  root: {
    inset: 0,
    pointerEvents: "none",
    position: "absolute",
    overflow: "hidden",
  },
  laneContent: {
    // Keep the app's border-box sizing explicit for bars and rolling-edit handles.
    // Inheritance makes Blink repeat costly descendant style work during movement.
    boxSizing: "border-box",
    "& *, &::before, &::after, & *::before, & *::after": {
      boxSizing: "border-box",
    },
    left: 0,
    position: "absolute",
    right: 0,
  },
  tick: {
    alignItems: "center",
    backgroundBlendMode: "overlay",
    backgroundColor: "#BAE0FF",
    border: "1px solid transparent",
    borderRadius: 6,
    color: palette.getContrastText("#BAE0FF"),
    cursor: "grab",
    display: "flex",
    fontSize: 12,
    fontWeight: 400,
    lineHeight: "20px",
    minHeight: EVENT_BAR_HEIGHT_PX,
    overflow: "hidden",
    padding: "0 8px",
    pointerEvents: "auto",
    position: "absolute",
    transition: transitions.create(["background-color", "border-color"], {
      duration: transitions.duration.shortest,
    }),
    userSelect: "none",
  },
  tickHovered: {
    borderColor: "#2563EB",
  },
  tickSelected: {
    borderColor: "#2563EB",
  },
  rollingEditPreview: {
    backgroundColor: alpha(palette.warning.main, 0.24),
    border: `1px solid ${palette.warning.main}`,
  },
  tickDragging: {
    cursor: "grabbing",
  },
  laneRow: {
    backgroundColor: "rgba(0, 0, 0, 0.02)",
    height: EVENT_LANE_HEIGHT_PX,
    left: 0,
    position: "absolute",
    right: 0,
  },
  emptyEventHint: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.02)",
    color: palette.text.disabled,
    display: "flex",
    fontSize: 14,
    fontWeight: 400,
    gap: 4,
    height: EVENT_LANE_HEIGHT_PX,
    left: 0,
    lineHeight: "22px",
    overflow: "hidden",
    paddingInline: 6,
    position: "absolute",
    right: 0,
    top: 0,
  },
  emptyEventHintIcon: {
    color: "currentColor",
    display: "inline-flex",
    flex: "0 0 auto",
    fontSize: 16,
  },
  emptyEventHintText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tickLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  edgeHandle: {
    bottom: 0,
    cursor: "ew-resize",
    pointerEvents: "auto",
    position: "absolute",
    top: 0,
    width: 10,
  },
  edgeHandleStart: {
    left: 0,
  },
  edgeHandleEnd: {
    right: 0,
  },
  edgeHandleLine: {
    backgroundColor: "#2563EB",
    borderRadius: 1,
    bottom: 3,
    opacity: 0,
    position: "absolute",
    top: 3,
    width: 2,
  },
  edgeHandleLineStart: {
    left: 2,
  },
  edgeHandleLineEnd: {
    right: 2,
  },
  edgeHandleLineVisible: {
    opacity: 1,
  },
  rollingEditHandle: {
    pointerEvents: "auto",
    position: "absolute",
    width: ROLLING_EDIT_HANDLE_HITBOX_PX,
    height: EVENT_BAR_HEIGHT_PX,
    transform: "translateX(-50%)",
    cursor: "ew-resize",
  },
  rollingEditHandleLine: {
    position: "absolute",
    left: "50%",
    top: 2,
    bottom: 2,
    width: 2,
    transform: "translateX(-50%)",
    borderRadius: 1,
    backgroundColor: palette.warning.main,
  },
  markLayer: {
    bottom: 0,
    left: 0,
    pointerEvents: "none",
    position: "absolute",
    right: 0,
    top: 0,
  },
  markAnchor: {
    height: 0,
    position: "absolute",
    top: 0,
    width: 0,
  },
  markIcon: {
    display: "block",
    lineHeight: 0,
    position: "absolute",
    top: 0,
    zIndex: 3,
  },
  leftMark: {
    transform: "translate(-5px, -12px)",
  },
  rightMark: {
    transform: "scaleX(-1) translate(0, -12px)",
  },
  markLine: {
    backgroundColor: "#2563EB",
    borderRadius: 1,
    bottom: 0,
    position: "absolute",
    top: 0,
    transform: "translateX(-50%)",
    width: 2,
    zIndex: 2,
  },
  markRange: {
    backgroundColor: alpha(palette.info.main, 0.24),
    bottom: 0,
    position: "absolute",
    top: 0,
    zIndex: 1,
  },
  createEventContainer: {
    backgroundColor: palette.background.paper,
    marginBottom: 35,
    boxShadow: "0px 8px 20px 0px rgba(0, 0, 0, 0.25)",
    maxHeight: "calc(100vh - 100px)",
    overflowY: "auto",
  },
}));

const selectEvents = (store: EventsStore) => store.events;
const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectEvent = (store: EventsStore) => store.selectEvent;
const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSetEventMarks = (store: EventsStore) => store.setEventMarks;
const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;
const selectSetToModifyEvent = (store: EventsStore) => store.setToModifyEvent;
const selectLoopedEvent = (store: TimelineInteractionStateStore) => store.loopedEvent;
const selectSetLoopedEvent = (store: TimelineInteractionStateStore) => store.setLoopedEvent;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref != undefined) {
        (ref as React.MutableRefObject<T | ReactNull>).current = value;
      }
    }
  };
}

type EventTickClasses = {
  states: string[];
  label: string;
  startHandle: string;
  endHandle: string;
  startLine: string;
  endLine: string;
  startLineVisible: string;
  endLineVisible: string;
};

function EventTick({
  tickClasses,
  forceHovered = false,
  isDragging,
  isPreview = false,
  item,
  onBodyPointerDown,
  onEdgePointerDown,
}: {
  tickClasses: EventTickClasses;
  forceHovered?: boolean;
  isDragging: boolean;
  isPreview?: boolean;
  item: EventLaneLayoutItem;
  onBodyPointerDown: (event: React.PointerEvent<HTMLDivElement>, item: EventLaneLayoutItem) => void;
  onEdgePointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    edge: EventResizeEdge,
    item: EventLaneLayoutItem,
  ) => void;
}): React.JSX.Element {
  const eventName = item.event.event.name;
  const isHovered = useTimelineInteractionState(
    useCallback(
      (store: TimelineInteractionStateStore) =>
        forceHovered ||
        store.hoveredEvent?.event.name === eventName ||
        store.eventsAtHoverValue[eventName] != undefined ||
        store.loopedEvent?.event.name === eventName,
      [eventName, forceHovered],
    ),
  );
  const isSelected = useEvents(
    useCallback((store: EventsStore) => store.selectedEventId === eventName, [eventName]),
  );
  const showEdges = isHovered || isSelected || isDragging;

  return (
    <div
      className={
        tickClasses.states[
          (isHovered ? 1 : 0) | (isSelected ? 2 : 0) | (isDragging ? 4 : 0) | (isPreview ? 8 : 0)
        ]
      }
      style={getEventLaneRenderStyle(item)}
      data-testid="timeline-event"
      data-event-name={eventName}
      onPointerDown={(event) => {
        onBodyPointerDown(event, item);
      }}
    >
      <span className={tickClasses.label}>{item.event.event.displayName || eventName}</span>
      <div
        className={tickClasses.startHandle}
        data-testid="timeline-event-start-handle"
        onPointerDown={(event) => {
          onEdgePointerDown(event, "start", item);
        }}
      >
        <div className={showEdges ? tickClasses.startLineVisible : tickClasses.startLine} />
      </div>
      <div
        className={tickClasses.endHandle}
        data-testid="timeline-event-end-handle"
        onPointerDown={(event) => {
          onEdgePointerDown(event, "end", item);
        }}
      >
        <div className={showEdges ? tickClasses.endLineVisible : tickClasses.endLine} />
      </div>
    </div>
  );
}

const MemoEventTick = React.memo(EventTick);

function formatPercent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(6))}%`;
}

function getEventMarkRangeStyle(
  leftMarkPosition: number | undefined,
  rightMarkPosition: number | undefined,
  viewport: TimelineViewport,
): React.CSSProperties | undefined {
  if (leftMarkPosition == undefined || rightMarkPosition == undefined) {
    return undefined;
  }

  const leftFraction = timeToFraction(leftMarkPosition, viewport);
  const rightFraction = timeToFraction(rightMarkPosition, viewport);
  if (!Number.isFinite(leftFraction) || !Number.isFinite(rightFraction)) {
    return undefined;
  }

  const rangeStart = Math.min(leftFraction, rightFraction);
  const rangeEnd = Math.max(leftFraction, rightFraction);
  if (rangeEnd < 0 || rangeStart > 1) {
    return undefined;
  }

  const visibleStart = _.clamp(rangeStart, 0, 1);
  const visibleEnd = _.clamp(rangeEnd, 0, 1);

  return {
    left: formatPercent(visibleStart),
    width: formatPercent(Math.max(visibleEnd - visibleStart, 0)),
  };
}

function EventMark({
  marks,
  isHiddenCreateEventPopper,
  timelineStartSec,
  viewport,
}: {
  marks: TimelinePositionedEventMark[];
  isHiddenCreateEventPopper: boolean;
  timelineStartSec: number | undefined;
  viewport: TimelineViewport;
}): React.JSX.Element {
  const leftMarkRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | ReactNull>(ReactNull);
  const [open, setOpen] = useState(false);
  const [isMarkTooltipOpen, setIsMarkTooltipOpen] = useState(false);
  const setEventMarks = useEvents(selectSetEventMarks);
  const setToModifyEvent = useEvents(selectSetToModifyEvent);
  const { classes, cx } = useStyles();
  const { t } = useTranslation("event");
  const singleMarkKey = marks.length === 1 ? marks[0]?.key : undefined;

  const leftMarkPosition =
    marks[0]?.time != undefined && timelineStartSec != undefined
      ? toSec(marks[0].time) - timelineStartSec
      : undefined;
  const rightMarkPosition =
    marks[1]?.time != undefined && timelineStartSec != undefined
      ? toSec(marks[1].time) - timelineStartSec
      : undefined;
  const leftMarkLeft =
    leftMarkPosition != undefined ? timelinePointToPercent(leftMarkPosition, viewport) : undefined;
  const rightMarkLeft =
    rightMarkPosition != undefined
      ? timelinePointToPercent(rightMarkPosition, viewport)
      : undefined;
  const markRangeStyle = getEventMarkRangeStyle(leftMarkPosition, rightMarkPosition, viewport);

  useEffect(() => {
    if (marks.length === 2) {
      setOpen(true);
      setAnchorEl(leftMarkRef.current);
    }
  }, [marks]);

  useEffect(() => {
    if (singleMarkKey == undefined) {
      setIsMarkTooltipOpen(false);
      return;
    }

    setIsMarkTooltipOpen(true);
    const timeoutId = window.setTimeout(() => {
      setIsMarkTooltipOpen(false);
    }, EVENT_MARK_TOOLTIP_AUTO_HIDE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [singleMarkKey]);

  return (
    <>
      <div className={classes.markLayer} data-testid="timeline-event-mark-layer">
        <Tooltip
          title={t("startPoint")}
          placement="top"
          open={isMarkTooltipOpen}
          slotProps={{
            popper: {
              modifiers: [{ name: "offset", options: { offset: [0, 4] } }],
            },
          }}
        >
          <div
            ref={leftMarkRef}
            aria-describedby={open ? "event-mark-popper" : undefined}
            className={classes.markAnchor}
            style={{ left: leftMarkLeft ?? 0 }}
          />
        </Tooltip>
        {markRangeStyle != undefined && (
          <div
            className={classes.markRange}
            data-testid="timeline-event-mark-range"
            style={markRangeStyle}
          />
        )}
        {leftMarkLeft != undefined && (
          <>
            <div
              className={classes.markLine}
              data-testid="timeline-event-mark-start-line"
              style={{ left: leftMarkLeft }}
            />
            <span
              className={cx(classes.markIcon, classes.leftMark)}
              data-testid="timeline-event-mark-start-icon"
              style={{ left: leftMarkLeft }}
            >
              <EventMarkIcon />
            </span>
          </>
        )}
        {rightMarkLeft != undefined && (
          <>
            <div
              className={classes.markLine}
              data-testid="timeline-event-mark-end-line"
              style={{ left: rightMarkLeft }}
            />
            <span
              className={cx(classes.markIcon, classes.rightMark)}
              data-testid="timeline-event-mark-end-icon"
              style={{ left: rightMarkLeft }}
            >
              <EventMarkIcon />
            </span>
          </>
        )}
      </div>
      <Popper
        placement="top-start"
        open={open}
        anchorEl={anchorEl}
        transition
        id="event-mark-popper"
        style={{ opacity: isHiddenCreateEventPopper ? 0 : 1 }}
        modifiers={[
          // Keep at least 20px of breathing room from the window edges so the popper doesn't
          // snap flush to the left when the mark sits near the start of the timeline.
          // tether:false is required — the mark anchor is a ~1px line, and the default tethered
          // behavior would pin the popper to it and refuse to shift away to clear the padding.
          { name: "preventOverflow", options: { altAxis: true, tether: false, padding: 20 } },
        ]}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps}>
            <div className={classes.createEventContainer}>
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
    </>
  );
}

const MemoEventMark = React.memo(EventMark);

function EventSelectionMenu({
  anchorPosition,
  events,
  onClose,
  onSelect,
}: {
  anchorPosition: PopoverPosition;
  events: TimelinePositionedEvent[];
  onClose: () => void;
  onSelect: (event: TimelinePositionedEvent) => void;
}): React.JSX.Element {
  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      slotProps={{ list: { dense: true } }}
    >
      {events.map((event) => (
        <MenuItem
          key={event.event.name}
          onClick={() => {
            onSelect(event);
          }}
        >
          {event.event.displayName || event.event.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

function EventContextMenu({
  anchorPosition,
  canWriteEvents,
  isLoopDisabled,
  event,
  onEdit,
  onLoop,
  onClose,
}: {
  anchorPosition: PopoverPosition;
  canWriteEvents: boolean;
  isLoopDisabled: boolean;
  event: TimelinePositionedEvent;
  onEdit: (event: TimelinePositionedEvent) => void;
  onLoop: (event: TimelinePositionedEvent) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("event");

  const handleLoop = useCallback((): void => {
    onClose();
    onLoop(event);
  }, [event, onClose, onLoop]);

  const handleEdit = useCallback((): void => {
    onClose();
    onEdit(event);
  }, [event, onClose, onEdit]);

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      slotProps={{ list: { dense: true } }}
    >
      {canWriteEvents && <MenuItem onClick={handleEdit}>{t("editMoment")}</MenuItem>}
      <MenuItem onClick={handleLoop} disabled={isLoopDisabled}>
        {t("loopPlay")}
      </MenuItem>
    </Menu>
  );
}

type Props = {
  componentId: string;
  canWriteEvents: boolean;
  isDragging: boolean;
  eventContextMenuRequest: EventContextMenuRequest | undefined;
  onEventContextMenuHandled: () => void;
  onPreviewLaneCountChange?: (laneCount: number | undefined) => void;
  onSeek?: (playbackSeconds: number) => void;
  rollingEditEnabled?: boolean;
  setCursor: (cursor: string) => void;
  viewport: TimelineViewport;
};

type EventDragState = {
  anchor?: BodyDragAnchor;
  edge?: EventResizeEdge;
  initialClientX: number;
  kind: "body" | "edge";
  lane: number;
  movedBeyondClickThreshold: boolean;
  event: TimelinePositionedEvent;
  range: EventTimeRange;
  sourceEndSec: number;
  sourceStartSec: number;
};

function getEventLayoutWithRange(
  item: EventLaneLayoutItem,
  range: EventTimeRange,
  viewport: TimelineViewport,
): EventLaneLayoutItem {
  const startPosition = _.clamp(timeToFraction(range.startSec, viewport), 0, 1);
  const endPosition = _.clamp(timeToFraction(range.endSec, viewport), 0, 1);

  return {
    ...item,
    endPosition,
    endSec: range.endSec,
    isZeroDuration: range.startSec === range.endSec,
    startPosition,
    startSec: range.startSec,
    widthPosition: Math.max(endPosition - startPosition, 0),
  };
}

function getTotalTimelinePosition(timeSec: number, viewport: TimelineViewport): number {
  const totalDurationSec = viewport.totalEndSec - viewport.totalStartSec;
  if (totalDurationSec <= 0) {
    return 0;
  }

  return _.clamp((timeSec - viewport.totalStartSec) / totalDurationSec, 0, 1);
}

function getEventWithRange(
  event: TimelinePositionedEvent,
  range: EventTimeRange,
  viewport: TimelineViewport,
): TimelinePositionedEvent {
  const startPosition = getTotalTimelinePosition(range.startSec, viewport);
  const endPosition = getTotalTimelinePosition(range.endSec, viewport);
  const durationSec = Math.max(range.endSec - range.startSec, 0);
  const startTimeOffsetSec = range.startSec - event.secondsSinceStart;
  const startTime = add(event.startTime, fromSec(startTimeOffsetSec));
  const endTime = add(startTime, fromSec(durationSec));
  const update = buildEventTimeUpdate({
    sourceEvent: event.event,
    startTime: event.startTime,
    startTimeOffsetSec,
    durationSec,
  });

  return {
    ...event,
    endPosition,
    endTime,
    event: create(EventSchema, {
      ...event.event,
      duration: update.event.duration,
      triggerTime: update.event.triggerTime,
    }),
    secondsSinceStart: range.startSec,
    startPosition,
    startTime,
  };
}

function getEventsWithEventRange({
  eventName,
  events,
  range,
  viewport,
}: {
  eventName: string;
  events: TimelinePositionedEvent[];
  range: EventTimeRange;
  viewport: TimelineViewport;
}): TimelinePositionedEvent[] {
  return events
    .map((event) =>
      event.event.name === eventName ? getEventWithRange(event, range, viewport) : event,
    )
    .sort((left, right) => {
      if (left.startPosition !== right.startPosition) {
        return left.startPosition - right.startPosition;
      }
      if (left.endPosition !== right.endPosition) {
        return left.endPosition - right.endPosition;
      }
      return left.event.name.localeCompare(right.event.name);
    });
}

function getEventsWithRollingEditRange({
  boundarySec,
  events,
  pair,
  viewport,
}: {
  boundarySec: number;
  events: TimelinePositionedEvent[];
  pair: RollingEditPair;
  viewport: TimelineViewport;
}): TimelinePositionedEvent[] {
  const clampedBoundarySec = clampRollingEditBoundary(pair, boundarySec);
  const nextEndSec =
    pair.next.secondsSinceStart + toSec(subtract(pair.next.endTime, pair.next.startTime));
  const rangesByEventName = new Map<string, EventTimeRange>([
    [
      pair.previous.event.name,
      {
        endSec: clampedBoundarySec,
        startSec: pair.previous.secondsSinceStart,
      },
    ],
    [
      pair.next.event.name,
      {
        endSec: nextEndSec,
        startSec: clampedBoundarySec,
      },
    ],
  ]);

  return events
    .map((event) => {
      const range = rangesByEventName.get(event.event.name);
      return range == undefined ? event : getEventWithRange(event, range, viewport);
    })
    .sort((left, right) => {
      if (left.startPosition !== right.startPosition) {
        return left.startPosition - right.startPosition;
      }
      if (left.endPosition !== right.endPosition) {
        return left.endPosition - right.endPosition;
      }
      return left.event.name.localeCompare(right.event.name);
    });
}

function getEventsWithDragRange({
  drag,
  events,
  viewport,
}: {
  drag: EventDragState | undefined;
  events: TimelinePositionedEvent[];
  viewport: TimelineViewport;
}): TimelinePositionedEvent[] {
  if (drag == undefined) {
    return events;
  }

  return events.map((event) =>
    event.event.name === drag.event.event.name
      ? getEventWithRange(event, drag.range, viewport)
      : event,
  );
}

function getPointerClientX(
  event: Pick<PointerEvent, "clientX" | "pageX" | "screenX"> | React.PointerEvent,
): number {
  const nativeEvent =
    "nativeEvent" in event
      ? (event.nativeEvent as Pick<PointerEvent, "clientX" | "pageX" | "screenX">)
      : undefined;
  const candidates = [
    event.clientX,
    event.pageX,
    event.screenX,
    nativeEvent?.clientX,
    nativeEvent?.pageX,
    nativeEvent?.screenX,
  ];

  return candidates.find((value) => Number.isFinite(value)) ?? 0;
}

function areEventTimeRangesEqual(left: EventTimeRange, right: EventTimeRange): boolean {
  return (
    Math.abs(left.startSec - right.startSec) < 1e-9 && Math.abs(left.endSec - right.endSec) < 1e-9
  );
}

function areEventMarksEqual(
  left: TimelinePositionedEventMark[],
  right: TimelinePositionedEventMark[],
): boolean {
  return (
    left.length === right.length &&
    left.every((leftMark, index) => {
      const rightMark = right[index];
      return (
        leftMark.key === rightMark?.key &&
        Math.abs(leftMark.position - rightMark.position) < 1e-9 &&
        areEqual(leftMark.time, rightMark.time)
      );
    })
  );
}

function UnmemoizedEventsOverlay(props: Props): React.JSX.Element | ReactNull {
  const {
    componentId,
    canWriteEvents,
    isDragging,
    eventContextMenuRequest,
    onEventContextMenuHandled,
    onPreviewLaneCountChange,
    onSeek,
    rollingEditEnabled = true,
    setCursor,
    viewport,
  } = props;
  const consoleApi = useConsoleApi();
  const events = useEvents(selectEvents);
  const eventMarks = useEvents(selectEventMarks);
  const selectEventByName = useEvents(selectEvent);
  const setEvents = useEvents(selectSetEvents);
  const setEventMarks = useEvents(selectSetEventMarks);
  const refreshEvents = useEvents(selectRefreshEvents);
  const toModifyEvent = useEvents(selectToModifyEvent);
  const setToModifyEvent = useEvents(selectSetToModifyEvent);
  const toModifyEventName = toModifyEvent?.name;
  const startTime = useMessagePipeline(selectStartTime);
  const seek = useMessagePipeline(selectSeek);
  const loopedEvent = useTimelineInteractionState(selectLoopedEvent);
  const setLoopedEvent = useTimelineInteractionState(selectSetLoopedEvent);
  const hoverValue = useHoverValue({ componentId, isPlaybackSeconds: true });
  const { classes, cx } = useStyles();
  // Share Emotion's serialized class combinations across every tick. Re-running the
  // complete style hook for thousands of items otherwise dominates viewport updates.
  const tickClasses = useMemo<EventTickClasses>(
    () => ({
      states: Array.from({ length: 16 }, (_, state) =>
        cx(classes.tick, {
          [classes.tickHovered]: (state & 1) !== 0,
          [classes.tickSelected]: (state & 2) !== 0,
          [classes.tickDragging]: (state & 4) !== 0,
          [classes.rollingEditPreview]: (state & 8) !== 0,
        }),
      ),
      label: classes.tickLabel,
      startHandle: cx(classes.edgeHandle, classes.edgeHandleStart),
      endHandle: cx(classes.edgeHandle, classes.edgeHandleEnd),
      startLine: cx(classes.edgeHandleLine, classes.edgeHandleLineStart),
      endLine: cx(classes.edgeHandleLine, classes.edgeHandleLineEnd),
      startLineVisible: cx(
        classes.edgeHandleLine,
        classes.edgeHandleLineStart,
        classes.edgeHandleLineVisible,
      ),
      endLineVisible: cx(
        classes.edgeHandleLine,
        classes.edgeHandleLineEnd,
        classes.edgeHandleLineVisible,
      ),
    }),
    [classes, cx],
  );
  const { t } = useTranslation("event");
  const rootRef = useRef<HTMLDivElement | ReactNull>(ReactNull);
  const { width, ref: resizeRef } = useResizeDetector<HTMLDivElement>({
    handleHeight: false,
    refreshMode: "debounce",
    refreshRate: 0,
  });
  const mergedRootRef = useMemo(() => mergeRefs<HTMLDivElement>(rootRef, resizeRef), [resizeRef]);

  const [dragPointKey, setDragPointKey] = useState<string | undefined>(undefined);
  const [eventDrag, setEventDrag] = useState<EventDragState | undefined>(undefined);
  const eventDragRef = useRef<EventDragState | undefined>(undefined);
  const [isHiddenCreateEventPopper, setIsHiddenCreateEventPopper] = useState(false);
  const [rollingEdit, setRollingEdit] = useState<
    | {
        boundarySec: number;
        initialClientX: number;
        pair: RollingEditPair;
      }
    | undefined
  >(undefined);
  const rollingEditRef = useRef(rollingEdit);
  rollingEditRef.current = rollingEdit;
  const rollingEditPair = rollingEdit?.pair;
  const [contextMenu, setContextMenu] = useState<
    | {
        anchorPosition: PopoverPosition;
        event: TimelinePositionedEvent;
      }
    | undefined
  >(undefined);
  const [selectionMenu, setSelectionMenu] = useState<
    | {
        anchorPosition: PopoverPosition;
        events: TimelinePositionedEvent[];
      }
    | undefined
  >(undefined);

  const closeContextMenu = useCallback((): void => {
    setContextMenu(undefined);
  }, []);

  const closeSelectionMenu = useCallback((): void => {
    setSelectionMenu(undefined);
  }, []);

  const selectContextMenuEvent = useCallback(
    (event: TimelinePositionedEvent): void => {
      const anchorPosition = selectionMenu?.anchorPosition;
      setSelectionMenu(undefined);
      if (anchorPosition == undefined) {
        return;
      }

      setContextMenu({ anchorPosition, event });
    },
    [selectionMenu?.anchorPosition],
  );

  const hoverTimePosition =
    hoverValue != undefined ? timeToFraction(hoverValue.value, viewport) : undefined;

  const positionedEvents = useMemo(() => events.value ?? EMPTY_EVENTS, [events.value]);

  const baseLaneLayout = useMemo(() => {
    return getCachedEventLaneLayout({ events: positionedEvents, viewport });
  }, [positionedEvents, viewport]);

  const previousPreviewLayout = useRef(baseLaneLayout);
  const renderLaneLayout = useMemo(() => {
    const previewEvents =
      rollingEdit != undefined
        ? getEventsWithRollingEditRange({ ...rollingEdit, events: positionedEvents, viewport })
        : getEventsWithDragRange({ drag: eventDrag, events: positionedEvents, viewport });
    const layout =
      previewEvents === positionedEvents
        ? baseLaneLayout
        : reuseEventLaneItems(
            getCachedEventLaneLayout({ events: previewEvents, viewport }),
            previousPreviewLayout.current,
          );
    previousPreviewLayout.current = layout;
    return layout;
  }, [baseLaneLayout, eventDrag, rollingEdit, positionedEvents, viewport]);

  const renderLaneLayoutRef = useRef<EventLaneLayout>(renderLaneLayout);
  const loopedEventRef = useRef(loopedEvent);

  useEffect(() => {
    renderLaneLayoutRef.current = renderLaneLayout;
  }, [renderLaneLayout]);

  useEffect(() => {
    loopedEventRef.current = loopedEvent;
  }, [loopedEvent]);

  const visibleLanes = useVisibleEventLanes(rootRef, renderLaneLayout.laneCount);
  const [focusedEventName, setFocusedEventName] = useState<string | undefined>();

  const renderedLaneCount = Math.max(renderLaneLayout.laneCount, 1);
  const laneContentHeight = renderedLaneCount * EVENT_LANE_HEIGHT_PX;
  const showEmptyEventHint =
    canWriteEvents &&
    !events.loading &&
    events.error == undefined &&
    events.value != undefined &&
    // Only when there are no moments at all — not when moments exist but are scrolled or
    // zoomed out of the current viewport (positionedEvents holds every moment;
    // renderLaneLayout.items is filtered to the visible range).
    positionedEvents.length === 0 &&
    eventMarks.length === 0;

  useEffect(() => {
    onPreviewLaneCountChange?.(
      eventDrag == undefined && rollingEdit == undefined ? undefined : renderLaneLayout.laneCount,
    );
  }, [eventDrag, rollingEdit, onPreviewLaneCountChange, renderLaneLayout.laneCount]);

  const laneByEventName = useMemo(() => {
    return new Map(renderLaneLayout.items.map((item) => [item.event.event.name, item.lane]));
  }, [renderLaneLayout.items]);

  const [leftMark, rightMark] = eventMarks;
  const timelineStartSec = startTime != undefined ? toSec(startTime) : undefined;
  const leftMarkPosition =
    leftMark != undefined && timelineStartSec != undefined
      ? timeToFraction(toSec(leftMark.time) - timelineStartSec, viewport)
      : undefined;
  const rightMarkPosition =
    rightMark != undefined && timelineStartSec != undefined
      ? timeToFraction(toSec(rightMark.time) - timelineStartSec, viewport)
      : undefined;
  const rollingEditPairs = useMemo(() => {
    if (!rollingEditEnabled || startTime == undefined) {
      return [];
    }

    return findRollingEditPairs({
      laneByEventName,
      events: events.value ?? [],
      viewport,
      width: width ?? 0,
    });
  }, [laneByEventName, events.value, rollingEditEnabled, startTime, viewport, width]);

  const timeRange = useMemo(() => {
    if (viewport.totalEndSec <= viewport.totalStartSec) {
      return undefined;
    }

    return viewport.totalEndSec - viewport.totalStartSec;
  }, [viewport.totalEndSec, viewport.totalStartSec]);

  useEffect(() => {
    if (eventContextMenuRequest == undefined) {
      return;
    }

    onEventContextMenuHandled();

    if (startTime == undefined || timeRange == undefined) {
      setContextMenu(undefined);
      setSelectionMenu(undefined);
      return;
    }

    // The viewport and event bounds share the recording's relative playback-time axis.
    const matchingEvents = getEventTimeIndex(
      events.value ?? EMPTY_EVENTS,
      startTime,
    ).atRelativeTime(eventContextMenuRequest.playbackSeconds, timeRange);

    const anchorPosition = {
      top: eventContextMenuRequest.clientY,
      left: eventContextMenuRequest.clientX,
    };

    if (matchingEvents.length === 0) {
      setContextMenu(undefined);
      setSelectionMenu(undefined);
      return;
    }

    if (matchingEvents.length === 1) {
      setSelectionMenu(undefined);
      setContextMenu({ anchorPosition, event: matchingEvents[0]! });
      return;
    }

    setContextMenu(undefined);
    setSelectionMenu({ anchorPosition, events: matchingEvents });
  }, [eventContextMenuRequest, events.value, onEventContextMenuHandled, startTime, timeRange]);

  const commitRollingEdit = useCallback(
    async (pair: RollingEditPair, boundarySec: number): Promise<void> => {
      const updates = buildRollingEditUpdates(pair, boundarySec);
      const previousEvents = events;
      if (previousEvents.value != undefined) {
        const optimisticEvents = getEventsWithRollingEditRange({
          boundarySec,
          events: previousEvents.value,
          pair,
          viewport,
        });
        setEvents(
          previousEvents.loading
            ? { loading: true, value: optimisticEvents }
            : { loading: false, value: optimisticEvents },
        );
      }

      try {
        const results = await Promise.allSettled(
          updates.map(async (update) => {
            await consoleApi.updateEvent(update);
          }),
        );
        const failedResult = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failedResult != undefined) {
          throw failedResult.reason;
        }
      } catch (error) {
        console.error(error);
        setEvents(previousEvents);
        toast.error("Failed to update events");
      } finally {
        refreshEvents();
      }
    },
    [consoleApi, events, refreshEvents, setEvents, viewport],
  );

  const commitEventTimeEdit = useCallback(
    async (drag: EventDragState): Promise<void> => {
      if (
        areEventTimeRangesEqual(drag.range, {
          endSec: drag.sourceEndSec,
          startSec: drag.sourceStartSec,
        })
      ) {
        return;
      }

      const previousEvents = events;
      if (previousEvents.value != undefined) {
        const optimisticEvents = getEventsWithEventRange({
          eventName: drag.event.event.name,
          events: previousEvents.value,
          range: drag.range,
          viewport,
        });
        setEvents(
          previousEvents.loading
            ? { loading: true, value: optimisticEvents }
            : { loading: false, value: optimisticEvents },
        );
      }

      try {
        await consoleApi.updateEvent(
          buildEventTimeUpdate({
            sourceEvent: drag.event.event,
            startTime: drag.event.startTime,
            startTimeOffsetSec: drag.range.startSec - drag.event.secondsSinceStart,
            durationSec: Math.max(drag.range.endSec - drag.range.startSec, 0),
          }),
        );
      } catch (error) {
        console.error(error);
        setEvents(previousEvents);
        toast.error("Failed to update event");
      } finally {
        refreshEvents();
      }
    },
    [consoleApi, events, refreshEvents, setEvents, viewport],
  );

  const [laneSnapCache] = useState(() => new LaneSnapCache());
  const cleanupEventDrag = useRef<() => void>(() => {});
  useEffect(
    () => () => {
      cleanupEventDrag.current();
    },
    [],
  );
  useLayoutEffect(() => {
    cleanupEventDrag.current();
    eventDragRef.current = undefined;
    setEventDrag(undefined);
    rollingEditRef.current = undefined;
    setRollingEdit(undefined);
  }, [positionedEvents, canWriteEvents, startTime?.sec, startTime?.nsec]);

  const beginEventDrag = useCallback(
    (nextDrag: EventDragState): void => {
      cleanupEventDrag.current();
      const applyPointerMove = (event: PointerEvent): void => {
        const currentDrag = eventDragRef.current;
        if (currentDrag == undefined || rootRef.current == undefined) {
          return;
        }

        const clientX = getPointerClientX(event);
        const rect = rootRef.current.getBoundingClientRect();
        const movedBeyondClickThreshold =
          currentDrag.movedBeyondClickThreshold ||
          Math.abs(clientX - currentDrag.initialClientX) > EVENT_CLICK_DRAG_THRESHOLD_PX;
        if (!currentDrag.movedBeyondClickThreshold && movedBeyondClickThreshold) {
          if (loopedEventRef.current != undefined) {
            loopedEventRef.current = undefined;
            setLoopedEvent(undefined);
          }
        }
        const pointerFraction = clientXToFraction(clientX, rect);
        const nextRange =
          currentDrag.kind === "body" && currentDrag.anchor != undefined
            ? calculateBodyDragRange({
                anchor: currentDrag.anchor,
                pointerFraction,
                viewport,
              })
            : calculateResizeRange({
                currentEndSec: currentDrag.sourceEndSec,
                currentStartSec: currentDrag.sourceStartSec,
                edge: currentDrag.edge ?? "end",
                pointerFraction,
                viewport,
              });
        const currentLaneLayout = renderLaneLayoutRef.current;
        const activeLane =
          indexEventLanes(currentLaneLayout).byName.get(currentDrag.event.event.name)?.lane ??
          currentDrag.lane;
        const snappedRange = rollingEditEnabled
          ? snapRangeToLaneBoundaries({
              activeEventName: currentDrag.event.event.name,
              edge: currentDrag.kind === "edge" ? currentDrag.edge : undefined,
              lane: activeLane,
              layoutItems: indexEventLanes(currentLaneLayout).byLane[activeLane] ?? [],
              cache: laneSnapCache,
              range: nextRange,
              viewport,
            })
          : nextRange;
        const updatedDrag = {
          ...currentDrag,
          lane: activeLane,
          movedBeyondClickThreshold,
          range: snappedRange,
        };
        if (movedBeyondClickThreshold) {
          onSeek?.(
            currentDrag.kind === "body"
              ? clientXToTime(clientX, rect, viewport)
              : currentDrag.edge === "start"
                ? snappedRange.startSec
                : snappedRange.endSec,
          );
        }
        eventDragRef.current = updatedDrag;
        setEventDrag(updatedDrag);
      };

      const input = frameInput(applyPointerMove);
      const onPointerMove = (event: PointerEvent) => {
        const current = eventDragRef.current;
        if (
          current != undefined &&
          !current.movedBeyondClickThreshold &&
          Math.abs(getPointerClientX(event) - current.initialClientX) >
            EVENT_CLICK_DRAG_THRESHOLD_PX
        ) {
          eventDragRef.current = { ...current, movedBeyondClickThreshold: true };
          if (loopedEventRef.current != undefined) {
            loopedEventRef.current = undefined;
            setLoopedEvent(undefined);
          }
        }
        input.schedule(event);
      };
      const onPointerCancel = () => {
        cleanupEventDrag.current();
        eventDragRef.current = undefined;
        setEventDrag(undefined);
      };
      const onPointerUp = (event: PointerEvent): void => {
        const dragBeforePointerUp = eventDragRef.current;
        if (dragBeforePointerUp == undefined) {
          return;
        }

        const clientX = getPointerClientX(event);
        const movedBeyondClickThreshold =
          dragBeforePointerUp.movedBeyondClickThreshold ||
          Math.abs(clientX - dragBeforePointerUp.initialClientX) > EVENT_CLICK_DRAG_THRESHOLD_PX;

        if (movedBeyondClickThreshold) {
          input.flush(event);
        }
        cleanupEventDrag.current();

        const currentDrag = eventDragRef.current;
        eventDragRef.current = undefined;
        if (currentDrag == undefined) {
          setEventDrag(undefined);
          return;
        }

        if (!movedBeyondClickThreshold) {
          setEventDrag(undefined);
          if (rootRef.current != undefined) {
            onSeek?.(clientXToTime(clientX, rootRef.current.getBoundingClientRect(), viewport));
          }
          return;
        }

        void commitEventTimeEdit(currentDrag);
        setEventDrag(undefined);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      window.addEventListener("pointercancel", onPointerCancel, { once: true });
      cleanupEventDrag.current = () => {
        input.cancel();
        laneSnapCache.clear();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        cleanupEventDrag.current = () => {};
      };
      eventDragRef.current = nextDrag;
      setEventDrag(nextDrag);
    },
    [commitEventTimeEdit, laneSnapCache, onSeek, rollingEditEnabled, setLoopedEvent, viewport],
  );

  const startEventBodyDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, item: EventLaneLayoutItem): void => {
      if (rootRef.current == undefined) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const clientX = getPointerClientX(event);
      if (!canWriteEvents) {
        onSeek?.(clientXToTime(clientX, rootRef.current.getBoundingClientRect(), viewport));
        return;
      }

      selectEventByName(item.event.event.name);
      setEventMarks([]);

      const pointerFraction = clientXToFraction(clientX, rootRef.current.getBoundingClientRect());
      const nextDrag: EventDragState = {
        anchor: createBodyDragAnchor({
          endSec: item.endSec,
          pointerFraction,
          startSec: item.startSec,
          viewport,
        }),
        initialClientX: clientX,
        kind: "body",
        lane: item.lane,
        movedBeyondClickThreshold: false,
        event: item.event,
        range: { startSec: item.startSec, endSec: item.endSec },
        sourceEndSec: item.endSec,
        sourceStartSec: item.startSec,
      };
      beginEventDrag(nextDrag);
    },
    [beginEventDrag, canWriteEvents, onSeek, selectEventByName, setEventMarks, viewport],
  );

  const startEventEdgeDrag = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      edge: EventResizeEdge,
      item: EventLaneLayoutItem,
    ): void => {
      if (rootRef.current == undefined) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const clientX = getPointerClientX(event);
      if (!canWriteEvents) {
        onSeek?.(clientXToTime(clientX, rootRef.current.getBoundingClientRect(), viewport));
        return;
      }

      selectEventByName(item.event.event.name);
      setEventMarks([]);

      const nextDrag: EventDragState = {
        edge,
        initialClientX: clientX,
        kind: "edge",
        lane: item.lane,
        movedBeyondClickThreshold: false,
        event: item.event,
        range: { startSec: item.startSec, endSec: item.endSec },
        sourceEndSec: item.endSec,
        sourceStartSec: item.startSec,
      };
      beginEventDrag(nextDrag);
    },
    [beginEventDrag, canWriteEvents, onSeek, selectEventByName, setEventMarks, viewport],
  );

  useEffect(() => {
    if (
      (canWriteEvents &&
        hoverTimePosition != undefined &&
        ((leftMark != undefined &&
          leftMarkPosition != undefined &&
          Math.abs(hoverTimePosition - leftMarkPosition) < HOTSPOT_WIDTH_PER_CENT) ||
          (rightMark != undefined &&
            rightMarkPosition != undefined &&
            Math.abs(hoverTimePosition - rightMarkPosition) < HOTSPOT_WIDTH_PER_CENT))) ||
      isDragging
    ) {
      setCursor("ew-resize");
    } else {
      setCursor("default");
    }
  }, [
    canWriteEvents,
    hoverTimePosition,
    isDragging,
    leftMark,
    leftMarkPosition,
    rightMark,
    rightMarkPosition,
    setCursor,
  ]);

  useEffect(() => {
    if (!canWriteEvents || !isDragging) {
      setDragPointKey(undefined);
      setIsHiddenCreateEventPopper(false);
      return;
    }

    if (dragPointKey != undefined) {
      if (eventMarks.some((mark) => mark.key === dragPointKey)) {
        setIsHiddenCreateEventPopper(true);
        return;
      }

      setDragPointKey(undefined);
      setIsHiddenCreateEventPopper(false);
      return;
    }

    const leftPointGap =
      hoverTimePosition != undefined && leftMarkPosition != undefined
        ? Math.abs(hoverTimePosition - leftMarkPosition)
        : undefined;
    const rightPointGap =
      hoverTimePosition != undefined && rightMarkPosition != undefined
        ? Math.abs(hoverTimePosition - rightMarkPosition)
        : undefined;

    if (
      leftMark &&
      leftPointGap != undefined &&
      leftPointGap < HOTSPOT_WIDTH_PER_CENT &&
      (rightPointGap == undefined || leftPointGap <= rightPointGap)
    ) {
      setDragPointKey(leftMark.key);
      setIsHiddenCreateEventPopper(true);
    } else if (
      rightMark &&
      rightPointGap != undefined &&
      rightPointGap < HOTSPOT_WIDTH_PER_CENT &&
      (leftPointGap == undefined || rightPointGap < leftPointGap)
    ) {
      setDragPointKey(rightMark.key);
      setIsHiddenCreateEventPopper(true);
    } else {
      setDragPointKey(undefined);
      setIsHiddenCreateEventPopper(false);
    }
  }, [
    canWriteEvents,
    dragPointKey,
    hoverTimePosition,
    isDragging,
    leftMark,
    leftMarkPosition,
    eventMarks,
    rightMark,
    rightMarkPosition,
  ]);

  useEffect(() => {
    if (
      canWriteEvents &&
      dragPointKey != undefined &&
      hoverValue &&
      startTime &&
      hoverTimePosition != undefined
    ) {
      const targetMark = eventMarks.find((mark) => mark.key === dragPointKey);
      if (targetMark) {
        const hoveredMark = {
          ...targetMark,
          time: add(startTime, fromSec(hoverValue.value)),
          position: hoverTimePosition,
        };
        const toModifyEventLane =
          toModifyEventName != undefined ? laneByEventName.get(toModifyEventName) : undefined;
        const eligibleEventNames =
          toModifyEventLane != undefined
            ? new Set(
                renderLaneLayout.items
                  .filter((item) => item.lane === toModifyEventLane)
                  .map((item) => item.event.event.name),
              )
            : undefined;
        const nextMark = rollingEditEnabled
          ? getSnappedEventMark({
              excludedEventName: toModifyEventName,
              eligibleEventNames,
              mark: hoveredMark,
              events: events.value ?? [],
            })
          : hoveredMark;
        const markOrder = new Map(eventMarks.map((mark, index) => [mark.key, index]));

        const nextEventMarks = eventMarks
          .map((mark) => (mark.key === dragPointKey ? nextMark : mark))
          .sort((a, b) => {
            const positionDelta = a.position - b.position;
            if (positionDelta !== 0) {
              return positionDelta;
            }

            return (markOrder.get(a.key) ?? 0) - (markOrder.get(b.key) ?? 0);
          });

        if (!areEventMarksEqual(eventMarks, nextEventMarks)) {
          setEventMarks(nextEventMarks);
        }
      }
    }
  }, [
    canWriteEvents,
    dragPointKey,
    hoverTimePosition,
    hoverValue,
    laneByEventName,
    eventMarks,
    events.value,
    renderLaneLayout.items,
    rollingEditEnabled,
    setEventMarks,
    startTime,
    toModifyEventName,
  ]);

  useEffect(() => {
    if (!rollingEditEnabled) {
      rollingEditRef.current = undefined;
      setRollingEdit(undefined);
      return;
    }
    if (rollingEditPair == undefined) {
      return;
    }
    let receivedPointerMove = false;
    const input = frameInput((event: PointerEvent) => {
      const current = rollingEditRef.current;
      if (rootRef.current == undefined || current?.pair !== rollingEditPair) {
        return;
      }
      const boundarySec = clampRollingEditBoundary(
        rollingEditPair,
        clientXToTime(getPointerClientX(event), rootRef.current.getBoundingClientRect(), viewport),
      );
      onSeek?.(boundarySec);
      rollingEditRef.current = { ...current, boundarySec };
      setRollingEdit(rollingEditRef.current);
    });
    const onPointerMove = (event: PointerEvent) => {
      receivedPointerMove = true;
      input.schedule(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (
        receivedPointerMove ||
        getPointerClientX(event) !== rollingEditRef.current?.initialClientX
      ) {
        input.flush(event);
      }
      const current = rollingEditRef.current;
      rollingEditRef.current = undefined;
      if (current != undefined) {
        void commitRollingEdit(current.pair, current.boundarySec);
      }
      setRollingEdit(undefined);
    };
    const cancel = () => {
      input.cancel();
      rollingEditRef.current = undefined;
      setRollingEdit(undefined);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    return () => {
      input.cancel();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [commitRollingEdit, onSeek, rollingEditPair, rollingEditEnabled, viewport]);

  const editEvent = useCallback(
    (targetEvent: TimelinePositionedEvent): void => {
      const eventDurationSec = durationToSeconds(targetEvent.event.duration);
      const eventEndSec =
        targetEvent.secondsSinceStart + toSec(subtract(targetEvent.endTime, targetEvent.startTime));

      setEventMarks([
        {
          key: `${targetEvent.event.name}:start`,
          position: timeToFraction(targetEvent.secondsSinceStart, viewport),
          time: targetEvent.startTime,
        },
        {
          key: `${targetEvent.event.name}:end`,
          position: timeToFraction(eventEndSec, viewport),
          time: targetEvent.endTime,
        },
      ]);
      setToModifyEvent({
        name: targetEvent.event.name,
        eventName: targetEvent.event.displayName,
        startTime: targetEvent.startTime,
        duration: eventDurationSec,
        durationUnit: "sec",
        description: targetEvent.event.description,
        metadataEntries: Object.entries(targetEvent.event.customizedFields).map(([key, value]) => ({
          key,
          value,
        })),
        enabledCreateNewTask: false,
        fileName: "",
        imgUrl: targetEvent.imgUrl,
        files: targetEvent.event.files,
        record: targetEvent.event.record,
        customFieldValues: targetEvent.event.customFieldValues,
      });
    },
    [setEventMarks, setToModifyEvent, viewport],
  );

  const toggleLoopEvent = useCallback(
    (targetEvent: TimelinePositionedEvent): void => {
      if (loopedEvent?.event.name === targetEvent.event.name) {
        setLoopedEvent(undefined);
        return;
      }

      if (seek != undefined) {
        seek(targetEvent.startTime);
        window.setTimeout(() => {
          setLoopedEvent(targetEvent);
        }, 1000);
      } else {
        setLoopedEvent(targetEvent);
      }
    },
    [loopedEvent?.event.name, seek, setLoopedEvent],
  );

  const selectionNames = useMemo(
    () => new Set(selectionMenu?.events.map((event) => event.event.name)),
    [selectionMenu],
  );
  const visibleItems = useMemo(() => {
    const index = indexEventLanes(renderLaneLayout);
    const items = index.byLane.slice(visibleLanes.first, visibleLanes.last + 1).flat();
    const mounted = new Set(items.map((item) => item.event.event.name));
    for (const name of [
      eventDrag?.event.event.name,
      rollingEdit?.pair.previous.event.name,
      rollingEdit?.pair.next.event.name,
      contextMenu?.event.event.name,
      focusedEventName,
      toModifyEventName,
    ]) {
      if (name == undefined || mounted.has(name)) {
        continue;
      }
      const item = index.byName.get(name);
      if (item != undefined) {
        items.push(item);
        mounted.add(name);
      }
    }
    // Keep the original chronological DOM order even when lane assignments change.
    // Grouping nodes by lane causes thousands of DOM moves during zoom/repacking.
    return items.sort((a, b) => {
      if (a.startPosition !== b.startPosition) {
        return a.startPosition - b.startPosition;
      }
      if (a.endPosition !== b.endPosition) {
        return a.endPosition - b.endPosition;
      }
      return a.event.event.name.localeCompare(b.event.event.name);
    });
  }, [
    renderLaneLayout,
    visibleLanes,
    eventDrag?.event.event.name,
    rollingEdit?.pair,
    contextMenu?.event.event.name,
    focusedEventName,
    toModifyEventName,
  ]);
  const laneContent = useMemo(
    () => (
      <div
        className={classes.laneContent}
        data-testid="timeline-event-lane-content"
        style={{ height: laneContentHeight, top: "50%", transform: "translateY(-50%)" }}
      >
        {Array.from(
          {
            length: Math.max(
              0,
              Math.min(renderedLaneCount - 1, visibleLanes.last) - visibleLanes.first + 1,
            ),
          },
          (_value, index) => {
            const lane = visibleLanes.first + index;
            return (
              <div
                className={classes.laneRow}
                key={lane}
                style={{ top: lane * EVENT_LANE_HEIGHT_PX }}
              />
            );
          },
        )}
        {showEmptyEventHint && (
          <div className={classes.emptyEventHint} data-testid="timeline-empty-event-hint">
            <span
              aria-hidden="true"
              className={classes.emptyEventHintIcon}
              data-testid="timeline-empty-event-create-icon"
            >
              <EventCreateInactiveIcon focusable="false" />
            </span>
            <span className={classes.emptyEventHintText}>
              {t("emptyTimelineHint", { shortcut: SHORTCUTS.createMoment[0] })}
            </span>
          </div>
        )}
        {visibleItems.map((item) => {
          const eventName = item.event.event.name;
          const isPreviousPreview = rollingEdit?.pair.previous.event.name === eventName;
          const isNextPreview = rollingEdit?.pair.next.event.name === eventName;
          const draggedRange =
            eventDrag?.event.event.name === eventName ? eventDrag.range : undefined;
          const previewRange =
            draggedRange ??
            (isPreviousPreview
              ? { startSec: item.startSec, endSec: rollingEdit.boundarySec }
              : isNextPreview
                ? { startSec: rollingEdit.boundarySec, endSec: item.endSec }
                : undefined);
          const renderItem =
            previewRange != undefined
              ? getEventLayoutWithRange(item, previewRange, viewport)
              : item;
          return (
            <MemoEventTick
              key={eventName}
              tickClasses={tickClasses}
              item={renderItem}
              isDragging={draggedRange != undefined}
              isPreview={previewRange != undefined && draggedRange == undefined}
              onBodyPointerDown={startEventBodyDrag}
              onEdgePointerDown={startEventEdgeDrag}
              forceHovered={
                contextMenu?.event.event.name === eventName || selectionNames.has(eventName)
              }
            />
          );
        })}
        {canWriteEvents &&
          rollingEditEnabled &&
          rollingEditPairs.map((pair) => {
            const lane = laneByEventName.get(pair.previous.event.name) ?? 0;
            if (
              (lane < visibleLanes.first || lane > visibleLanes.last) &&
              rollingEdit?.pair.key !== pair.key
            ) {
              return undefined;
            }
            const left = timelinePointToPercent(pair.boundarySec, viewport);
            const top =
              (laneByEventName.get(pair.previous.event.name) ?? 0) * EVENT_LANE_HEIGHT_PX + 2;
            return left == undefined ? undefined : (
              <div
                className={classes.rollingEditHandle}
                data-testid="timeline-rolling-edit-handle"
                key={pair.key}
                style={{ left, top }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRollingEdit({
                    pair,
                    boundarySec: pair.boundarySec,
                    initialClientX: getPointerClientX(event),
                  });
                }}
              >
                <div className={classes.rollingEditHandleLine} />
              </div>
            );
          })}
      </div>
    ),
    [
      canWriteEvents,
      classes,
      tickClasses,
      contextMenu?.event.event.name,
      eventDrag,
      laneByEventName,
      laneContentHeight,
      renderedLaneCount,
      rollingEdit,
      rollingEditEnabled,
      rollingEditPairs,
      selectionNames,
      showEmptyEventHint,
      startEventBodyDrag,
      startEventEdgeDrag,
      t,
      viewport,
      visibleItems,
      visibleLanes,
    ],
  );

  return (
    <div
      className={classes.root}
      data-testid="events-overlay"
      ref={mergedRootRef}
      onFocusCapture={(event) => {
        setFocusedEventName(
          (event.target as HTMLElement).closest<HTMLElement>("[data-event-name]")?.dataset
            .eventName,
        );
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusedEventName(undefined);
        }
      }}
    >
      {laneContent}
      {canWriteEvents && (
        <MemoEventMark
          marks={eventMarks}
          isHiddenCreateEventPopper={isHiddenCreateEventPopper}
          timelineStartSec={timelineStartSec}
          viewport={viewport}
        />
      )}
      {selectionMenu && (
        <EventSelectionMenu
          anchorPosition={selectionMenu.anchorPosition}
          events={selectionMenu.events}
          onClose={closeSelectionMenu}
          onSelect={selectContextMenuEvent}
        />
      )}
      {contextMenu && (
        <EventContextMenu
          anchorPosition={contextMenu.anchorPosition}
          canWriteEvents={canWriteEvents}
          isLoopDisabled={areEqual(contextMenu.event.startTime, contextMenu.event.endTime)}
          event={contextMenu.event}
          onEdit={editEvent}
          onLoop={toggleLoopEvent}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

export const EventsOverlay = React.memo(UnmemoizedEventsOverlay);
