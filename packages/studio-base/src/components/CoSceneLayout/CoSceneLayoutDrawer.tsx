// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Drawer, DrawerProps, IconButton, Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { CoSceneLayoutContent } from "./CoSceneLayoutContent";

const useStyles = makeStyles()((theme) => ({
  drawerContainer: {
    width: "75vw",
    height: "100%",
    maxWidth: "100vw",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  drawerContent: {
    flex: 1,
    overflow: "hidden",
  },
}));

interface CoSceneLayoutDrawerProps extends DrawerProps {
  currentLayoutId?: LayoutID;
  supportsProjectWrite: boolean;
  onClose: () => void;
  onSelectLayout: (layout: Layout) => Promise<void>;
  onDeleteLayout: (layout: Layout) => Promise<void>;
  onRenameLayout: (layout: Layout, newName: string) => Promise<void>;
  onMoveLayout: (layout: Layout, newFolder: string) => Promise<void>;
  onExportLayout: (layout: Layout) => Promise<void>;
  onOverwriteLayout: (layout: Layout) => Promise<void>;
  onRevertLayout: (layout: Layout) => Promise<void>;
  onCreateLayout: (params: CreateLayoutParams) => Promise<void>;
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    allLayouts: Layout[];
  };
}

export function CoSceneLayoutDrawer(props: CoSceneLayoutDrawerProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();
  const {
    currentLayoutId,
    supportsProjectWrite,
    open,
    onClose,
    onSelectLayout,
    onDeleteLayout,
    onRenameLayout,
    onMoveLayout,
    onExportLayout,
    onOverwriteLayout,
    onRevertLayout,
    onCreateLayout,
    layouts,
  } = props;

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box className={classes.drawerContainer}>
        <Box className={classes.header}>
          <Typography variant="h6">{t("layout")}</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Box className={classes.drawerContent}>
          <CoSceneLayoutContent
            currentLayoutId={currentLayoutId}
            supportsProjectWrite={supportsProjectWrite}
            layouts={layouts}
            onSelectLayout={onSelectLayout}
            onDeleteLayout={onDeleteLayout}
            onRenameLayout={onRenameLayout}
            onMoveLayout={onMoveLayout}
            onExportLayout={onExportLayout}
            onOverwriteLayout={onOverwriteLayout}
            onRevertLayout={onRevertLayout}
            onCreateLayout={onCreateLayout}
          />
        </Box>
      </Box>
    </Drawer>
  );
}
