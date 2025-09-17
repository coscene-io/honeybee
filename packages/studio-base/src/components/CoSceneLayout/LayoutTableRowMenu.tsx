// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Menu, MenuItem, Typography } from "@mui/material";
import { useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";

import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import {
  Layout,
  layoutIsProject,
  layoutIsRead,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";

export type LayoutActionMenuItem =
  | {
      type: "item";
      text: string;
      secondaryText?: string;
      key: string;
      onClick?: (event: React.MouseEvent<HTMLLIElement>) => void;
      disabled?: boolean;
      visible?: boolean;
      "data-testid"?: string;
    }
  | {
      type: "divider";
      key: string;
      visible?: boolean;
    };

export function LayoutTableRowMenu({
  anchorEl,
  layout,
  handleMenuClose,
  handleOpenDialog,
  onDeleteLayout,
  onExportLayout,
}: {
  anchorEl: HTMLElement | undefined;
  layout: Layout;
  handleMenuClose: () => void;
  handleOpenDialog: (type: "rename" | "copy" | "move", layout: Layout) => void;
  onDeleteLayout: (layout: Layout) => void;
  onExportLayout: (layout: Layout) => void;
}): React.JSX.Element {
  const confirm = useConfirm();
  const { t } = useTranslation("cosLayout");

  const exportAction = useCallback(() => {
    onExportLayout(layout);
  }, [layout, onExportLayout]);

  const openRenameDialog = useCallback(() => {
    handleOpenDialog("rename", layout);
  }, [layout, handleOpenDialog]);

  const openCopyDialog = useCallback(() => {
    handleOpenDialog("copy", layout);
  }, [layout, handleOpenDialog]);

  const openMoveDialog = useCallback(() => {
    handleOpenDialog("move", layout);
  }, [layout, handleOpenDialog]);

  const confirmDelete = useCallback(() => {
    const prompt = layoutIsProject(layout) ? (
      <Trans
        t={t}
        i18nKey="deleteProjectLayoutPrompt"
        values={{ layoutName: layout.name }}
        components={{ strong: <strong /> }}
      />
    ) : (
      <Trans
        t={t}
        i18nKey="deletePersonalLayoutPrompt"
        values={{ layoutName: layout.name }}
        components={{ strong: <strong /> }}
      />
    );
    const title = layoutIsProject(layout) ? t("deleteProjectLayout") : t("deletePersonalLayout");

    void confirm({
      title,
      prompt,
      ok: t("delete", { ns: "cosGeneral" }),
      cancel: t("cancel", { ns: "cosGeneral" }),
      variant: "danger",
    }).then((response) => {
      if (response === "ok") {
        onDeleteLayout(layout);
      }
    });
  }, [confirm, layout, t, onDeleteLayout]);

  const disabled = layoutIsRead(layout);

  const menuItems: LayoutActionMenuItem[] = [
    {
      type: "item",
      key: "rename",
      text: t("rename"),
      "data-testid": "rename-layout",
      onClick: openRenameDialog,
      disabled,
    },
    {
      type: "item",
      key: "copy",
      text: t("copy"),
      "data-testid": "copy-layout",
      onClick: openCopyDialog,
    },
    {
      type: "item",
      key: "move",
      text: "Move to folder",
      "data-testid": "move-layout",
      onClick: openMoveDialog,
      disabled,
    },
    {
      type: "item",
      key: "export",
      text: t("export"),
      "data-testid": "export-layout",
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
      "data-testid": "delete-layout",
      onClick: confirmDelete,
      disabled,
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
