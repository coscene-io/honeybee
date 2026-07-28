// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ClearIcon from "@mui/icons-material/Clear";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweepOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import {
  AppBar,
  Button,
  CircularProgress,
  IconButton,
  TextField,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Select,
  MenuItem,
  SelectChangeEvent,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { fromDate, add, fromSec } from "@foxglove/rostime";
import { positionEventMark } from "@foxglove/studio-base/components/Events/EventsSyncAdapter";
import { deleteEventWithFile } from "@foxglove/studio-base/components/Events/deleteEventWithFile";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
  ToModifyEvent,
} from "@foxglove/studio-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";

import { EventView } from "./EventView";

const log = Logger.getLogger(__filename);

const useStyles = makeStyles()((theme) => ({
  appBar: {
    top: -1,
    zIndex: theme.zIndex.appBar - 1,
    display: "flex",
    flexDirection: "row",
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    alignItems: "center",
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  deleteAllButton: {
    alignSelf: "stretch",
    flexShrink: 0,
    margin: 0,
    whiteSpace: "nowrap",
  },
  root: {
    backgroundColor: theme.palette.background.paper,
    maxHeight: "100%",
  },
  accordionTitle: {
    display: "flex",
    flex: 1,
    width: 0,
    alignItems: "center",
    gap: theme.spacing(1),
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  accordion: {
    padding: 0,
    position: "relative",
  },
  colorBlock: {
    width: "8px",
    minWidth: "8px",
    height: "8px",
    minHeight: "8px",
    borderRadius: "100%",
  },
  line: {
    position: "absolute",
    width: "1px",
    height: "12px",
    left: "25.5px",
    top: "-12px",
    backgroundColor: theme.palette.divider,
  },
  accordionRoot: {
    "&.MuiAccordion-root": {
      boxShadow: "none !important",
    },
  },
  accordionSummary: {
    ".MuiAccordionSummary-contentGutters": {
      width: "100%",
    },

    height: 44,
    minHeight: "44px !important",
    padding: "0 16px 0 16px",
    fontSize: "14px",
    fontWeight: 500,
    lineheight: "20px",
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
const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectSetToModifyEvent = (store: EventsStore) => store.setToModifyEvent;
const selectSetEventMarks = (store: EventsStore) => store.setEventMarks;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;

const selectLoopedEvent = (store: TimelineInteractionStateStore) => store.loopedEvent;
const selectSetLoopedEvent = (store: TimelineInteractionStateStore) => store.setLoopedEvent;
const selectSetEventsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setEventsAtHoverValue;
const selectProject = (store: CoreDataStore) => store.project;
const selectRecord = (store: CoreDataStore) => store.record;

export function EventsList(): React.JSX.Element {
  const consoleApi = useConsoleApi();

  const events = useEvents(selectEvents);
  const selectedEventId = useEvents(selectSelectedEventId);
  const selectEvent = useEvents(selectSelectEvent);
  const refreshEvents = useEvents(selectRefreshEvents);
  const { formatTime } = useAppTimeFormat();

  const seek = useMessagePipeline(selectSeek);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);

  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const filter = useEvents(selectEventFilter);
  const setFilter = useEvents(selectSetEventFilter);

  const setLoopedEvent = useTimelineInteractionState(selectSetLoopedEvent);
  const loopedEvent = useTimelineInteractionState(selectLoopedEvent);
  const setEventsAtHoverValue = useTimelineInteractionState(selectSetEventsAtHoverValue);
  const project = useCoreData(selectProject);
  const record = useCoreData(selectRecord);

  const [momentVariant, setMomentVariant] = useState<"small" | "learge">("learge");

  const { t } = useTranslation("event");
  const confirm = useConfirm();

  const setToModifyEvent = useEvents(selectSetToModifyEvent);
  const setEventMarks = useEvents(selectSetEventMarks);

  const [disabledScroll, setDisabledScroll] = useState(false);
  const [isDeletingAllEvents, setIsDeletingAllEvents] = useState(false);
  const allEventCount = events.value?.length ?? 0;
  const canDeleteEvents =
    consoleApi.deleteEvent.permission() &&
    project.value?.isArchived === false &&
    record.value?.isArchived === false;

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

  const onDeleteAllEvents = useCallback(async () => {
    if (!canDeleteEvents) {
      return;
    }

    const eventsToDelete = events.value ?? [];
    if (eventsToDelete.length === 0) {
      return;
    }

    const response = await confirm({
      title: t("deleteAllConfirmTitle"),
      prompt: t("deleteAllConfirmPrompt"),
      ok: t("delete"),
      cancel: t("cancel"),
      variant: "danger",
    });
    if (response !== "ok") {
      return;
    }

    setIsDeletingAllEvents(true);

    try {
      const results = await Promise.allSettled(
        eventsToDelete.map(async (event) => {
          await deleteEventWithFile({ consoleApi, event });
        }),
      );
      const failureCount = results.filter((result) => result.status === "rejected").length;
      const successCount = results.length - failureCount;

      selectEvent(undefined);
      setHoveredEvent(undefined);
      setEventsAtHoverValue([]);
      setLoopedEvent(undefined);
      refreshEvents();

      if (failureCount === 0) {
        toast.success(t("allMomentsDeleted", { count: successCount }));
      } else {
        toast.error(t("deleteAllMomentsPartialFailed", { failureCount, successCount }));
      }
    } finally {
      setIsDeletingAllEvents(false);
    }
  }, [
    canDeleteEvents,
    confirm,
    consoleApi,
    events.value,
    refreshEvents,
    selectEvent,
    setEventsAtHoverValue,
    setHoveredEvent,
    setLoopedEvent,
    t,
  ]);

  const { classes } = useStyles();

  const [diagnosisRuleData, getDiagnosisRule] = useAsyncFn(async () => {
    return await consoleApi.getDiagnosisRule();
  }, [consoleApi]);

  useEffect(() => {
    getDiagnosisRule().catch((error: unknown) => {
      log.error(error);
    });
  }, [getDiagnosisRule]);

  return (
    <Stack className={classes.root} overflow="hidden" fullHeight>
      <AppBar className={classes.appBar} position="sticky" color="inherit" elevation={0}>
        <TextField
          variant="filled"
          fullWidth
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          placeholder={t("searchByKV")}
          slotProps={{
            input: {
              size: "small",
              startAdornment: <SearchIcon fontSize="small" />,
              endAdornment: filter !== "" && (
                <IconButton edge="end" onClick={clearFilter} size="small">
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            },
          }}
        />
        <Select
          variant="filled"
          size="small"
          value={momentVariant}
          onChange={(event: SelectChangeEvent<"small" | "learge">) => {
            switch (event.target.value) {
              case "small":
                setMomentVariant("small");
                break;
              case "learge":
                setMomentVariant("learge");
                break;
              default:
                break;
            }
          }}
        >
          <MenuItem key="small" value="small">
            {t("nameOnly")}
          </MenuItem>
          <MenuItem key="learge" value="learge">
            {t("showDetail")}
          </MenuItem>
        </Select>
        {canDeleteEvents && allEventCount > 0 && (
          <Button
            className={classes.deleteAllButton}
            color="error"
            disabled={isDeletingAllEvents || events.loading}
            onClick={() => void onDeleteAllEvents()}
            size="small"
            startIcon={
              isDeletingAllEvents ? (
                <CircularProgress color="inherit" size={16} />
              ) : (
                <DeleteSweepIcon fontSize="small" />
              )
            }
            variant="outlined"
          >
            {t("deleteAll")}
          </Button>
        )}
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
      {events.value?.length === 0 && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="text.secondary">
            {t("noMoment")}
          </Typography>
        </Stack>
      )}
      <div
        onMouseEnter={() => {
          setDisabledScroll(true);
        }}
        onMouseLeave={() => {
          setDisabledScroll(false);
        }}
        style={{ overflow: "auto", paddingBottom: "16px" }}
      >
        {Array.from(timestampedEvents.keys()).map((recordTitle, index) => {
          return (
            <div key={recordTitle}>
              <Accordion defaultExpanded={index === 0} className={classes.accordionRoot}>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  aria-controls="panel1-content"
                  id="panel1-header"
                  className={classes.accordionSummary}
                >
                  <div className={classes.accordionTitle} title="test">
                    <Stack paddingLeft={0.75}>
                      <span
                        className={classes.colorBlock}
                        style={{
                          backgroundColor: (timestampedEvents.get(recordTitle) ?? [])[0]?.color,
                        }}
                      />
                    </Stack>
                    <Stack
                      flex={1}
                      overflow="hidden"
                      title={`${t("from", { ns: "general" })} ${
                        timestampedEvents.get(recordTitle)?.[0]?.projectDisplayName
                      } ${t("project", { ns: "general" })}`}
                    >
                      <Typography noWrap>
                        {timestampedEvents.get(recordTitle)?.[0]?.recordDisplayName}
                      </Typography>
                    </Stack>
                  </div>
                </AccordionSummary>
                <AccordionDetails className={classes.accordion}>
                  <Stack className={classes.line} />
                  {(timestampedEvents.get(recordTitle) ?? []).map((event) => {
                    return (
                      <EventView
                        key={event.event.name}
                        event={event}
                        filter={filter}
                        variant={momentVariant}
                        diagnosisRuleData={diagnosisRuleData.value}
                        // When hovering within the event list only show hover state on directly
                        // hovered event.
                        isHovered={
                          hoveredEvent
                            ? event.event.name === hoveredEvent.event.name
                            : eventsAtHoverValue[event.event.name] != undefined
                        }
                        isLoopedEvent={loopedEvent?.event.name === event.event.name}
                        disabledScroll={disabledScroll}
                        isSelected={event.event.name === selectedEventId}
                        onClick={onClick}
                        onHoverStart={onHoverStart}
                        onHoverEnd={onHoverEnd}
                        onEdit={(currentEvent: ToModifyEvent) => {
                          if (
                            currentEvent.startTime &&
                            currentEvent.duration != undefined &&
                            startTime &&
                            endTime
                          ) {
                            setEventMarks([
                              positionEventMark({
                                currentTime: fromDate(currentEvent.startTime),
                                startTime,
                                endTime,
                              }),
                              positionEventMark({
                                currentTime: add(
                                  fromDate(currentEvent.startTime),
                                  fromSec(currentEvent.duration),
                                ),
                                startTime,
                                endTime,
                              }),
                            ]);
                            setToModifyEvent(currentEvent);
                          }
                        }}
                        onSetLoopedEvent={setLoopedEvent}
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
    </Stack>
  );
}
