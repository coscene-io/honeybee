// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Add as AddIcon,
  NoteAddOutlined as NoteAddOutlinedIcon,
  LibraryAddOutlined as LibraryAddOutlinedIcon,
} from "@mui/icons-material";
import { List, ListItem, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CopyFromOtherProjectDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CopyFromOtherProjectDialog";
import { CreateBlankLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateBlankLayoutDialog";
import { ImportFromFileDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ImportFromFileDialog";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";

const useStyles = makeStyles()(() => ({
  listItemIcon: {
    minWidth: 26,
    "& svg": {
      fontSize: "1rem",
    },
  },
}));

export function CreateLayoutItems({
  onCreateLayout,
  personalFolders,
  projectFolders,
  supportsProjectWrite,
}: {
  onCreateLayout: (params: CreateLayoutParams) => void;
  personalFolders: string[];
  projectFolders: string[];
  supportsProjectWrite: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const [open, setOpen] = useState("");
  const handleClose = useCallback(() => {
    setOpen("");
  }, []);

  const { t } = useTranslation("layout");

  const buttons = [
    {
      key: "createBlankLayout",
      label: t("createBlankLayout"),
      icon: <AddIcon />,
      onClick: () => {
        setOpen("createBlankLayout");
      },
    },
    {
      key: "copyFromProject",
      label: t("copyFromProject"),
      icon: <LibraryAddOutlinedIcon />,
      onClick: () => {
        setOpen("copyFromProject");
      },
    },
    {
      key: "importFromFile",
      label: t("importFromFile"),
      icon: <NoteAddOutlinedIcon />,
      onClick: () => {
        setOpen("importFromFile");
      },
    },
  ];

  return (
    <>
      <List>
        {buttons.map((button) => (
          <ListItem disablePadding key={button.label}>
            <ListItemButton onClick={button.onClick}>
              <ListItemIcon className={classes.listItemIcon}>{button.icon}</ListItemIcon>
              <ListItemText primary={button.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      {open === "createBlankLayout" && (
        <CreateBlankLayoutDialog
          supportsProjectWrite={supportsProjectWrite}
          onCreateLayout={onCreateLayout}
          personalFolders={personalFolders}
          projectFolders={projectFolders}
          open
          onClose={handleClose}
        />
      )}
      {open === "copyFromProject" && (
        <CopyFromOtherProjectDialog
          supportsProjectWrite={supportsProjectWrite}
          onCreateLayout={onCreateLayout}
          open
          onClose={handleClose}
        />
      )}
      {open === "importFromFile" && (
        <ImportFromFileDialog
          supportsProjectWrite={supportsProjectWrite}
          onCreateLayout={onCreateLayout}
          personalFolders={personalFolders}
          projectFolders={projectFolders}
          open
          onClose={handleClose}
        />
      )}
    </>
  );
}
