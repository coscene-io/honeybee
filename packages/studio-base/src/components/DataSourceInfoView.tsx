// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Skeleton, Typography } from "@mui/material";
import { MutableRefObject, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTitle } from "react-use";
import { makeStyles } from "tss-react/mui";

import { subtract as subtractTimes, Time } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import Timestamp from "@foxglove/studio-base/components/Timestamp";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { formatDuration } from "@foxglove/studio-base/util/formatTime";
import { formatTimeRaw, isAbsoluteTime } from "@foxglove/studio-base/util/time";

const useStyles = makeStyles()((theme) => ({
  overline: {
    opacity: 0.6,
  },
  numericValue: {
    fontFeatureSettings: `${theme.typography.fontFeatureSettings}, "zero"`,
  },
}));

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

function DataSourceInfoContent(props: {
  disableSource?: boolean;
  durationRef: MutableRefObject<ReactNull | HTMLDivElement>;
  endTimeRef: MutableRefObject<ReactNull | HTMLDivElement>;
  playerName?: string;
  playerPresence: PlayerPresence;
  startTime?: Time;
  isLiveConnection: boolean;
}): JSX.Element {
  const urlState = useMessagePipeline(selectUrlState);

  const {
    durationRef,
    isLiveConnection,
    endTimeRef,
    playerPresence,
    startTime,
    playerName,
    disableSource,
  } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("dataSourceInfo");

  useTitle(`coScene ${urlState?.parameters?.recordDisplayName ?? ""}`);

  // foxglove 的变量 我们暂时不会使用 为了减少改动量,防止每次合并foxglove主分支都需要处理一遍 有更好的办法前这里暂时不做删除处理
  if (playerName != undefined && disableSource != undefined) {
    console.debug("playerName is always empty so it will never be output");
  }

  if (isLiveConnection) {
    console.debug("isLiveConnection is always true so it will never be output");
  }

  {
    return (
      <Stack gap={1.5}>
        <Stack>
          <Typography className={classes.overline} variant="overline">
            {t("startTime")}
          </Typography>
          {playerPresence === PlayerPresence.INITIALIZING ? (
            <Skeleton animation="wave" width="50%" />
          ) : startTime ? (
            <Timestamp horizontal time={startTime} />
          ) : (
            <Typography className={classes.numericValue} variant="inherit">
              &mdash;
            </Typography>
          )}
        </Stack>

        <Stack>
          <Typography className={classes.overline} variant="overline">
            {t("endTime")}
          </Typography>
          {playerPresence === PlayerPresence.INITIALIZING ? (
            <Skeleton animation="wave" width="50%" />
          ) : (
            <Typography className={classes.numericValue} variant="inherit" ref={endTimeRef}>
              &mdash;
            </Typography>
          )}
        </Stack>

        <Stack>
          <Typography className={classes.overline} variant="overline">
            {t("duration")}
          </Typography>
          {playerPresence === PlayerPresence.INITIALIZING ? (
            <Skeleton animation="wave" width={100} />
          ) : (
            <Typography className={classes.numericValue} variant="inherit" ref={durationRef}>
              &mdash;
            </Typography>
          )}
        </Stack>
      </Stack>
    );
  }
}

const MemoDataSourceInfoContent = React.memo(DataSourceInfoContent);

const EmDash = "\u2014";

export function DataSourceInfoView({ disableSource }: { disableSource?: boolean }): JSX.Element {
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const seek = useMessagePipeline(selectSeek);

  const durationRef = useRef<HTMLDivElement>(ReactNull);
  const endTimeRef = useRef<HTMLDivElement>(ReactNull);
  const { formatDate, formatTime } = useAppTimeFormat();

  // We bypass react and update the DOM elements directly for better performance here.
  useEffect(() => {
    if (durationRef.current) {
      const duration = endTime && startTime ? subtractTimes(endTime, startTime) : undefined;
      if (duration) {
        const durationStr = formatDuration(duration);
        durationRef.current.innerText = durationStr;
      } else {
        durationRef.current.innerText = EmDash;
      }
    }
    if (endTimeRef.current) {
      if (endTime) {
        const date = formatDate(endTime);
        endTimeRef.current.innerText = !isAbsoluteTime(endTime)
          ? `${formatTimeRaw(endTime)}`
          : `${date} ${formatTime(endTime)}`;
      } else {
        endTimeRef.current.innerHTML = EmDash;
      }
    }
  }, [endTime, formatTime, startTime, playerPresence, formatDate]);

  return (
    <MemoDataSourceInfoContent
      disableSource={disableSource}
      durationRef={durationRef}
      endTimeRef={endTimeRef}
      playerPresence={playerPresence}
      startTime={startTime}
      isLiveConnection={seek == undefined}
    />
  );
}
