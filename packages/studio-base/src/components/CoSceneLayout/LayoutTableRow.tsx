// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { Layout, layoutIsRead } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  layoutNameCell: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  updaterCell: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  avatar: {
    width: 24,
    height: 24,
    fontSize: "0.75rem",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    justifyContent: "flex-end",
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

  const deletedOnServer = layout.syncInfo?.status === "remotely-deleted";
  const hasModifications = layout.working != undefined;
  const isRead = layoutIsRead(layout);

  const handleUse = () => {
    onSelectLayout(layout);
  };

  const handleOverwrite = () => {
    onOverwriteLayout(layout);
  };

  const handleRevert = () => {
    onRevertLayout(layout);
  };

  const buttons = [
    {
      key: "saveChanges",
      text: t("saveChanges"),
      onClick: handleOverwrite,
      disabled: deletedOnServer || isRead,
      visible: hasModifications,
    },
    {
      key: "revert",
      text: t("revert"),
      onClick: handleRevert,
      disabled: deletedOnServer,
      visible: hasModifications,
    },
    {
      key: "use",
      text: t("use"),
      onClick: handleUse,
    },
  ].filter((button) => button.visible ?? true);

  const savedAt = layout.baseline.savedAt;

  return (
    <TableRow key={layout.id} hover>
      <TableCell>
        <Box className={classes.layoutNameCell}>
          {layout.name}
          {currentLayoutId === layout.id && (
            <Chip size="small" color="success" label={t("inUse")} />
          )}
        </Box>
      </TableCell>
      <TableCell>{savedAt ? dayjs(savedAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</TableCell>
      <TableCell>
        <Box className={classes.updaterCell}>
          <Avatar className={classes.avatar} src={layout.baseline.modifierAvatar}>
            {layout.baseline.modifierNickname?.split("/").pop()}
          </Avatar>
          <Typography variant="body2">{layout.baseline.modifierNickname}</Typography>
        </Box>
      </TableCell>
      <TableCell align="right">
        <Box className={classes.actions}>
          {buttons.map((button) => (
            <Button
              key={button.key}
              variant="outlined"
              size="small"
              onClick={button.onClick}
              disabled={button.disabled}
            >
              {button.text}
            </Button>
          ))}

          <IconButton
            size="small"
            onClick={(event) => {
              handleMenuOpen(event, layout);
            }}
          >
            <MoreVertIcon />
          </IconButton>
        </Box>
      </TableCell>
    </TableRow>
  );
}
