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
  Pause20Filled,
  Pause20Regular,
  Play20Filled,
  Play20Regular,
  Next20Filled,
  Next20Regular,
  Previous20Filled,
  Previous20Regular,
  ImageShadow20Filled,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useKeyboardJs from "react-use/lib/useKeyboardJs";
import { makeStyles } from "tss-react/mui";

import { compare, Time } from "@foxglove/rostime";
import { CreateEventDialog } from "@foxglove/studio-base/components/CreateEventDialog";
import EventIcon from "@foxglove/studio-base/components/EventIcon";
import EventOutlinedIcon from "@foxglove/studio-base/components/EventOutlinedIcon";
import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import LoopIcon from "@foxglove/studio-base/components/LoopIcon";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import PlaybackQualityControls from "@foxglove/studio-base/components/PlaybackControls/PlaybackQualityControls";
import PlaybackSpeedControls from "@foxglove/studio-base/components/PlaybackSpeedControls";
import Stack from "@foxglove/studio-base/components/Stack";
import { Player, PlayerPresence } from "@foxglove/studio-base/players/types";

import PlaybackTimeDisplay from "./PlaybackTimeDisplay";
import { RepeatAdapter } from "./RepeatAdapter";
import Scrubber from "./Scrubber";
import { jumpSeek, DIRECTION } from "./sharedHelpers";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    padding: theme.spacing(0.5, 1, 1, 1),
    position: "relative",
    backgroundColor: theme.palette.background.paper,
    borderTop: `1px solid ${theme.palette.divider}`,
    zIndex: 100000,
  },
  createMoment: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 0,
  },
}));

const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export default function PlaybackControls(props: {
  play: NonNullable<Player["startPlayback"]>;
  pause: NonNullable<Player["pausePlayback"]>;
  seek: NonNullable<Player["seekPlayback"]>;
  playUntil?: Player["playUntil"];
  isPlaying: boolean;
  getTimeInfo: () => { startTime?: Time; endTime?: Time; currentTime?: Time };
}): JSX.Element {
  const isDemoSite =
    localStorage.getItem("demoSite") === "true" && localStorage.getItem("joyrideStepIndex") === "5";

  const { play, pause, seek, isPlaying, getTimeInfo, playUntil } = props;
  const presence = useMessagePipeline(selectPresence);
  const urlState = useMessagePipeline(selectUrlState);
  const { t } = useTranslation("cosEvent");

  const { classes } = useStyles();
  const [repeat, setRepeat] = useState(false);
  const [createEventDialogOpen, setCreateEventDialogOpen] = useState(false);

  const [createEventShortcutKeys] = useKeyboardJs("alt > m");

  const toggleRepeat = useCallback(() => {
    setRepeat((old) => !old);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isDemoSite) {
      window.nextStep();
    }
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

  const toggleCreateEventDialog = useCallback(() => {
    pause();
    setCreateEventDialogOpen((open) => !open);
    if (isDemoSite) {
      setTimeout(() => {
        window.nextStep();
      }, 100);
    }
  }, [pause, isDemoSite]);

  useEffect(() => {
    if (createEventShortcutKeys) {
      toggleCreateEventDialog();
    }
  }, [toggleCreateEventDialog, createEventShortcutKeys]);

  const disableControls = presence === PlayerPresence.ERROR;

  return (
    <>
      <RepeatAdapter play={play} seek={seek} repeatEnabled={repeat} />
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      <div className={classes.root}>
        <Scrubber onSeek={seek} />
        <Stack direction="row" alignItems="center" flex={1} gap={1} overflowX="auto">
          <Stack direction="row" flex={1} gap={0.5}>
            <HoverableIconButton
              size="small"
              title={t("createMoment")}
              icon={<EventOutlinedIcon />}
              activeIcon={<EventIcon />}
              onClick={toggleCreateEventDialog}
            >
              <p className={classes.createMoment}>{`${t("createMoment")} (⎇ / ⌥ + M)`}</p>
            </HoverableIconButton>
            <PlaybackTimeDisplay onSeek={seek} onPause={pause} />
          </Stack>
          <Stack direction="row" alignItems="center" gap={1}>
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title="Seek backward"
              icon={<Previous20Regular />}
              activeIcon={<Previous20Filled />}
              onClick={() => seekBackwardAction()}
            />
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              id="play-pause-button"
              title={isPlaying ? "Pause" : "Play"}
              onClick={togglePlayPause}
              icon={isPlaying ? <Pause20Regular /> : <Play20Regular />}
              activeIcon={isPlaying ? <Pause20Filled /> : <Play20Filled />}
            />
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title="Seek forward"
              icon={<Next20Regular />}
              activeIcon={<Next20Filled />}
              onClick={() => seekForwardAction()}
            />
          </Stack>

          <Stack direction="row" flex={1} alignItems="center" justifyContent="flex-end" gap={0.5}>
            {urlState?.parameters?.jobRunsId && (
              <>
                <ImageShadow20Filled />
                <div>{t("shadowMode", { ns: "cosPlaylist" })}</div>
              </>
            )}

            <HoverableIconButton
              size="small"
              title="Loop playback"
              color={repeat ? "primary" : "inherit"}
              onClick={toggleRepeat}
              icon={repeat ? <LoopIcon strokeWidth={1.9375} /> : <LoopIcon strokeWidth={1.375} />}
              activeIcon={<LoopIcon strokeWidth={1.875} />}
            />
            <PlaybackSpeedControls />
            <PlaybackQualityControls />
          </Stack>
        </Stack>
        {createEventDialogOpen && <CreateEventDialog onClose={toggleCreateEventDialog} />}
      </div>
    </>
  );
}
