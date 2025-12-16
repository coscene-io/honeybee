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
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import ShieldTwoToneIcon from "@mui/icons-material/ShieldTwoTone";
import { IconButton, Tooltip, Typography, Link } from "@mui/material";
import { useCallback, useMemo, useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Time, clampTime, compare } from "@foxglove/rostime";
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
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  SubscriptionEntitlementStore,
  useSubscriptionEntitlement,
} from "@foxglove/studio-base/context/SubscriptionEntitlementContext";
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
import { DIRECTION, jumpSeek } from "./sharedHelpers";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    padding: theme.spacing(0.5, 1, 1, 1),
    position: "relative",
    backgroundColor: theme.palette.background.paper,
    borderTop: `1px solid ${theme.palette.divider}`,
    zIndex: 100000,
    overflowX: "auto",
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
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectEnableList = (store: CoreDataStore) => store.getEnableList();
const selectProject = (store: CoreDataStore) => store.project;
const selectRecord = (store: CoreDataStore) => store.record;
const selectDataSource = (store: CoreDataStore) => store.dataSource;
const selectPaid = (store: SubscriptionEntitlementStore) => store.paid;

function MomentButton({ disableControls }: { disableControls: boolean }): React.JSX.Element {
  const { t } = useTranslation("cosEvent");

  return (
    <HoverableIconButton
      disabled={disableControls}
      size="small"
      title={t("createMomentTips")}
      icon={<ShieldOutlinedIcon />}
      activeIcon={<ShieldTwoToneIcon />}
      onClick={() => {
        const event = new KeyboardEvent("keydown", {
          key: "1",
          code: "Digit1",
          keyCode: 49, // '1'  keyCode
          which: 49,
          altKey: true, // mock Option (Alt)
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(event);
      }}
    >
      <Typography variant="body2" marginLeft="4px">
        {t("createMomentButtonText", {
          option: /Mac/i.test(navigator.userAgent) ? "⌥" : "Alt",
        })}
      </Typography>
    </HoverableIconButton>
  );
}

const MemoedMomentButton = React.memo(MomentButton);

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
  const enableList = useCoreData(selectEnableList);
  const project = useCoreData(selectProject);
  const record = useCoreData(selectRecord);

  const dataSource = useCoreData(selectDataSource);
  const paid = useSubscriptionEntitlement(selectPaid);
  const { selectRecent } = usePlayerSelection();

  const projectIsArchived = useMemo(() => project.value?.isArchived, [project]);
  const recordIsArchived = useMemo(() => record.value?.isArchived, [record]);

  const { t } = useTranslation("cosEvent");

  const consoleApi = useConsoleApi();

  const { classes, cx } = useStyles();
  const repeat = useWorkspaceStore(selectPlaybackRepeat);
  const {
    playbackControlActions: { setRepeat },
  } = useWorkspaceActions();

  const toggleRepeat = useCallback(() => {
    // toggle repeat on the workspace
    setRepeat((old) => !old);
  }, [setRepeat]);

  useEffect(() => {
    // if workspace has a preference stored that is not reflected in the iterable player...
    if (repeat !== repeatEnabled) {
      // sync the workspace preference with the iterable player
      enableRepeatPlayback(repeat);
    }
  }, [repeat, repeatEnabled, enableRepeatPlayback]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      const { startTime: start, endTime: end, currentTime: current } = getTimeInfo();
      // if we are at the end, we need to go back to start
      if (current && end && start && compare(current, end) >= 0) {
        seek(start);
      }
      play();
    }
  }, [isPlaying, pause, getTimeInfo, play, seek]);

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

      if (playUntil) {
        playUntil(clampedTargetTime);
      } else {
        seek(clampedTargetTime);
      }
    },
    [getTimeInfo, playUntil, seek, effectiveSeekMs],
  );

  const seekBackwardAction = useCallback(
    (ev?: KeyboardEvent) => {
      const { currentTime } = getTimeInfo();
      if (!currentTime) {
        return;
      }
      seek(jumpSeek(DIRECTION.BACKWARD, currentTime, ev, effectiveSeekMs));
    },
    [getTimeInfo, seek, effectiveSeekMs],
  );

  const keyDownHandlers = useMemo(
    () => ({
      " ": togglePlayPause,
      ArrowLeft: (ev: KeyboardEvent) => {
        seekBackwardAction(ev);
      },
      ArrowRight: (ev: KeyboardEvent) => {
        seekForwardAction(ev);
      },
    }),
    [seekBackwardAction, seekForwardAction, togglePlayPause],
  );

  const disableControls = presence === PlayerPresence.ERROR;

  return (
    <>
      {!seekStepEditing && <KeyListener global keyDownHandlers={keyDownHandlers} />}
      <div className={classes.root}>
        <Scrubber onSeek={seek} />
        <Stack direction="row" alignItems="center" flex={1} gap={1} overflowX="auto">
          <Stack direction="row" flex={1} gap={0.5}>
            {paid &&
              enableList.event === "ENABLE" &&
              consoleApi.createEvent.permission() &&
              projectIsArchived === false &&
              recordIsArchived === false && (
                <MemoedMomentButton disableControls={disableControls} />
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
                icon={<Info20Regular />}
              />
            </Tooltip>
            <PlaybackTimeDisplay onSeek={seek} onPause={pause} />
            {dataSource?.type === "persistent-cache" &&
              dataSource.previousRecentId != undefined && (
                <Tooltip title={t("switchToRealTimeFromPlayback", { ns: "cosWebsocket" })}>
                  <IconButton
                    component="button"
                    size="small"
                    onClick={() => {
                      if (dataSource.previousRecentId != undefined) {
                        selectRecent(dataSource.previousRecentId);
                      }
                    }}
                  >
                    <Typography variant="body2" marginLeft="4px">
                      {t("switchToRealTime", { ns: "cosWebsocket" })}
                    </Typography>
                  </IconButton>
                </Tooltip>
              )}
          </Stack>
          <Stack direction="row" alignItems="center" gap={1}>
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title={t("seekBackward", {
                ns: "cosGeneral",
              })}
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
              title={
                isPlaying
                  ? t("pause", {
                      ns: "cosGeneral",
                    })
                  : t("play", {
                      ns: "cosGeneral",
                    })
              }
              onClick={togglePlayPause}
              icon={isPlaying ? <Pause20Regular /> : <Play20Regular />}
              activeIcon={isPlaying ? <Pause20Filled /> : <Play20Filled />}
            />
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title={t("seekForward", {
                ns: "cosGeneral",
              })}
              icon={<Next20Regular />}
              activeIcon={<Next20Filled />}
              onClick={() => {
                seekForwardAction();
              }}
            />
          </Stack>

          <Stack direction="row" flex={1} alignItems="center" justifyContent="flex-end" gap={0.5}>
            {urlState?.parameters?.jobRunsId != undefined && (
              <>
                <ImageShadow20Filled />
                <div>{t("shadowMode", { ns: "cosPlaylist" })}</div>
              </>
            )}

            <SeekStepControls disabled={disableControls} onEditingChange={setSeekStepEditing} />
            <HoverableIconButton
              size="small"
              title={t("loopPlayback", { ns: "cosGeneral" })}
              disabled={disableControls}
              color={repeatEnabled ? "primary" : "inherit"}
              onClick={toggleRepeat}
              icon={repeat ? <ArrowRepeatAll20Regular /> : <ArrowRepeatAllOff20Regular />}
            />
            <PlaybackSpeedControls />
          </Stack>
        </Stack>
      </div>
    </>
  );
}

export function RealtimeVizPlaybackControls(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cosWebsocket");
  const { dialogActions } = useWorkspaceActions();
  const [retentionWindowMs] = useAppConfigurationValue<number>(AppSetting.RETENTION_WINDOW_MS);
  const { selectSource } = usePlayerSelection();

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
    <div className={classes.root}>
      <Stack direction="row" alignItems="center" flex={1} gap={1} overflowX="auto" paddingTop={0.5}>
        <Stack direction="row" flex={1} gap={0.5}>
          <PlaybackTimeDisplay onSeek={() => {}} onPause={() => {}} />

          <Tooltip
            title={
              retentionWindowMs === 0 ? (
                <Trans
                  i18nKey="noCacheSetPrompt"
                  ns="cosWebsocket"
                  components={{
                    ToSettings: (
                      <Link
                        href="#"
                        onClick={() => {
                          dialogActions.preferences.open("general");
                        }}
                      />
                    ),
                  }}
                />
              ) : (
                <Trans
                  i18nKey="switchToPlaybackDesc"
                  ns="cosWebsocket"
                  values={{ duration: getDurationText(retentionWindowMs ?? 30 * 1000) }}
                  components={{
                    ToSettings: (
                      <Link
                        href="#"
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
                  selectSource("persistent-cache", {
                    type: "persistent-cache",
                  });
                }}
                disabled={retentionWindowMs === 0}
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
