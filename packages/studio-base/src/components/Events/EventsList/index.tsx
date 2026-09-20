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
  Select,
  MenuItem,
  SelectChangeEvent,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { add, fromSec } from "@foxglove/rostime";
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
import { eventListDetails, groupEvents } from "./eventListModel";
import { EMPTY_EVENTS } from "../../PlaybackControls/eventTimeIndex";
import { WindowedList, type WindowedItem } from "../WindowedList";
import { useMomentScrollTarget } from "../useMomentScrollTarget";

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

const selectSetLoopedEvent = (store: TimelineInteractionStateStore) => store.setLoopedEvent;
const selectSetEventsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setEventsAtHoverValue;
const selectProject = (store: CoreDataStore) => store.project;
const selectRecord = (store: CoreDataStore) => store.record;

const ConnectedEventView = memo(function ConnectedEventView(
  props: Omit<React.ComponentProps<typeof EventView>, "isHovered" | "isSelected" | "isLoopedEvent">,
) {
  const name = props.event.event.name;
  const isHovered = useTimelineInteractionState(
    useCallback(
      (store: TimelineInteractionStateStore) =>
        store.hoveredEvent != undefined
          ? store.hoveredEvent.event.name === name
          : store.eventsAtHoverValue[name] != undefined,
      [name],
    ),
  );
  const isLoopedEvent = useTimelineInteractionState(
    useCallback(
      (store: TimelineInteractionStateStore) => store.loopedEvent?.event.name === name,
      [name],
    ),
  );
  const isSelected = useEvents(
    useCallback((store: EventsStore) => store.selectedEventId === name, [name]),
  );
  return (
    <EventView
      {...props}
      isHovered={isHovered}
      isSelected={isSelected}
      isLoopedEvent={isLoopedEvent}
    />
  );
});

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

  const timestampedEvents = useMemo(
    () => groupEvents(events.value ?? EMPTY_EVENTS),
    [events.value],
  );
  const details = useMemo(
    () =>
      new Map(
        (events.value ?? EMPTY_EVENTS).map((event) => [
          event.event.name,
          eventListDetails(event, formatTime),
        ]),
      ),
    [events.value, formatTime],
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setExpanded((previous) => {
      const entries = Object.entries(previous);
      return entries.every(([key]) => timestampedEvents.has(key))
        ? previous
        : Object.fromEntries(entries.filter(([key]) => timestampedEvents.has(key)));
    });
  }, [timestampedEvents]);
  const selectedRef = useRef(selectedEventId);
  selectedRef.current = selectedEventId;
  const creatorCache = useMemo(
    () => ({
      api: consoleApi,
      version: events.value,
      requests: new Map<string, Promise<string>>(),
    }),
    [consoleApi, events.value],
  );
  const getCreator = useCallback(
    async (name: string) => {
      let pending = creatorCache.requests.get(name);
      if (pending == undefined) {
        pending = consoleApi
          .batchGetUsers([name])
          .then((response) => response.users[0]?.nickname ?? "");
        creatorCache.requests.set(name, pending);
        void pending.catch(() => creatorCache.requests.delete(name));
      }
      return await pending;
    },
    [consoleApi, creatorCache],
  );

  const clearFilter = useCallback(() => {
    setFilter("");
  }, [setFilter]);

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

  const onEdit = useCallback(
    (currentEvent: ToModifyEvent) => {
      if (currentEvent.startTime && currentEvent.duration != undefined && startTime && endTime) {
        setEventMarks([
          positionEventMark({ currentTime: currentEvent.startTime, startTime, endTime }),
          positionEventMark({
            currentTime: add(currentEvent.startTime, fromSec(currentEvent.duration)),
            startTime,
            endTime,
          }),
        ]);
        setToModifyEvent(currentEvent);
      }
    },
    [startTime, endTime, setEventMarks, setToModifyEvent],
  );
  const rows = useMemo(() => {
    const result: WindowedItem[] = [];
    let groupIndex = 0;
    const query = filter.toLowerCase();
    for (const [recordTitle, group] of timestampedEvents) {
      const isExpanded = expanded[recordTitle] ?? groupIndex === 0;
      const headerId = `moment-group-${groupIndex++}`;
      result.push({
        key: `group:${recordTitle}`,
        estimatedSize: 44,
        content: (
          <Accordion
            expanded={isExpanded}
            onChange={(_event, value) => {
              setExpanded((old) => ({ ...old, [recordTitle]: value }));
            }}
            className={classes.accordionRoot}
            disableGutters
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              id={headerId}
              className={classes.accordionSummary}
            >
              <div className={classes.accordionTitle} title="test">
                <Stack paddingLeft={0.75}>
                  <span
                    className={classes.colorBlock}
                    style={{ backgroundColor: group[0]?.color }}
                  />
                </Stack>
                <Stack
                  flex={1}
                  overflow="hidden"
                  title={`${t("from", { ns: "general" })} ${group[0]?.projectDisplayName} ${t("project", { ns: "general" })}`}
                >
                  <Typography noWrap>{group[0]?.recordDisplayName}</Typography>
                </Stack>
              </div>
            </AccordionSummary>
            <></>
          </Accordion>
        ),
      });
      if (!isExpanded) {
        continue;
      }
      for (const event of group) {
        const detail = details.get(event.event.name)!;
        if (query !== "" && !detail.search.some((field) => field.includes(query))) {
          continue;
        }
        result.push({
          key: event.event.name,
          estimatedSize: momentVariant === "small" ? 90 : 180,
          content: (
            <div className={classes.accordion}>
              {event === group[0] && <Stack className={classes.line} />}
              <ConnectedEventView
                event={event}
                filter={filter}
                details={detail}
                getCreator={getCreator}
                variant={momentVariant}
                diagnosisRuleData={diagnosisRuleData.value}
                disabledScroll
                onClick={onClick}
                onHoverStart={onHoverStart}
                onHoverEnd={onHoverEnd}
                onEdit={onEdit}
                onSetLoopedEvent={setLoopedEvent}
                confirm={confirm}
              />
            </div>
          ),
        });
      }
    }
    // The original padding belongs to the scrollable content, not the viewport.
    result.push({
      key: "spacer:bottom",
      estimatedSize: 16,
      content: <div style={{ height: 16 }} />,
    });
    return result;
  }, [
    timestampedEvents,
    expanded,
    filter,
    classes,
    t,
    details,
    getCreator,
    momentVariant,
    diagnosisRuleData.value,
    onClick,
    onHoverStart,
    onHoverEnd,
    onEdit,
    setLoopedEvent,
    confirm,
  ]);
  // Match the previous last matching row's scrollIntoView, without requiring it to be mounted.
  const rowOrder = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);
  const hoveredNames = useMemo(
    () =>
      new Set(
        hoveredEvent == undefined ? Object.keys(eventsAtHoverValue) : [hoveredEvent.event.name],
      ),
    [hoveredEvent, eventsAtHoverValue],
  );
  const scrollRequest = useMomentScrollTarget({
    selected: selectedEventId,
    hovered: hoveredNames,
    order: rowOrder,
    disabled: disabledScroll,
  });

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
        style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}
      >
        <WindowedList items={rows} resetKey={momentVariant} scrollRequest={scrollRequest} />
      </div>
    </Stack>
  );
}
