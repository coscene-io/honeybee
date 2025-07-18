// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Paper } from "@mui/material";
import { isNumber } from "mathjs";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles<void, "selected">()((theme, _props, classes) => ({
  selected: {},
  root: {
    display: "flex",
    borderRadius: "1em",
    color: theme.palette.action.selected,
    borderColor: "currentColor",
    backgroundColor: theme.palette.background.paper,
    cursor: "grab",

    [`@container (max-width: 180px)`]: {
      display: "none",
    },
    ...(theme.palette.mode === "dark" && {
      [`&.${classes.selected}`]: { color: theme.palette.primary.main },
    }),
  },
  stat: {
    whiteSpace: "nowrap",
    minWidth: "1em",
    textAlign: "center",
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.secondary,
    paddingBlock: theme.spacing(0.25),
    fontFeatureSettings: `${theme.typography.fontFeatureSettings}, 'tnum'`,

    "&:first-of-type": {
      paddingInlineStart: theme.spacing(0.75),

      [`@container (max-width: 280px)`]: {
        paddingInlineEnd: theme.spacing(0.75),
      },
    },
    "&:last-of-type": {
      paddingInlineEnd: theme.spacing(0.75),

      [`@container (max-width: 280px)`]: {
        display: "none",
      },
    },
  },
  divider: {
    borderColor: "currentColor",
    marginInline: theme.spacing(0.5),

    [`@container (max-width: 280px)`]: {
      display: "none",
    },
  },
}));

export function TopicStatsChip({
  topicName,
  selected,
  messageFrequency,
  messageCount,
}: {
  topicName: string;
  selected: boolean;
  messageFrequency: number;
  messageCount: number;
}): React.JSX.Element {
  const { classes, cx } = useStyles();

  return (
    <Paper variant="outlined" className={cx(classes.root, { [classes.selected]: selected })}>
      <div className={classes.stat} data-topic={topicName} data-topic-stat="frequency">
        {isNumber(messageFrequency) ? messageFrequency : "-"}
      </div>
      <Divider className={classes.divider} orientation="vertical" flexItem />
      <div className={classes.stat} data-topic={topicName} data-topic-stat="count">
        {messageCount}
      </div>
    </Paper>
  );
}
