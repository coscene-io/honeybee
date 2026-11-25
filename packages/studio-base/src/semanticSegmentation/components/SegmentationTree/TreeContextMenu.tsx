// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, MenuItem } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import type { TreeMenu } from "./treeTypes";

export type TreeMenuActions = {
  close: () => void;
  focus: (menu: TreeMenu) => void;
  rename: (menu: TreeMenu) => void;
  merge: (menu: TreeMenu) => void;
  move: (menu: TreeMenu) => void;
  drawAnother: (menu: TreeMenu) => void;
  deleteNode: (menu: TreeMenu, scope: "frame" | "all") => void;
  deleteClass: (menu: TreeMenu) => void;
};

type TreeContextMenuProps = {
  menu: TreeMenu | undefined;
  /** Whether the menu's node can be merged into another instance. */
  canMerge: boolean;
  actions: TreeMenuActions;
};

/** Per-node actions: focus, rename, merge, move, draw another polygon, delete. */
export const TreeContextMenu = memo(function TreeContextMenu({
  menu,
  canMerge,
  actions,
}: TreeContextMenuProps): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  const type = menu?.node.type;
  return (
    <Menu
      open={menu != undefined}
      onClose={actions.close}
      anchorReference="anchorPosition"
      anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
    >
      <MenuItem
        onClick={() => {
          if (menu) {
            actions.focus(menu);
          }
        }}
      >
        {type === "class"
          ? t("focusClass")
          : type === "instance"
            ? t("focusInstance")
            : t("focusPolygon")}
      </MenuItem>
      {menu && type !== "polygon" && (
        <MenuItem
          onClick={() => {
            actions.rename(menu);
          }}
        >
          {type === "class" ? t("renameClass") : t("renameInstance")}
        </MenuItem>
      )}
      {menu && canMerge && (
        <MenuItem
          onClick={() => {
            actions.merge(menu);
          }}
        >
          {t("mergeIntoInstanceMenu")}
        </MenuItem>
      )}
      {type !== "polygon" && (
        <MenuItem
          onClick={() => {
            if (menu) {
              actions.move(menu);
            }
          }}
        >
          {t("moveClassMenu")}
        </MenuItem>
      )}
      {menu && type === "polygon" && (
        <MenuItem
          onClick={() => {
            actions.drawAnother(menu);
          }}
        >
          {t("drawAnotherPolygon")}
        </MenuItem>
      )}
      {menu && type === "instance" ? (
        [
          <MenuItem
            key="delete-current-frame"
            onClick={() => {
              actions.deleteNode(menu, "frame");
            }}
          >
            {t("deleteInstanceCurrentFrame")}
          </MenuItem>,
          <MenuItem
            key="delete-all-frames"
            onClick={() => {
              actions.deleteNode(menu, "all");
            }}
          >
            {t("deleteInstanceAllFrames")}
          </MenuItem>,
        ]
      ) : (
        <MenuItem
          onClick={() => {
            if (menu) {
              actions.deleteNode(menu, "all");
            }
          }}
        >
          {type === "class" ? t("deleteAllInstances") : t("deletePolygon")}
        </MenuItem>
      )}
      {menu && type === "class" && (
        <MenuItem
          onClick={() => {
            actions.deleteClass(menu);
          }}
        >
          {t("deleteClassAllInstances")}
        </MenuItem>
      )}
    </Menu>
  );
});
