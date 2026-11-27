// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box, Stack, Typography } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()((theme) => ({
  presence: { marginTop: theme.spacing(0.25) },
  presenceCell: {
    width: 3,
    backgroundColor: theme.palette.action.disabledBackground,
  },
  emptyClass: { paddingLeft: theme.spacing(3) },
  emptyInstance: { paddingLeft: theme.spacing(5) },
}));

type PresenceStripProps = {
  instanceName: string;
  color: string;
  /** One character per frame, from `presenceCellsOf`. */
  cells: string;
};

/** Presence of an instance on the 41 frames around the current one. */
export const PresenceStrip = memo(function PresenceStrip({
  instanceName,
  color,
  cells,
}: PresenceStripProps): React.JSX.Element {
  const { classes, theme } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <Stack
      direction="row"
      spacing="1px"
      aria-label={t("presenceAround", { name: instanceName })}
      className={classes.presence}
    >
      {Array.from(cells, (state, cell) => {
        const offset = cell - 20;
        const adjacent = state !== ".";
        const presentAt = state === "1";
        return (
          <Box
            key={offset}
            component="span"
            title={`${offset === 0 ? "Current frame" : `Frame ${offset > 0 ? "+" : ""}${offset}`}: ${!adjacent ? "outside video" : presentAt ? "present" : "absent"}`}
            className={classes.presenceCell}
            style={{
              height: offset === 0 ? 9 : 6,
              backgroundColor: presentAt ? color : theme.palette.action.disabledBackground,
              opacity: adjacent ? 1 : 0.25,
              outline: offset === 0 ? `1px solid ${color}` : undefined,
            }}
          />
        );
      })}
    </Stack>
  );
});

/** A one-line note under a class or instance. */
export const TreeNote = memo(function TreeNote({
  kind,
  text,
}: {
  kind: "emptyClass" | "emptyInstance";
  text: string;
}): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      className={kind === "emptyClass" ? classes.emptyClass : classes.emptyInstance}
    >
      {text}
    </Typography>
  );
});
