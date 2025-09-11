// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Add as AddIcon } from "@mui/icons-material";
import { Button, Menu, MenuItem } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { CopyFromOtherProjectDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CopyFromOtherProjectDialog";
import { CreateBlankLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateBlankLayoutDialog";
import { ImportFromFileDialog } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ImportFromFileDialog";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";

export function CreateLayoutButton({
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
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>(undefined);
  const handleOpenMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setAnchorEl(undefined);
  };
  const { t } = useTranslation("cosLayout");

  return (
    <>
      <Button variant="outlined" startIcon={<AddIcon />} fullWidth onClick={handleOpenMenu}>
        {t("createLayout")}
      </Button>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem
          onClick={() => {
            setOpen("createBlankLayout");
            handleMenuClose();
          }}
        >
          {t("createBlankLayout")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setOpen("copyFromOtherProject");
            handleMenuClose();
          }}
        >
          {t("copyFromOtherProject")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setOpen("importFromFile");
            handleMenuClose();
          }}
        >
          {t("importFromFile")}
        </MenuItem>
      </Menu>
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
