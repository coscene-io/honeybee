// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import {
  AppBar,
  CircularProgress,
  IconButton,
  TextField,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  CreateEventDialog as EditEventDialog,
  ToModifyEvent,
} from "@foxglove/studio-base/components/CoSceneCreateEventDialog";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";

import { EventView } from "./CoSceneEventView";

const useStyles = makeStyles()((theme) => ({
  appBar: {
    top: -1,
    zIndex: theme.zIndex.appBar - 1,
    display: "flex",
    flexDirection: "row",
    padding: theme.spacing(1),
    gap: theme.spacing(1),
    alignItems: "center",
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  root: {
    backgroundColor: theme.palette.background.paper,
    maxHeight: "100%",
  },
  accordionTitle: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  accordion: {
    padding: 0,
  },
  colorBlock: {
    width: "8px",
    height: "8px",
    borderRadius: "2px",
  },
}));

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectEventFilter = (store: EventsStore) => store.filter;
const selectSetEventFilter = (store: EventsStore) => store.setFilter;
const selectEvents = (store: EventsStore) => store.events;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectSetHoveredEvent = (store: TimelineInteractionStateStore) => store.setHoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;

export function EventsList(): JSX.Element {
  const events = useEvents(selectEvents);
  const selectedEventId = useEvents(selectSelectedEventId);
  const selectEvent = useEvents(selectSelectEvent);
  const { formatTime } = useAppTimeFormat();
  const seek = useMessagePipeline(selectSeek);
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const filter = useEvents(selectEventFilter);
  const setFilter = useEvents(selectSetEventFilter);
  const { t } = useTranslation("cosEvent");
  const [confirm, confirmModal] = useConfirm();
  const [editEventDialogOpen, setEditEventDialogOpen] = useState(false);
  const [toModifyEvent, setToModifyEvent] = useState<ToModifyEvent | undefined>(undefined);

  const timestampedEvents = useMemo(() => {
    const classifiedEvents = new Map<
      string,
      (TimelinePositionedEvent & { formattedTime: string })[]
    >();
    events.value?.forEach((event) => {
      const recordTitle: string = `${event.projectDisplayName}/${event.recordDisplayName}`;

      if (classifiedEvents.has(recordTitle)) {
        classifiedEvents.set(recordTitle, [
          ...(classifiedEvents.get(recordTitle) ?? []),
          {
            ...event,
            formattedTime: formatTime(event.startTime),
          },
        ]);
      } else {
        classifiedEvents.set(recordTitle, [
          {
            ...event,
            formattedTime: formatTime(event.startTime),
          },
        ]);
      }
    });

    return classifiedEvents;
  }, [events, formatTime]);

  const clearFilter = useCallback(() => {
    setFilter("");
  }, [setFilter]);

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

  const onHoverEnd = useCallback(() => {
    setHoveredEvent(undefined);
  }, [setHoveredEvent]);

  const onHoverStart = useCallback(
    (event: TimelinePositionedEvent) => {
      setHoveredEvent(event);
    },
    [setHoveredEvent],
  );

  const { classes } = useStyles();

  return (
    <Stack className={classes.root} fullHeight>
      <AppBar className={classes.appBar} position="sticky" color="inherit" elevation={0}>
        <TextField
          variant="filled"
          fullWidth
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          placeholder={t("searchByKV")}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" />,
            endAdornment: filter !== "" && (
              <IconButton edge="end" onClick={clearFilter} size="small">
                <ClearIcon fontSize="small" />
              </IconButton>
            ),
          }}
        />
      </AppBar>
      {events.loading && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <CircularProgress />
        </Stack>
      )}
      {events.error && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="error">
            {t("errorLoading")}
          </Typography>
        </Stack>
      )}
      {events.value && events.value.length === 0 && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="text.secondary">
            {t("noMoment")}
          </Typography>
        </Stack>
      )}
      <div>
        {Array.from(timestampedEvents.keys()).map((recordTitle) => {
          return (
            <div key={recordTitle}>
              <Accordion>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  aria-controls="panel1-content"
                  id="panel1-header"
                >
                  <div className={classes.accordionTitle}>
                    <span
                      className={classes.colorBlock}
                      style={{
                        backgroundColor: (timestampedEvents.get(recordTitle) ?? [])[0]?.color,
                      }}
                    />
                    {recordTitle}
                  </div>
                </AccordionSummary>
                <AccordionDetails className={classes.accordion}>
                  {(timestampedEvents.get(recordTitle) ?? []).map((event) => {
                    return (
                      <EventView
                        key={event.event.name}
                        event={event}
                        filter={filter}
                        // When hovering within the event list only show hover state on directly
                        // hovered event.
                        isHovered={
                          hoveredEvent
                            ? event.event.name === hoveredEvent.event.name
                            : eventsAtHoverValue[event.event.name] != undefined
                        }
                        isSelected={event.event.name === selectedEventId}
                        onClick={onClick}
                        onHoverStart={onHoverStart}
                        onHoverEnd={onHoverEnd}
                        onEdit={(currentEvent: ToModifyEvent) => {
                          setEditEventDialogOpen(true);
                          setToModifyEvent(currentEvent);
                        }}
                        confirm={confirm}
                      />
                    );
                  })}
                </AccordionDetails>
              </Accordion>
            </div>
          );
        })}
      </div>
      {confirmModal}
      {editEventDialogOpen && (
        <EditEventDialog
          onClose={() => {
            setEditEventDialogOpen(false);
          }}
          toModifyEvent={toModifyEvent}
        />
      )}
    </Stack>
  );
}
