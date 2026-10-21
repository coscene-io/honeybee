// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Typography } from "@mui/material";
import { useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { Time } from "@foxglove/rostime";
import Stack from "@foxglove/studio-base/components/Stack";
import { usePlaybackTimeFormat } from "@foxglove/studio-base/hooks";
import { formatSourceTime } from "@foxglove/studio-base/util/formatTime";
import { isAbsoluteTime, formatTimeRaw } from "@foxglove/studio-base/util/time";

type Props = {
  disableDate?: boolean;
  horizontal?: boolean;
  time: Time;
  title?: string;
};

const useStyles = makeStyles()((theme) => ({
  numericValue: {
    fontFeatureSettings: `${theme.typography.fontFeatureSettings}, "zero"`,
  },
}));

export default function Timestamp(props: Props): React.JSX.Element {
  const { classes } = useStyles();
  const { disableDate = false, horizontal = false, time, title } = props;
  const { formatDate, formatTime, timeFormat, timeZone } = usePlaybackTimeFormat();
  const currentTimeStr = useMemo(() => formatTime(time), [time, formatTime]);
  const rawTimeStr = useMemo(() => formatTimeRaw(time), [time]);
  const date = useMemo(() => formatDate(time), [formatDate, time]);

  if (timeFormat !== "REL" && !isAbsoluteTime(time)) {
    return (
      <Stack title={title} direction="row" alignItems="center" flexGrow={0}>
        <Typography className={classes.numericValue} variant="inherit">
          {rawTimeStr}
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack
      title={title ?? (timeFormat === "REL" ? formatSourceTime(time, timeZone) : undefined)}
      gap={horizontal ? 0 : 1}
      flexWrap={horizontal ? "nowrap" : "wrap"}
      direction={horizontal ? "row" : "column"}
      alignItems={horizontal ? "center" : "flex-start"}
      justifyContent={horizontal ? "flex-start" : "center"}
    >
      {!disableDate && timeFormat !== "REL" && (
        <>
          <Typography
            className={classes.numericValue}
            noWrap
            fontWeight={!horizontal ? 700 : undefined}
            variant="inherit"
          >
            {date}
          </Typography>
          {horizontal && <>&nbsp;</>}
        </>
      )}

      <Stack direction="row" alignItems="center" flexShrink={0} gap={0.5}>
        <Typography variant="inherit" className={classes.numericValue}>
          {currentTimeStr}
        </Typography>
      </Stack>
    </Stack>
  );
}
