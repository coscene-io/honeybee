// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.
import {
  ArrowRepeatAll20Regular,
  ArrowRepeatAllOff20Regular,
  Info20Regular,
  Next20Filled,
  Next20Regular,
  Pause20Filled,
  Pause20Regular,
  Play20Filled,
  Play20Regular,
  Previous20Filled,
  Previous20Regular,
  ImageShadow20Filled,
} from "@fluentui/react-icons";
import { IconButton, Tooltip, Typography, Link } from "@mui/material";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useLatest, useWindowSize } from "react-use";
import { makeStyles } from "tss-react/mui";

import { Time, areEqual, clampTime, compare } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { DataSourceInfoView } from "@foxglove/studio-base/components/DataSourceInfoView";
import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import PlaybackSpeedControls from "@foxglove/studio-base/components/PlaybackSpeedControls";
import Stack from "@foxglove/studio-base/components/Stack";
import { stepPlaybackSpeed } from "@foxglove/studio-base/components/playbackSpeed";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  selectIsKeyframeSearchActive,
  usePlaybackInteractionState,
} from "@foxglove/studio-base/context/PlaybackInteractionStateContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import { Player, PlayerPresence } from "@foxglove/studio-base/players/types";

import PlaybackTimeDisplay from "./PlaybackTimeDisplay";
import Scrubber from "./Scrubber";
import SeekStepControls, { MIN_SEEK_STEP_MS, MAX_SEEK_STEP_MS } from "./SeekStepControls";
import { TIMELINE_TOOLBAR_HEIGHT_PX } from "./TimelineToolbar";
import { TIMELINE_MIN_HEIGHT_PX } from "./constants";
import { SHORTCUTS, ShortcutHint } from "./keyboardShortcuts";
import { DIRECTION, jumpSeek } from "./sharedHelpers";

const TIMELINE_MAX_HEIGHT_RATIO = 0.8;
const TIMELINE_MAX_HEIGHT_CSS = `${TIMELINE_MAX_HEIGHT_RATIO * 100}vh`;

const useStyles = makeStyles<{ minTimelineHeight: number }>()((theme, { minTimelineHeight }) => ({
  root: {
    backgroundColor: theme.palette.background.paper,
    borderTop: `1px solid ${theme.palette.divider}`,
    display: "flex",
    flexDirection: "column",
    minHeight: `min(${minTimelineHeight}px, ${TIMELINE_MAX_HEIGHT_CSS})`,
    maxHeight: TIMELINE_MAX_HEIGHT_CSS,
    overflow: "hidden",
    position: "relative",
    zIndex: theme.zIndex.appBar,
  },
  resizeHandle: {
    cursor: "ns-resize",
    height: 8,
    left: 0,
    position: "absolute",
    right: 0,
    top: -4,
    zIndex: 1,
    "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
    "&::before": {
      backgroundColor: theme.palette.divider,
      borderRadius: 2,
      content: '""',
      height: 3,
      left: "calc(50% - 16px)",
      position: "absolute",
      top: 4,
      width: 32,
    },

    "&::after": {
      backgroundColor: theme.palette.primary.main,
      content: '""',
      height: 1,
      left: 0,
      opacity: 0,
      position: "absolute",
      right: 0,
      top: 4,
      transition: theme.transitions.create("opacity", {
        duration: theme.transitions.duration.shortest,
      }),
    },

    "&:hover::after": {
      opacity: 0.5,
    },
  },
  realtimeRoot: {
    maxHeight: "none",
    minHeight: 0,
    overflowX: "auto",
    padding: theme.spacing(0.5, 1, 1, 1),
  },
  disabled: {
    opacity: theme.palette.action.disabledOpacity,
  },
  popper: {
    "&[data-popper-placement*=top] .MuiTooltip-tooltip": {
      margin: theme.spacing(0.5, 0.5, 0.75),
    },
  },
  dataSourceInfoButton: {
    cursor: "default",
  },
}));

const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectPlaybackRepeat = (store: WorkspaceContextStore) => store.playbackControls.repeat;
const selectPlaybackSpeed = (store: WorkspaceContextStore) => store.playbackControls.speed;
const selectTimelineHeight = (store: WorkspaceContextStore) =>
  store.playbackControls.timelineHeight;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectRealtimeHistory = (ctx: MessagePipelineContext) => ctx.playerState.realtimeHistory;
const selectDataSource = (store: CoreDataStore) => store.dataSource;

function clampTimelineHeight(value: number, minHeight: number, maxHeight: number): number {
  return Math.min(maxHeight, Math.max(minHeight, value));
}

function getPointerClientY(
  event: Pick<PointerEvent, "clientY" | "pageY" | "screenY"> | React.PointerEvent,
): number {
  const nativeEvent =
    "nativeEvent" in event
      ? (event.nativeEvent as Pick<PointerEvent, "clientY" | "pageY" | "screenY">)
      : undefined;
  const candidates = [
    event.clientY,
    event.pageY,
    event.screenY,
    nativeEvent?.clientY,
    nativeEvent?.pageY,
    nativeEvent?.screenY,
  ];

  return candidates.find((value) => Number.isFinite(value)) ?? 0;
}

export default function PlaybackControls(props: {
  play: NonNullable<Player["startPlayback"]>;
  pause: NonNullable<Player["pausePlayback"]>;
  seek: NonNullable<Player["seekPlayback"]>;
  enableRepeatPlayback: NonNullable<Player["enableRepeatPlayback"]>;
  playUntil?: Player["playUntil"];
  isPlaying: boolean;
  repeatEnabled: boolean;
  getTimeInfo: () => { startTime?: Time; endTime?: Time; currentTime?: Time };
}): React.JSX.Element {
  const {
    play,
    pause,
    seek,
    isPlaying,
    getTimeInfo,
    playUntil,
    repeatEnabled,
    enableRepeatPlayback,
  } = props;
  const presence = useMessagePipeline(selectPresence);
  const urlState = useMessagePipeline(selectUrlState);
  const isKeyframeSearchActive = usePlaybackInteractionState(selectIsKeyframeSearchActive);

  const dataSource = useCoreData(selectDataSource);
  const { selectRecent } = usePlayerSelection();

  const { t } = useTranslation("event");

  const [toolbarHeight, setToolbarHeight] = useState(TIMELINE_TOOLBAR_HEIGHT_PX);
  const minTimelineHeight = TIMELINE_MIN_HEIGHT_PX + toolbarHeight - TIMELINE_TOOLBAR_HEIGHT_PX;
  const minTimelineHeightRef = useLatest(minTimelineHeight);
  const { classes, cx } = useStyles({ minTimelineHeight });
  const repeat = useWorkspaceStore(selectPlaybackRepeat);
  const playbackSpeed = useWorkspaceStore(selectPlaybackSpeed);
  const { height: windowHeight } = useWindowSize();
  const maxTimelineHeight = windowHeight * TIMELINE_MAX_HEIGHT_RATIO;
  const timelineHeight = clampTimelineHeight(
    useWorkspaceStore(selectTimelineHeight),
    minTimelineHeight,
    maxTimelineHeight,
  );
  const {
    playbackControlActions: { setRepeat, setSpeed, setTimelineHeight },
  } = useWorkspaceActions();
  const timelineResizeClientYRef = useRef<number | undefined>(undefined);

  const resizeCleanup = useRef<() => void>(() => {});
  useEffect(
    () => () => {
      resizeCleanup.current();
    },
    [],
  );

  const toggleRepeat = useCallback(() => {
    // toggle repeat on the workspace
    setRepeat((old) => !old);
  }, [setRepeat]);

  const startTimelineResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      resizeCleanup.current();

      timelineResizeClientYRef.current = getPointerClientY(event);

      const onPointerMove = (pointerEvent: PointerEvent): void => {
        const previousClientY = timelineResizeClientYRef.current;
        if (previousClientY == undefined) {
          return;
        }

        const clientY = getPointerClientY(pointerEvent);
        const heightDelta = previousClientY - clientY;
        const maxHeight = window.innerHeight * TIMELINE_MAX_HEIGHT_RATIO;
        timelineResizeClientYRef.current = clientY;

        setTimelineHeight((height) => {
          // Apply each delta to the visible height, which may change when the viewport resizes.
          const minHeight = minTimelineHeightRef.current;
          const visibleHeight = clampTimelineHeight(height, minHeight, maxHeight);
          return clampTimelineHeight(visibleHeight + heightDelta, minHeight, maxHeight);
        });
      };

      const onPointerUp = (): void => {
        resizeCleanup.current();
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      window.addEventListener("pointercancel", onPointerUp, { once: true });
      window.addEventListener("blur", onPointerUp, { once: true });
      resizeCleanup.current = () => {
        timelineResizeClientYRef.current = undefined;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("blur", onPointerUp);
      };
    },
    [minTimelineHeightRef, setTimelineHeight],
  );

  useEffect(() => {
    // if workspace has a preference stored that is not reflected in the iterable player...
    if (repeat !== repeatEnabled) {
      // sync the workspace preference with the iterable player
      enableRepeatPlayback(repeat);
    }
  }, [repeat, repeatEnabled, enableRepeatPlayback]);

  const seekIfAllowed = useCallback(
    (seekTo: Time) => {
      if (isKeyframeSearchActive) {
        return;
      }
      seek(seekTo);
    },
    [isKeyframeSearchActive, seek],
  );

  const togglePlayPause = useCallback(() => {
    if (isKeyframeSearchActive) {
      return;
    }

    if (isPlaying) {
      pause();
    } else {
      const { startTime: start, endTime: end, currentTime: current } = getTimeInfo();
      // if we are at the end, we need to go back to start
      if (current && end && start && compare(current, end) >= 0) {
        seekIfAllowed(start);
      }
      play();
    }
  }, [isKeyframeSearchActive, isPlaying, pause, getTimeInfo, seekIfAllowed, play]);

  // Track SeekStep editing state for KeyListener management
  const [seekStepEditing, setSeekStepEditing] = useState(false);

  // Default seek step control (ms) - get current value for seek actions
  const [seekStepMs] = useAppConfigurationValue<number>(AppSetting.SEEK_STEP_MS);
  const effectiveSeekMs =
    seekStepMs != undefined && seekStepMs >= MIN_SEEK_STEP_MS && seekStepMs <= MAX_SEEK_STEP_MS
      ? seekStepMs
      : 100;

  const seekForwardAction = useCallback(
    (ev?: KeyboardEvent) => {
      if (isKeyframeSearchActive) {
        return;
      }

      const { currentTime, startTime: start, endTime: end } = getTimeInfo();
      if (!currentTime || !start || !end) {
        return;
      }

      // If playUntil is available, we prefer to use that rather than seek, which performs a jump
      // seek.
      //
      // Playing forward up to the desired seek time will play all messages to the panels which
      // mirrors the behavior panels would expect when playing without stepping. This behavior is
      // important for some message types which convey state information.
      //
      // i.e. Skipping coordinate frame messages may result in incorrectly rendered markers or
      // missing markers altogther.
      const targetTime = jumpSeek(DIRECTION.FORWARD, currentTime, ev, effectiveSeekMs);
      const clampedTargetTime = clampTime(targetTime, start, end);

      if (areEqual(clampedTargetTime, currentTime)) {
        return;
      }

      if (playUntil) {
        playUntil(clampedTargetTime);
      } else {
        seekIfAllowed(clampedTargetTime);
      }
    },
    [isKeyframeSearchActive, getTimeInfo, playUntil, seekIfAllowed, effectiveSeekMs],
  );

  const seekBackwardAction = useCallback(
    (ev?: KeyboardEvent) => {
      if (isKeyframeSearchActive) {
        return;
      }

      const { currentTime } = getTimeInfo();
      if (!currentTime) {
        return;
      }
      seekIfAllowed(jumpSeek(DIRECTION.BACKWARD, currentTime, ev, effectiveSeekMs));
    },
    [isKeyframeSearchActive, getTimeInfo, seekIfAllowed, effectiveSeekMs],
  );

  const adjustPlaybackSpeed = useCallback(
    (direction: "decrease" | "increase") => {
      if (isKeyframeSearchActive) {
        return;
      }

      setSpeed(stepPlaybackSpeed(playbackSpeed, direction));
    },
    [isKeyframeSearchActive, playbackSpeed, setSpeed],
  );

  const hasPlaybackSpeedModifier = useCallback(
    (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey,
    [],
  );

  const keyDownHandlers = useMemo(
    () => ({
      " ": (event: KeyboardEvent) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("button") &&
          event.target.closest(
            "[data-timeline-toolbar], [data-moment-track-controls], [role=dialog]",
          )
        ) {
          return false;
        }
        togglePlayPause();
        return true;
      },
      ArrowLeft: (ev: KeyboardEvent) => {
        seekBackwardAction(ev);
      },
      ArrowRight: (ev: KeyboardEvent) => {
        seekForwardAction(ev);
      },
      Minus: (ev: KeyboardEvent) => {
        if (hasPlaybackSpeedModifier(ev)) {
          return false;
        }
        adjustPlaybackSpeed("decrease");
        return true;
      },
      Equal: (ev: KeyboardEvent) => {
        if (hasPlaybackSpeedModifier(ev)) {
          return false;
        }
        adjustPlaybackSpeed("increase");
        return true;
      },
    }),
    [
      adjustPlaybackSpeed,
      hasPlaybackSpeedModifier,
      seekBackwardAction,
      seekForwardAction,
      togglePlayPause,
    ],
  );

  const disableControls = presence === PlayerPresence.ERROR || isKeyframeSearchActive;

  return (
    <>
      {!seekStepEditing && <KeyListener global keyDownHandlers={keyDownHandlers} />}
      <div
        className={classes.root}
        data-testid="playback-controls"
        style={{ height: timelineHeight }}
      >
        <div
          className={classes.resizeHandle}
          data-testid="playback-controls-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label={t("timelineHeight", { ns: "general" })}
          aria-orientation="horizontal"
          aria-valuemin={Math.min(minTimelineHeight, maxTimelineHeight)}
          aria-valuemax={maxTimelineHeight}
          aria-valuenow={timelineHeight}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              setTimelineHeight(
                clampTimelineHeight(
                  timelineHeight + (event.key === "ArrowUp" ? 10 : -10),
                  minTimelineHeight,
                  maxTimelineHeight,
                ),
              );
            }
          }}
          onPointerDown={startTimelineResize}
        />
        <Scrubber
          onSeek={seekIfAllowed}
          onToolbarHeightChange={setToolbarHeight}
          playback={
            <>
              <HoverableIconButton
                disabled={disableControls}
                size="small"
                aria-label={t("seekBackward", { ns: "general" })}
                title={
                  <ShortcutHint
                    label={t("seekBackward", { ns: "general" })}
                    keys={SHORTCUTS.seekBackward}
                  />
                }
                icon={<Previous20Regular />}
                activeIcon={<Previous20Filled />}
                onClick={() => {
                  seekBackwardAction();
                }}
              />
              <HoverableIconButton
                disabled={disableControls}
                size="small"
                id="play-pause-button"
                aria-label={
                  isPlaying ? t("pause", { ns: "general" }) : t("play", { ns: "general" })
                }
                title={
                  <ShortcutHint
                    label={isPlaying ? t("pause", { ns: "general" }) : t("play", { ns: "general" })}
                    keys={SHORTCUTS.playPause}
                  />
                }
                onClick={togglePlayPause}
                icon={isPlaying ? <Pause20Regular /> : <Play20Regular />}
                activeIcon={isPlaying ? <Pause20Filled /> : <Play20Filled />}
              />
              <HoverableIconButton
                disabled={disableControls}
                size="small"
                aria-label={t("seekForward", { ns: "general" })}
                title={
                  <ShortcutHint
                    label={t("seekForward", { ns: "general" })}
                    keys={SHORTCUTS.seekForward}
                  />
                }
                icon={<Next20Regular />}
                activeIcon={<Next20Filled />}
                onClick={() => {
                  seekForwardAction();
                }}
              />
            </>
          }
          playbackOptions={
            <HoverableIconButton
              size="small"
              title={t("loopPlayback", { ns: "general" })}
              aria-label={t("loopPlayback", { ns: "general" })}
              aria-pressed={repeatEnabled}
              disabled={disableControls}
              color={repeatEnabled ? "primary" : "inherit"}
              onClick={toggleRepeat}
              icon={repeat ? <ArrowRepeatAll20Regular /> : <ArrowRepeatAllOff20Regular />}
            />
          }
          seekStep={
            <SeekStepControls disabled={disableControls} onEditingChange={setSeekStepEditing} />
          }
          speed={<PlaybackSpeedControls disabled={disableControls} />}
          time={({ compact }) => (
            <PlaybackTimeDisplay compact={compact} onSeek={seekIfAllowed} onPause={pause} />
          )}
          sourceInfo={
            <>
              {urlState?.parameters?.jobRunsId != undefined && (
                <>
                  <ImageShadow20Filled />
                  <div>{t("shadowMode", { ns: "playList" })}</div>
                </>
              )}
              <Tooltip
                // A desired workflow is the ability to copy data source info text (start, end, duration)
                // from the tooltip. However, there's a UX quirk where the tooltip will close if the user
                // clicks on the <HoverableIconButton> and then goes to copy text from the tooltip.
                //
                // Disabling the focus listener fixes this quirk and the tooltip behaves as expected.
                // https://mui.com/material-ui/api/tooltip/#prop-disableFocusListener
                disableFocusListener
                classes={{ popper: classes.popper }}
                title={
                  <Stack paddingY={0.75}>
                    <DataSourceInfoView disableSource />
                  </Stack>
                }
              >
                <HoverableIconButton
                  className={cx(classes.dataSourceInfoButton, {
                    [classes.disabled]: disableControls,
                  })}
                  size="small"
                  aria-label={t("dataSourceInfo", { ns: "general" })}
                  icon={<Info20Regular />}
                />
              </Tooltip>
              {dataSource?.type === "persistent-cache" &&
                dataSource.previousRecentId != undefined && (
                  <Tooltip title={t("switchToRealTimeFromPlayback", { ns: "websocket" })}>
                    <IconButton
                      component="button"
                      size="small"
                      style={{ width: "auto" }}
                      onClick={() => {
                        if (dataSource.previousRecentId != undefined) {
                          selectRecent(dataSource.previousRecentId);
                        }
                      }}
                    >
                      <Typography variant="body2" marginLeft="4px">
                        {t("switchToRealTime", { ns: "websocket" })}
                      </Typography>
                    </IconButton>
                  </Tooltip>
                )}
            </>
          }
        />
      </div>
    </>
  );
}

export function RealtimeVizPlaybackControls(): React.JSX.Element {
  const { classes, cx } = useStyles({ minTimelineHeight: TIMELINE_MIN_HEIGHT_PX });
  const { t } = useTranslation("websocket");
  const { dialogActions } = useWorkspaceActions();
  const [retentionWindowMs] = useAppConfigurationValue<number>(AppSetting.RETENTION_WINDOW_MS);
  const { selectSource, reloadCurrentSource } = usePlayerSelection();
  const realtimeHistory = useMessagePipeline(selectRealtimeHistory);
  const cacheReady = realtimeHistory?.status === "ready";

  const getDurationText = useCallback(
    (ms: number) => {
      switch (ms) {
        case 0:
          return t("noCache", { ns: "appSettings" });
        case 10 * 1000:
          return `10 ${t("seconds", { ns: "appSettings" })}`;
        case 20 * 1000:
          return `20 ${t("seconds", { ns: "appSettings" })}`;
        case 30 * 1000:
          return `30 ${t("seconds", { ns: "appSettings" })}`;
        case 60 * 1000:
          return `1 ${t("minutes", { ns: "appSettings" })}`;
        case 1 * 60 * 1000:
          return `1 ${t("minutes", { ns: "appSettings" })}`;
        case 2 * 60 * 1000:
          return `2 ${t("minutes", { ns: "appSettings" })}`;
        case 3 * 60 * 1000:
          return `3 ${t("minutes", { ns: "appSettings" })}`;
        case 5 * 60 * 1000:
          return `5 ${t("minutes", { ns: "appSettings" })}`;
        default:
          return "";
      }
    },
    [t],
  );

  return (
    <div className={cx(classes.root, classes.realtimeRoot)}>
      <Stack direction="row" alignItems="center" flex={1} gap={1} overflowX="auto" paddingTop={0.5}>
        <Stack direction="row" flex={1} gap={0.5}>
          <PlaybackTimeDisplay onSeek={() => {}} onPause={() => {}} />

          <Tooltip
            title={
              realtimeHistory?.status === "disabled" && retentionWindowMs === 0 ? (
                <Trans
                  i18nKey="noCacheSetPrompt"
                  ns="websocket"
                  components={{
                    ToSettings: (
                      <Link
                        href="#"
                        target="_self"
                        onClick={() => {
                          dialogActions.preferences.open("general");
                        }}
                      />
                    ),
                  }}
                />
              ) : realtimeHistory?.status === "disabled" ? (
                <Trans
                  i18nKey="cacheRequiresReconnectPrompt"
                  ns="websocket"
                  components={{
                    Reconnect: (
                      <Link
                        href="#"
                        target="_self"
                        onClick={(event) => {
                          event.preventDefault();
                          void reloadCurrentSource();
                        }}
                      />
                    ),
                  }}
                />
              ) : realtimeHistory == undefined || realtimeHistory.status === "initializing" ? (
                t("cachePreparingPrompt")
              ) : realtimeHistory.status === "unavailable" ? (
                <Trans
                  i18nKey="cacheUnavailablePrompt"
                  ns="websocket"
                  components={{
                    Reconnect: (
                      <Link
                        href="#"
                        target="_self"
                        onClick={(event) => {
                          event.preventDefault();
                          void reloadCurrentSource();
                        }}
                      />
                    ),
                  }}
                />
              ) : (
                <Trans
                  i18nKey="switchToPlaybackDesc"
                  ns="websocket"
                  values={{ duration: getDurationText(realtimeHistory.retentionWindowMs) }}
                  components={{
                    ToSettings: (
                      <Link
                        href="#"
                        target="_self"
                        onClick={() => {
                          dialogActions.preferences.open("general");
                        }}
                      />
                    ),
                  }}
                />
              )
            }
          >
            <span>
              <IconButton
                component="button"
                size="small"
                onClick={() => {
                  if (!cacheReady) {
                    return;
                  }
                  selectSource("persistent-cache", {
                    type: "persistent-cache",
                  });
                }}
                disabled={!cacheReady}
              >
                <Typography variant="body2" marginLeft="4px">
                  {t("switchToPlayback")}
                </Typography>
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    </div>
  );
}
