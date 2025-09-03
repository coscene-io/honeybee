// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Avatar, Box, Chip, TableCell, TableRow, Typography } from "@mui/material";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutActions } from "@foxglove/studio-base/components/CoSceneLayout/LayoutActions";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { LayoutID } from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

const useStyles = makeStyles()((theme) => ({
  updaterCell: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    justifyContent: "flex-end",
  },
  avatar: {
    width: 24,
    height: 24,
    fontSize: "0.75rem",
  },
}));

interface LayoutTableRowProps {
  currentLayoutId?: LayoutID;
  layout: Layout;
  handleMenuOpen: (event: React.MouseEvent<HTMLElement>, layout: Layout) => void;
  onSelectLayout: (layout: Layout) => void;
  onOverwriteLayout: (layout: Layout) => void;
  onRevertLayout: (layout: Layout) => void;
}

export function LayoutTableRow({
  currentLayoutId,
  layout,
  handleMenuOpen,
  onSelectLayout,
  onOverwriteLayout,
  onRevertLayout,
}: LayoutTableRowProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cosLayout");

  const formatTimestamp = (timestamp: { seconds: number | bigint } | undefined) => {
    if (!timestamp) {
      return "-";
    }
    const date = new Date(Number(timestamp.seconds) * 1000);
    return dayjs(date).format("YYYY-MM-DD HH:mm:ss");
  };

  return (
    <TableRow key={layout.id} hover>
      <TableCell>
        {layout.displayName}
        {currentLayoutId === layout.id && <Chip size="small" color="success" label={t("inUse")} />}
      </TableCell>
      <TableCell>
        {formatTimestamp(layout.working?.modifyTime ?? layout.baseline.modifyTime)}
      </TableCell>
      <TableCell>
        <Box className={classes.updaterCell}>
          <Avatar className={classes.avatar}>U</Avatar>
          <Typography variant="body2">user</Typography>
        </Box>
      </TableCell>
      <TableCell align="right">
        <LayoutActions
          layout={layout}
          handleMenuOpen={handleMenuOpen}
          onSelectLayout={onSelectLayout}
          onOverwriteLayout={onOverwriteLayout}
          onRevertLayout={onRevertLayout}
        />
      </TableCell>
    </TableRow>
  );
}
