// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import FitScreenIcon from "@mui/icons-material/FitScreen";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { Fade, PopperProps, Slider as MuiSlider, Tooltip } from "@mui/material";
import type { Instance } from "@popperjs/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLatest } from "react-use";
import { makeStyles } from "tss-react/mui";
import { v4 as uuidv4 } from "uuid";

import {
  subtract as subtractTimes,
  add as addTimes,
  toSec,
  fromSec,
  Time,
} from "@foxglove/rostime";
import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { type EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import {
  useClearHoverValue,
  useSetHoverValue,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import {
  type WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@foxglove/studio-base/players/types";

import { BAG_OVERLAY_HEIGHT_PX, BagsOverlay } from "./BagsOverlay";
import { EventsOverlay } from "./EventsOverlay";
import { PlaybackBarHoverTicks } from "./PlaybackBarHoverTicks";
import { PlaybackControlsTooltipContent } from "./PlaybackControlsTooltipContent";
import { ProgressPlot } from "./ProgressPlot";
import { ShortcutsHelpButton } from "./ShortcutsHelpButton";
import Slider, { type ContextMenuEvent, type HoverOverEvent } from "./Slider";
import { layoutEventLanes, EVENT_LANE_HEIGHT_PX } from "./eventLanes";
import {
  clampTimelineViewport,
  clientXToTime,
  getTimelineViewportZoomPercent,
  isViewportZoomed,
  makeTimelineViewport,
  panViewportBySeconds,
  setTimelineViewportZoomPercentAtTime,
  viewportEquals,
  zoomViewportAtTime,
  type TimelineViewport,
} from "./timelineViewport";
import MomentSubtitleActiveIcon from "../../assets/moment-subtitle-active.svg";
import MomentSubtitleInactiveIcon from "../../assets/moment-subtitle-inactive.svg";

const SCRUBBER_TOOLBAR_HEIGHT_PX: number = 32;
const TIMELINE_RULER_HEIGHT_PX: number = 14;
const TIMELINE_BAG_TO_EVENT_GAP_PX: number = 4;
const EVENT_LANE_LAYER_TOP_PX: number =
  TIMELINE_RULER_HEIGHT_PX + BAG_OVERLAY_HEIGHT_PX + TIMELINE_BAG_TO_EVENT_GAP_PX;
const MIN_TIMELINE_CONTENT_HEIGHT_PX: number = 90;
// Synthetic wheel delta applied per Ctrl/Cmd +/- keypress, fed into zoomViewportAtTime.
const ZOOM_KEY_WHEEL_DELTA: number = 300;

function isTimelineZoomEnabled(): boolean {
  return true;
}

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
    position: "relative",
  },
  toolbar: {
    alignItems: "center",
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: "flex",
    flex: `0 0 ${SCRUBBER_TOOLBAR_HEIGHT_PX}px`,
    height: SCRUBBER_TOOLBAR_HEIGHT_PX,
    justifyContent: "space-between",
    paddingInline: theme.spacing(0.5),
  },
  toolbarGroup: {
    alignItems: "center",
    display: "flex",
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  toolbarActions: {
    alignItems: "center",
    display: "flex",
    gap: theme.spacing(0.5),
    marginLeft: "auto",
    minWidth: 0,
  },
  zoomControl: {
    alignItems: "center",
    color: theme.palette.text.secondary,
    display: "flex",
    gap: theme.spacing(0.75),
    minWidth: 240,
    width: 320,
  },
  zoomIcon: {
    color: "currentColor",
    fontSize: 18,
    flex: "0 0 auto",
  },
  zoomSlider: {
    color: theme.palette.text.primary,
    flex: "1 1 auto",
    minWidth: 80,
    paddingBlock: theme.spacing(0.75),

    "& .MuiSlider-rail": {
      opacity: 0.22,
    },
    "& .MuiSlider-thumb": {
      height: 14,
      width: 14,
      borderRadius: 2,
    },
    "& .MuiSlider-track": {
      border: 0,
    },
  },
  timelineViewport: {
    flex: "1 1 auto",
    minHeight: 0,
    overflowX: "hidden",
    overflowY: "auto",
    position: "relative",
  },
  timelineContent: {
    height: "100%",
    position: "relative",
  },
  laneLayer: {
    bottom: 0,
    left: 0,
    pointerEvents: "none",
    position: "absolute",
    right: 0,
    top: EVENT_LANE_LAYER_TOP_PX,
  },
  hoverTickLayer: {
    pointerEvents: "none",
  },
}));

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectEnableList = (store: CoreDataStore) => store.getEnableList();
const selectProject = (store: CoreDataStore) => store.project;
const selectRecord = (store: CoreDataStore) => store.record;
const selectEvents = (store: EventsStore) => store.events;
const selectRollingEditEnabled = (store: WorkspaceContextStore) =>
  store.playbackControls.rollingEditEnabled;
const selectMomentSubtitleEnabled = (store: WorkspaceContextStore) =>
  store.playbackControls.momentSubtitle.enabled;

type Props = {
  onSeek: (seekTo: Time) => void;
};

export type EventContextMenuRequest = ContextMenuEvent;

function dispatchCreateMomentShortcut(): void {
  const event = new KeyboardEvent("keydown", {
    key: "1",
    code: "Digit1",
    keyCode: 49, // '1' keyCode
    which: 49,
    altKey: true, // mock Option (Alt)
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
}

function EventButton({ disableControls }: { disableControls: boolean }): React.JSX.Element {
  const { t } = useTranslation("event");
  const label = t("createMomentTips");

  return (
    <HoverableIconButton
      aria-label={label}
      disabled={disableControls}
      size="small"
      title={label}
      icon={<ShieldOutlinedIcon fontSize="small" />}
      onClick={dispatchCreateMomentShortcut}
    />
  );
}

const MemoedEventButton = React.memo(EventButton);

function MomentSubtitleIcon({ active }: { active: boolean }): React.JSX.Element {
  const Icon = active ? MomentSubtitleActiveIcon : MomentSubtitleInactiveIcon;

  return (
    <span
      aria-hidden="true"
      data-testid={active ? "moment-subtitle-icon-active" : "moment-subtitle-icon-inactive"}
      style={{ display: "inline-flex" }}
    >
      <Icon focusable="false" />
    </span>
  );
}

function MomentSubtitleButton({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("general");
  const label = t(enabled ? "disableMomentSubtitles" : "enableMomentSubtitles");

  return (
    <HoverableIconButton
      aria-label={label}
      color={enabled ? "primary" : "inherit"}
      size="small"
      title={label}
      icon={<MomentSubtitleIcon active={enabled} />}
      onClick={onClick}
    />
  );
}

const MemoedMomentSubtitleButton = React.memo(MomentSubtitleButton);

export default function Scrubber(props: Props): React.JSX.Element {
  const { onSeek } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("general");
  const consoleApi = useConsoleApi();

  const [hoverComponentId] = useState<string>(() => uuidv4());

  const [cursor, setCursor] = useState("pointer");
  const [eventContextMenuRequest, setEventContextMenuRequest] = useState<
    EventContextMenuRequest | undefined
  >(undefined);

  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const presence = useMessagePipeline(selectPresence);
  const enableList = useCoreData(selectEnableList);
  const project = useCoreData(selectProject);
  const record = useCoreData(selectRecord);
  const events = useEvents(selectEvents);
  const rollingEditEnabled = useWorkspaceStore(selectRollingEditEnabled);
  const momentSubtitleEnabled = useWorkspaceStore(selectMomentSubtitleEnabled);
  const {
    playbackControlActions: { setRollingEditEnabled, setMomentSubtitleEnabled },
  } = useWorkspaceActions();

  const setHoverValue = useSetHoverValue();

  type HoverInfo = {
    stamp: Time;
    clientX: number;
    clientY: number;
  };
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | undefined>();
  const latestHoverInfo = useLatest(hoverInfo);

  const latestStartTime = useLatest(startTime);
  const latestEndTime = useLatest(endTime);

  const defaultViewport = useMemo<TimelineViewport | undefined>(() => {
    if (startTime == undefined || endTime == undefined) {
      return undefined;
    }

    return makeTimelineViewport(0, toSec(subtractTimes(endTime, startTime)));
  }, [endTime, startTime]);

  const [viewport, setViewport] = useState<TimelineViewport | undefined>(defaultViewport);
  const [previewEventLaneCount, setPreviewEventLaneCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    setViewport(defaultViewport);
  }, [defaultViewport]);

  const resolvedViewport = viewport ?? defaultViewport;
  const latestViewport = useLatest(resolvedViewport);
  const scrubberRef = useRef<HTMLDivElement | ReactNull>(ReactNull);

  // Keep the playhead visible while zoomed in: when the current time leaves the visible
  // window, page the window so the playhead lands back at its left edge. For forward
  // playback this means the playhead sweeps across the window, and the moment it crosses
  // the right edge the window jumps forward ~one width and the playhead reappears at the
  // start. Only runs on currentTime changes, so panning/zooming while paused is untouched.
  useEffect(() => {
    const currentViewport = latestViewport.current;
    const start = latestStartTime.current;
    if (currentViewport == undefined || start == undefined || currentTime == undefined) {
      return;
    }
    // When fully zoomed out the playhead is always visible, so there is nothing to follow.
    if (!isViewportZoomed(currentViewport)) {
      return;
    }

    const playheadSec = toSec(subtractTimes(currentTime, start));
    if (
      playheadSec >= currentViewport.visibleStartSec &&
      playheadSec <= currentViewport.visibleEndSec
    ) {
      return;
    }

    const visibleDuration = currentViewport.visibleEndSec - currentViewport.visibleStartSec;
    const nextViewport = clampTimelineViewport({
      ...currentViewport,
      visibleStartSec: playheadSec,
      visibleEndSec: playheadSec + visibleDuration,
    });

    setViewport((oldViewport) => {
      const sourceViewport = oldViewport ?? currentViewport;
      return viewportEquals(sourceViewport, nextViewport) ? sourceViewport : nextViewport;
    });
  }, [currentTime, latestViewport, latestStartTime]);

  const onChange = useCallback(
    (playbackSeconds: number) => {
      if (!latestStartTime.current || !latestEndTime.current) {
        return;
      }
      onSeek(addTimes(latestStartTime.current, fromSec(playbackSeconds)));
    },
    [onSeek, latestEndTime, latestStartTime],
  );

  const onHoverOver = useCallback(
    ({ playbackSeconds, clientX, clientY }: HoverOverEvent) => {
      if (!latestStartTime.current || !latestEndTime.current) {
        return;
      }
      const timeFromStart = fromSec(playbackSeconds);
      setHoverInfo({ stamp: addTimes(latestStartTime.current, timeFromStart), clientX, clientY });
      setHoverValue({
        componentId: hoverComponentId,
        type: "PLAYBACK_SECONDS",
        value: toSec(timeFromStart),
      });
    },
    [hoverComponentId, latestEndTime, latestStartTime, setHoverValue],
  );

  const onContextMenu = useCallback((event: ContextMenuEvent): void => {
    setEventContextMenuRequest(event);
  }, []);

  const clearHoverValue = useClearHoverValue();

  const onHoverOut = useCallback(() => {
    clearHoverValue(hoverComponentId);
    setHoverInfo(undefined);
  }, [clearHoverValue, hoverComponentId]);

  // Clean up the hover value when we are unmounted -- important for storybook.
  useEffect(() => onHoverOut, [onHoverOut]);

  const min = useMemo(() => startTime && toSec(startTime), [startTime]);
  const max = useMemo(() => endTime && toSec(endTime), [endTime]);

  const loading = presence === PlayerPresence.INITIALIZING || presence === PlayerPresence.BUFFERING;
  const disableControls = presence === PlayerPresence.ERROR;

  const popperRef = React.useRef<Instance>(ReactNull);

  const isHovered = hoverInfo != undefined;

  const popperProps: Partial<PopperProps> = useMemo(
    () => ({
      open: isHovered, // Keep the tooltip visible while dragging even when the mouse is outside the playback bar
      popperRef,
      modifiers: [
        {
          name: "computeStyles",
          options: {
            gpuAcceleration: false, // Fixes hairline seam on arrow in chrome.
          },
        },
        {
          name: "offset",
          options: {
            // Offset popper to hug the track better.
            offset: [0, 4],
          },
        },
      ],
      anchorEl: {
        getBoundingClientRect: () => {
          return new DOMRect(
            latestHoverInfo.current?.clientX ?? 0,
            latestHoverInfo.current?.clientY ?? 0,
            0,
            0,
          );
        },
      },
    }),
    [isHovered, latestHoverInfo],
  );

  useEffect(() => {
    if (popperRef.current != undefined) {
      void popperRef.current.update();
    }
  }, [hoverInfo]);

  const [isDragging, setIsDragging] = useState(false);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>): void => {
      const currentViewport = latestViewport.current;
      const target = scrubberRef.current;
      if (currentViewport == undefined || target == undefined) {
        return;
      }

      const rect = target.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (!isTimelineZoomEnabled()) {
          return;
        }
        const anchorSec = clientXToTime(event.clientX, rect, currentViewport);
        setViewport((oldViewport) => {
          const sourceViewport = oldViewport ?? currentViewport;
          const nextViewport = zoomViewportAtTime(sourceViewport, anchorSec, event.deltaY);
          return viewportEquals(sourceViewport, nextViewport) ? sourceViewport : nextViewport;
        });
        return;
      }

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        setViewport((oldViewport) => {
          const sourceViewport = oldViewport ?? currentViewport;
          const deltaSec =
            (event.deltaX / Math.max(rect.width, 1)) *
            (sourceViewport.visibleEndSec - sourceViewport.visibleStartSec);
          const nextViewport = panViewportBySeconds(sourceViewport, deltaSec);
          return viewportEquals(sourceViewport, nextViewport) ? sourceViewport : nextViewport;
        });
      }
    },
    [latestViewport],
  );

  const zoomPercent = useMemo(
    () =>
      resolvedViewport != undefined ? getTimelineViewportZoomPercent(resolvedViewport) : undefined,
    [resolvedViewport],
  );

  const zoomAnchorSec = useMemo(() => {
    if (startTime == undefined || currentTime == undefined) {
      return undefined;
    }

    return toSec(subtractTimes(currentTime, startTime));
  }, [currentTime, startTime]);

  const onZoomSliderChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const currentViewport = latestViewport.current;
      if (!isTimelineZoomEnabled() || currentViewport == undefined || zoomAnchorSec == undefined) {
        return;
      }

      const nextZoomPercent = Array.isArray(value) ? value[0] : value;
      if (nextZoomPercent == undefined) {
        return;
      }

      setViewport((oldViewport) => {
        const sourceViewport = oldViewport ?? currentViewport;
        const nextViewport = setTimelineViewportZoomPercentAtTime(
          sourceViewport,
          zoomAnchorSec,
          nextZoomPercent,
        );
        return viewportEquals(sourceViewport, nextViewport) ? sourceViewport : nextViewport;
      });
    },
    [latestViewport, zoomAnchorSec],
  );

  // Keyboard zoom: Ctrl/Cmd +/- zoom in/out (anchored at the playhead), Shift+Z resets to fit.
  const zoomAnchorSecRef = useLatest(zoomAnchorSec);

  const zoomTimelineByKey = useCallback(
    (direction: "in" | "out"): void => {
      setViewport((oldViewport) => {
        const sourceViewport = oldViewport ?? latestViewport.current;
        if (sourceViewport == undefined) {
          return oldViewport;
        }
        const anchorSec =
          zoomAnchorSecRef.current ??
          (sourceViewport.visibleStartSec + sourceViewport.visibleEndSec) / 2;
        const deltaY = direction === "in" ? -ZOOM_KEY_WHEEL_DELTA : ZOOM_KEY_WHEEL_DELTA;
        const nextViewport = zoomViewportAtTime(sourceViewport, anchorSec, deltaY);
        return viewportEquals(sourceViewport, nextViewport) ? sourceViewport : nextViewport;
      });
    },
    [latestViewport, zoomAnchorSecRef],
  );

  // Reset the timeline zoom back to the full recording range.
  const resetZoom = useCallback((): void => {
    if (defaultViewport == undefined) {
      return;
    }
    setViewport(defaultViewport);
  }, [defaultViewport]);

  const zoomKeyDownHandlers = useMemo(
    () => ({
      Equal: (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey)) {
          return false;
        }
        zoomTimelineByKey("in");
        return true;
      },
      Minus: (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey)) {
          return false;
        }
        zoomTimelineByKey("out");
        return true;
      },
      KeyZ: (e: KeyboardEvent) => {
        if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
          return false;
        }
        resetZoom();
        return true;
      },
    }),
    [resetZoom, zoomTimelineByKey],
  );

  const canCreateEvents =
    enableList.event === "ENABLE" &&
    consoleApi.createEvent.permission() &&
    project.value?.isArchived === false &&
    record.value?.isArchived === false;

  const canWriteEvents =
    enableList.event === "ENABLE" &&
    consoleApi.updateEvent.permission() &&
    project.value?.isArchived === false &&
    record.value?.isArchived === false;

  const eventLaneCount = useMemo((): number => {
    if (resolvedViewport == undefined || enableList.event !== "ENABLE") {
      return 0;
    }

    return layoutEventLanes({ events: events.value ?? [], viewport: resolvedViewport }).laneCount;
  }, [enableList.event, events.value, resolvedViewport]);

  const timelineContentHeight = useMemo((): number => {
    const effectiveEventLaneCount = previewEventLaneCount ?? eventLaneCount;

    return Math.max(
      MIN_TIMELINE_CONTENT_HEIGHT_PX,
      EVENT_LANE_LAYER_TOP_PX + Math.max(effectiveEventLaneCount, 1) * EVENT_LANE_HEIGHT_PX,
    );
  }, [eventLaneCount, previewEventLaneCount]);

  const toggleRollingEdit = useCallback((): void => {
    setRollingEditEnabled((old) => !old);
  }, [setRollingEditEnabled]);

  const toggleMomentSubtitle = useCallback((): void => {
    setMomentSubtitleEnabled((old) => !old);
  }, [setMomentSubtitleEnabled]);

  const handlePreviewEventLaneCountChange = useCallback((laneCount: number | undefined): void => {
    setPreviewEventLaneCount(laneCount);
  }, []);

  return (
    <div ref={scrubberRef} className={classes.root} onWheel={onWheel}>
      {isTimelineZoomEnabled() && <KeyListener global keyDownHandlers={zoomKeyDownHandlers} />}
      <div className={classes.toolbar}>
        <div className={classes.toolbarGroup}>
          {canCreateEvents && <MemoedEventButton disableControls={disableControls} />}
        </div>
        <div className={classes.toolbarActions}>
          {isTimelineZoomEnabled() && (
            <div className={classes.zoomControl}>
              <Tooltip title={t("zoomOut")}>
                <ZoomOutIcon className={classes.zoomIcon} />
              </Tooltip>
              <MuiSlider
                aria-label={t("timelineZoom")}
                className={classes.zoomSlider}
                disabled={
                  zoomPercent == undefined ||
                  zoomAnchorSec == undefined ||
                  startTime == undefined ||
                  endTime == undefined
                }
                min={0}
                max={100}
                size="small"
                value={zoomPercent ?? 0}
                onChange={onZoomSliderChange}
              />
              <Tooltip title={t("zoomIn")}>
                <ZoomInIcon className={classes.zoomIcon} />
              </Tooltip>
              <HoverableIconButton
                size="small"
                title={t("shortcutZoomFit")}
                aria-label={t("shortcutZoomFit")}
                icon={<FitScreenIcon fontSize="small" />}
                onClick={resetZoom}
              />
            </div>
          )}
          {enableList.event === "ENABLE" && (
            <MemoedMomentSubtitleButton
              enabled={momentSubtitleEnabled}
              onClick={toggleMomentSubtitle}
            />
          )}
          {canWriteEvents && (
            <HoverableIconButton
              size="small"
              title={t(
                rollingEditEnabled ? "disableLinkedEventAdjustment" : "enableLinkedEventAdjustment",
                { ns: "event" },
              )}
              color={rollingEditEnabled ? "primary" : "inherit"}
              icon={
                rollingEditEnabled ? (
                  <LinkIcon data-testid="rolling-edit-icon-active" fontSize="small" />
                ) : (
                  <LinkOffIcon data-testid="rolling-edit-icon-inactive" fontSize="small" />
                )
              }
              onClick={toggleRollingEdit}
            />
          )}
          <ShortcutsHelpButton />
        </div>
      </div>
      <Tooltip
        title={
          hoverInfo != undefined ? <PlaybackControlsTooltipContent stamp={hoverInfo.stamp} /> : ""
        }
        placement="top"
        disableInteractive
        slotProps={{
          popper: popperProps,
          transition: { timeout: 0 },
        }}
        slots={{
          transition: Fade,
        }}
      >
        <div className={classes.timelineViewport}>
          <div
            className={classes.timelineContent}
            style={{ minHeight: timelineContentHeight }}
            onPointerDown={() => {
              setIsDragging(true);
            }}
            onPointerUp={() => {
              setIsDragging(false);
            }}
            onPointerLeave={() => {
              setIsDragging(false);
            }}
          >
            {resolvedViewport && (
              <Stack
                position="absolute"
                flex="auto"
                fullWidth
                style={{ height: TIMELINE_RULER_HEIGHT_PX, top: 0 }}
              >
                <ProgressPlot loading={loading} viewport={resolvedViewport} />
              </Stack>
            )}
            <Stack fullHeight fullWidth position="absolute" flex={1}>
              {resolvedViewport && (
                <Slider
                  disabled={min == undefined || max == undefined}
                  onContextMenu={onContextMenu}
                  onHoverOver={onHoverOver}
                  onHoverOut={onHoverOut}
                  onChange={onChange}
                  cursor={cursor}
                  viewport={resolvedViewport}
                />
              )}
            </Stack>
            {resolvedViewport && (
              <Stack
                position="absolute"
                fullWidth
                style={{ height: BAG_OVERLAY_HEIGHT_PX, top: TIMELINE_RULER_HEIGHT_PX }}
              >
                <BagsOverlay viewport={resolvedViewport} />
              </Stack>
            )}
            <div className={classes.laneLayer} data-testid="event-lane-layer">
              {resolvedViewport && enableList.event === "ENABLE" && (
                <EventsOverlay
                  componentId={hoverComponentId}
                  canWriteEvents={canWriteEvents}
                  isDragging={isDragging}
                  eventContextMenuRequest={eventContextMenuRequest}
                  onEventContextMenuHandled={() => {
                    setEventContextMenuRequest(undefined);
                  }}
                  onPreviewLaneCountChange={handlePreviewEventLaneCountChange}
                  onSeek={onChange}
                  rollingEditEnabled={rollingEditEnabled}
                  setCursor={setCursor}
                  viewport={resolvedViewport}
                />
              )}
            </div>
            {resolvedViewport && (
              <Stack
                className={classes.hoverTickLayer}
                data-testid="playback-hover-tick-layer"
                fullHeight
                fullWidth
                position="absolute"
                flex={1}
              >
                <PlaybackBarHoverTicks componentId={hoverComponentId} viewport={resolvedViewport} />
              </Stack>
            )}
          </div>
        </div>
      </Tooltip>
    </div>
  );
}
