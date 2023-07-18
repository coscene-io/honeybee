// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { Skeleton, Typography, Breadcrumbs, Link } from "@mui/material";
import { MutableRefObject, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTitle } from "react-use";
import { makeStyles } from "tss-react/mui";

import { Time } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import Timestamp from "@foxglove/studio-base/components/Timestamp";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneProjectStore,
  useProject,
} from "@foxglove/studio-base/context/CoSceneProjectContext";
import { CoSceneRecordStore, useRecord } from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { subtractTimes } from "@foxglove/studio-base/players/UserNodePlayer/nodeTransformerWorker/typescript/userUtils/time";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { formatDuration } from "@foxglove/studio-base/util/formatTime";
import { fonts } from "@foxglove/studio-base/util/sharedStyleConstants";
import { formatTimeRaw, isAbsoluteTime } from "@foxglove/studio-base/util/time";

const useStyles = makeStyles()({
  overline: {
    opacity: 0.6,
  },
  numericValue: {
    fontFeatureSettings: `${fonts.SANS_SERIF_FEATURE_SETTINGS}, "zero"`,
  },
});

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectRecord = (store: CoSceneRecordStore) => store.record;
const selectProject = (store: CoSceneProjectStore) => store.project;
const selectPlayerSourceId = ({ playerState }: MessagePipelineContext) =>
  playerState.urlState?.sourceId;

function DataSourceInfoContent(props: {
  disableSource?: boolean;
  durationRef: MutableRefObject<ReactNull | HTMLDivElement>;
  endTimeRef: MutableRefObject<ReactNull | HTMLDivElement>;
  playerName?: string;
  playerPresence: PlayerPresence;
  playerSourceId?: string;
  startTime?: Time;
}): JSX.Element {
  const {
    durationRef,
    endTimeRef,
    playerPresence,
    playerSourceId,
    startTime,
    playerName,
    disableSource,
  } = props;
  const { classes } = useStyles();
  const urlState = useMessagePipeline(selectUrlState);
  const record = useRecord(selectRecord);
  const project = useProject(selectProject);
  const { t } = useTranslation("dataSourceInfo");
  const {
    coSceneContext: { currentOrganizationSlug },
  } = useConsoleApi();

  useTitle(`coScene ${record.value?.getTitle() ?? ""}`);

  // foxglove 的变量 我们暂时不会使用 为了减少改动量,防止每次合并foxglove主分支都需要处理一遍 有更好的办法前这里暂时不做删除处理
  if (playerName != undefined && disableSource != undefined) {
    console.debug("playerName is always empty so it will never be output");
  }

  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://home.coscene.dev/${currentOrganizationSlug}/${urlState?.parameters?.projectSlug}`
      : `/${currentOrganizationSlug}/${urlState?.parameters?.projectSlug}`;
  const recordHref = `${projectHref}/records/${record.value?.getName().split("/").pop() ?? ""}`;

  const breadcrumbs = [
    <Link href={projectHref} target="_blank" underline="hover" key="1" color="inherit">
      {project.value?.getDisplayName()}
    </Link>,
    <Link href={recordHref} target="_blank" underline="hover" key="2" color="inherit">
      {record.value?.getTitle()}
    </Link>,
  ];

  const isLiveConnection =
    playerSourceId != undefined
      ? playerSourceId.endsWith("socket") || playerSourceId.endsWith("lidar")
      : false;

  return (
    <Stack gap={1.5}>
      <Stack>
        <Typography className={classes.overline} display="block" variant="overline">
          {t("currentSource")}
        </Typography>
        {playerPresence === PlayerPresence.INITIALIZING ? (
          <Skeleton animation="wave" width="50%" />
        ) : urlState?.parameters?.projectSlug && urlState.parameters.warehouseSlug ? (
          <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
            {breadcrumbs}
          </Breadcrumbs>
        ) : (
          <Typography className={classes.numericValue} variant="inherit">
            &mdash;
          </Typography>
        )}
      </Stack>

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

      {!isLiveConnection && (
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
      )}

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

const MemoDataSourceInfoContent = React.memo(DataSourceInfoContent);

const EmDash = "\u2014";

export function DataSourceInfoView({ disableSource }: { disableSource?: boolean }): JSX.Element {
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerSourceId = useMessagePipeline(selectPlayerSourceId);
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
      playerSourceId={playerSourceId}
      startTime={startTime}
    />
  );
}
