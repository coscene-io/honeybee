// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Menu, MenuItem, Typography } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

export type LayoutActionMenuItem =
  | {
      type: "item";
      text: string;
      secondaryText?: string;
      key: string;
      onClick?: (event: React.MouseEvent<HTMLLIElement>) => void;
      disabled?: boolean;
      "data-testid"?: string;
    }
  | {
      type: "divider";
      key: string;
    };

export function LayoutTableRowMenu({
  anchorEl,
  handleMenuClose,
  layout,
  onDeleteLayout,
  onExportLayout,
} // onRenameLayout,
: {
  anchorEl: HTMLElement | undefined;
  handleMenuClose: () => void;
  layout: Layout;
  onDeleteLayout: (layout: Layout) => void;
  onExportLayout: (layout: Layout) => void;
  // onRenameLayout: (layout: Layout) => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const confirm = useConfirm();

  const openRenameDialog = useCallback(() => {
    // setRenameDialogOpen(true);
  }, []);

  const openCopyDialog = useCallback(() => {
    // setRenameDialogOpen(true);
  }, []);

  const exportAction = useCallback(() => {
    onExportLayout(layout);
  }, [layout, onExportLayout]);

  // todo: 实现
  const confirmDelete = useCallback(() => {
    onDeleteLayout(layout);
    handleMenuClose();
  }, [onDeleteLayout, handleMenuClose, layout]);

  const menuItems: LayoutActionMenuItem[] = [
    {
      type: "item",
      key: "rename",
      text: t("rename"),
      onClick: openRenameDialog,
    },
    {
      type: "item",
      key: "copy",
      text: t("copy"),
      onClick: openCopyDialog,
    },
    {
      type: "item",
      key: "export",
      text: t("export"),
      onClick: exportAction,
    },
    {
      type: "divider",
      key: "divider",
    },
    {
      type: "item",
      key: "delete",
      text: t("delete"),
      onClick: confirmDelete,
      "data-testid": "delete-layout",
    },
  ];

  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
      {menuItems.map((item) => {
        switch (item.type) {
          case "divider":
            return <Divider key={item.key} variant="middle" />;

          case "item":
            return (
              <MenuItem
                disabled={item.disabled}
                key={item.key}
                data-testid={item["data-testid"]}
                onClick={(event) => {
                  item.onClick?.(event);
                  handleMenuClose();
                }}
              >
                <Typography variant="inherit" color={item.key === "delete" ? "error" : undefined}>
                  {item.text}
                </Typography>
              </MenuItem>
            );

          default:
            return undefined;
        }
      })}
    </Menu>
  );
}
