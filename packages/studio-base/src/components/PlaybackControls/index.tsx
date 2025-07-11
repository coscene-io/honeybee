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

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
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
import { Tooltip, Typography } from "@mui/material";
import { useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Time, compare } from "@foxglove/rostime";
import { DataSourceInfoView } from "@foxglove/studio-base/components/DataSourceInfoView";
import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import CoScenePlabackTimeMode from "@foxglove/studio-base/components/PlaybackControls/CoScenePlabackTimeMode";
import PlaybackQualityControls from "@foxglove/studio-base/components/PlaybackControls/PlaybackQualityControls";
import PlaybackSpeedControls from "@foxglove/studio-base/components/PlaybackSpeedControls";
import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { Player, PlayerPresence } from "@foxglove/studio-base/players/types";

import PlaybackTimeDisplay from "./PlaybackTimeDisplay";
import Scrubber from "./Scrubber";
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
const selectEnableList = (store: CoSceneBaseStore) => store.getEnableList();
const selectProject = (store: CoSceneBaseStore) => store.project;
const selectRecord = (store: CoSceneBaseStore) => store.record;

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
  const enableList = useBaseInfo(selectEnableList);
  const projectInfo = useBaseInfo(selectProject);
  const recordInfo = useBaseInfo(selectRecord);

  const project: Project | undefined = useMemo(() => projectInfo.value ?? undefined, [projectInfo]);
  const record: Record | undefined = useMemo(() => recordInfo.value ?? undefined, [recordInfo]);

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

  const seekForwardAction = useCallback(
    (ev?: KeyboardEvent) => {
      const { currentTime } = getTimeInfo();
      if (!currentTime) {
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
      const targetTime = jumpSeek(DIRECTION.FORWARD, currentTime, ev);

      if (playUntil) {
        playUntil(targetTime);
      } else {
        seek(targetTime);
      }
    },
    [getTimeInfo, playUntil, seek],
  );

  const seekBackwardAction = useCallback(
    (ev?: KeyboardEvent) => {
      const { currentTime } = getTimeInfo();
      if (!currentTime) {
        return;
      }
      seek(jumpSeek(DIRECTION.BACKWARD, currentTime, ev));
    },
    [getTimeInfo, seek],
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
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      <div className={classes.root}>
        <Scrubber onSeek={seek} />
        <Stack direction="row" alignItems="center" flex={1} gap={1} overflowX="auto">
          <Stack direction="row" flex={1} gap={0.5}>
            {enableList.event === "ENABLE" &&
              consoleApi.createEvent.permission() &&
              project?.isArchived === false &&
              record?.isArchived === false && (
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

            <HoverableIconButton
              size="small"
              title="Loop playback"
              disabled={disableControls}
              color={repeatEnabled ? "primary" : "inherit"}
              onClick={toggleRepeat}
              icon={repeat ? <ArrowRepeatAll20Regular /> : <ArrowRepeatAllOff20Regular />}
            />
            <PlaybackSpeedControls />
            <PlaybackQualityControls />
            <CoScenePlabackTimeMode />
          </Stack>
        </Stack>
      </div>
    </>
  );
}
