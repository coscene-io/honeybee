// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { Skeleton, Typography, Breadcrumbs, Link } from "@mui/material";
import { MutableRefObject, useEffect, useRef } from "react";
import { useAsyncFn, useTitle } from "react-use";
import { makeStyles } from "tss-react/mui";

import { Time } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import Timestamp from "@foxglove/studio-base/components/Timestamp";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { subtractTimes } from "@foxglove/studio-base/players/UserNodePlayer/nodeTransformerWorker/typescript/userUtils/time";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { formatDate, formatDuration } from "@foxglove/studio-base/util/formatTime";
import { fonts } from "@foxglove/studio-base/util/sharedStyleConstants";
import { formatTimeRaw, isAbsoluteTime } from "@foxglove/studio-base/util/time";

const useStyles = makeStyles()({
  numericValue: {
    fontFamily: fonts.MONOSPACE,
  },
});

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

function DataSourceInfoContent(props: {
  durationRef: MutableRefObject<ReactNull | HTMLDivElement>;
  endTimeRef: MutableRefObject<ReactNull | HTMLDivElement>;
  playerPresence: PlayerPresence;
  startTime?: Time;
}): JSX.Element {
  const { durationRef, endTimeRef, playerPresence, startTime } = props;
  const { classes } = useStyles();
  const consoleApi = useConsoleApi();
  const urlState = useMessagePipeline(selectUrlState);

  const [state, fetch] = useAsyncFn(
    async ({
      warehouseId,
      projectId,
      recordId,
    }: {
      warehouseId: string;
      projectId: string;
      recordId: string;
    }) => {
      const recordName = `warehouses/${warehouseId}/projects/${projectId}/records/${recordId}`;
      return await consoleApi.getRecord({ recordName });
    },
  );

  useTitle(`coScene ${state.value?.getTitle() ?? ""}`);

  useEffect(() => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState.parameters.projectId &&
      urlState.parameters.recordId
    ) {
      fetch({
        warehouseId: urlState.parameters.warehouseId,
        projectId: urlState.parameters.projectId,
        recordId: urlState.parameters.recordId,
      }).catch((err) => {
        console.error("Error fetching record", err);
      });
    }
  }, [urlState?.parameters, fetch]);

  const projectHref =
    process.env.NODE_ENV === "development"
      ? `https://home.coscene.dev/${urlState?.parameters?.warehouseSlug}/${urlState?.parameters?.projectSlug}`
      : `/${urlState?.parameters?.warehouseSlug}/${urlState?.parameters?.projectSlug}`;
  const recordHref = `${projectHref}/records/${urlState?.parameters?.recordId}`;

  const breadcrumbs = [
    <Link href={projectHref} underline="hover" key="1" color="inherit">
      {urlState?.parameters?.projectSlug}
    </Link>,
    <Link href={recordHref} underline="hover" key="2" color="inherit">
      {state.value?.getTitle()}
    </Link>,
    <Typography key="3" color="text.primary">
      Current
    </Typography>,
  ];

  return (
    <Stack gap={1.5} paddingX={2} paddingBottom={2}>
      <Stack>
        <Typography display="block" variant="overline" color="text.secondary">
          Current source
        </Typography>
      </Stack>

      <Stack>
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
        <Typography variant="overline" color="text.secondary">
          Start time
        </Typography>
        {playerPresence === PlayerPresence.INITIALIZING ? (
          <Skeleton animation="wave" width="50%" />
        ) : startTime ? (
          <Timestamp horizontal time={startTime} />
        ) : (
          <Typography className={classes.numericValue} variant="inherit" color="text.secondary">
            &mdash;
          </Typography>
        )}
      </Stack>

      <Stack>
        <Typography variant="overline" color="text.secondary">
          End time
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
        <Typography variant="overline" color="text.secondary">
          Duration
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

export function DataSourceInfoView(): JSX.Element {
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const durationRef = useRef<HTMLDivElement>(ReactNull);
  const endTimeRef = useRef<HTMLDivElement>(ReactNull);
  const { formatTime } = useAppTimeFormat();

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
        const date = formatDate(endTime, undefined);
        endTimeRef.current.innerText = !isAbsoluteTime(endTime)
          ? `${formatTimeRaw(endTime)}`
          : `${date} ${formatTime(endTime)}`;
      } else {
        endTimeRef.current.innerHTML = EmDash;
      }
    }
  }, [endTime, formatTime, startTime, playerPresence]);

  return (
    <MemoDataSourceInfoContent
      durationRef={durationRef}
      endTimeRef={endTimeRef}
      playerPresence={playerPresence}
      startTime={startTime}
    />
  );
}
