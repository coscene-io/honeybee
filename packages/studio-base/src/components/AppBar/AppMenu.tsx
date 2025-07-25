// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, MenuItem, PopoverPosition, PopoverReference } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";

export type AppMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  anchorReference?: PopoverReference;
  anchorPosition?: PopoverPosition;
  disablePortal?: boolean;
  open: boolean;
};

const useStyles = makeStyles()({
  menuList: {
    minWidth: 180,
    maxWidth: 220,
  },
});

export function AppMenu(props: AppMenuProps): React.JSX.Element {
  const { open, handleClose, anchorEl, anchorReference, anchorPosition, disablePortal } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");

  const { dialogActions } = useWorkspaceActions();

  const handleNestedMenuClose = useCallback(() => {
    handleClose();
  }, [handleClose]);

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        anchorReference={anchorReference}
        anchorPosition={anchorPosition}
        disablePortal={disablePortal}
        id="app-menu"
        open={open}
        disableAutoFocusItem
        onClose={handleNestedMenuClose}
        aria-labelledby="app-menu-button"
        data-tourid="app-menu"
        slotProps={{
          list: {
            className: classes.menuList,
            dense: true,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            dialogActions.dataSource.open("start");
            handleNestedMenuClose();
          }}
        >
          {t("open")}
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleNestedMenuClose();
            dialogActions.openFile.open().catch(console.error);
          }}
        >
          {t("openLocalFile")}
        </MenuItem>
      </Menu>
    </>
  );
}
