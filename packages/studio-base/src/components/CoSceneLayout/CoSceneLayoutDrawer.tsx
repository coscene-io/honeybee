// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Drawer, DrawerProps, IconButton, Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { Layout, LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { CoSceneLayoutContent } from "./CoSceneLayoutContent";

const useStyles = makeStyles()((theme) => ({
  drawerContent: {
    width: 1200,
    height: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
}));

interface CoSceneLayoutDrawerProps extends DrawerProps {
  onClose: () => void;
  onSelectLayout: (layout: Layout) => Promise<void>;
  onDeleteLayout: (layout: Layout) => Promise<void>;
  onRenameLayout: (layout: Layout, newName: string) => Promise<void>;
  onExportLayout: (layout: Layout) => Promise<void>;
  onOverwriteLayout: (layout: Layout) => Promise<void>;
  onRevertLayout: (layout: Layout) => Promise<void>;
  onCreateLayout: (params: {
    folder: string;
    displayName: string;
    permission: LayoutPermission;
    data?: LayoutData;
  }) => Promise<void>;
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    personalLayouts: Layout[];
    projectLayouts: Layout[];
  };
}

export function CoSceneLayoutDrawer(props: CoSceneLayoutDrawerProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();
  const {
    open,
    onClose,
    onSelectLayout,
    onDeleteLayout,
    onRenameLayout,
    onExportLayout,
    onOverwriteLayout,
    onRevertLayout,
    onCreateLayout,
    layouts,
  } = props;

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box className={classes.drawerContent}>
        <Box className={classes.header}>
          <Typography variant="h6">{t("layout")}</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        <CoSceneLayoutContent
          layouts={layouts}
          onSelectLayout={onSelectLayout}
          onDeleteLayout={onDeleteLayout}
          onRenameLayout={onRenameLayout}
          onExportLayout={onExportLayout}
          onOverwriteLayout={onOverwriteLayout}
          onRevertLayout={onRevertLayout}
          onCreateLayout={onCreateLayout}
        />
      </Box>
    </Drawer>
  );
}
