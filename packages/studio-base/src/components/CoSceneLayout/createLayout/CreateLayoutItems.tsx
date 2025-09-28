// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { List, ListItem, ListItemButton, ListItemText } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { CopyFromOtherProjectDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CopyFromOtherProjectDialog";
import { CreateBlankLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateBlankLayoutDialog";
import { ImportFromFileDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ImportFromFileDialog";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";

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
  const [open, setOpen] = useState("");
  const handleClose = useCallback(() => {
    setOpen("");
  }, []);

  const { t } = useTranslation("cosLayout");

  return (
    <>
      <List>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              setOpen("createBlankLayout");
            }}
          >
            <ListItemText primary={t("createBlankLayout")} />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              setOpen("copyFromOtherProject");
            }}
          >
            <ListItemText primary={t("copyFromOtherProject")} />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              setOpen("importFromFile");
            }}
          >
            <ListItemText primary={t("importFromFile")} />
          </ListItemButton>
        </ListItem>
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
      {open === "copyFromOtherProject" && (
        <CopyFromOtherProjectDialog
          supportsProjectWrite={supportsProjectWrite}
          onCreateLayout={onCreateLayout}
          personalFolders={personalFolders}
          projectFolders={projectFolders}
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
