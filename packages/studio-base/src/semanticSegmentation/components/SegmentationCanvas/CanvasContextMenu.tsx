// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, MenuItem } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import type { ContextMenuState } from "./canvasTypes";
import { annotationPopupProps } from "../../annotationInput";

export type ContextMenuActions = {
  closeMenu: () => void;
  focusPolygon: () => void;
  deleteVertex: () => void;
  menuFinishDrawing: () => void;
  menuFit: () => void;
  menuFitSelection: () => void;
  menuShortcuts: () => void;
};

type CanvasContextMenuProps = {
  menu: ContextMenuState | undefined;
  /** Deleting the vertex is allowed: editing, not locked, and the polygon keeps 3 vertices. */
  canDeleteVertex: boolean;
  drawing: boolean;
  quickMode: boolean;
  /** The drawing cannot be finished yet. */
  finishDisabled: boolean;
  hasFocus: boolean;
  actions: ContextMenuActions;
};

/** Right-click and context-key menu of the canvas. */
export const CanvasContextMenu = memo(function CanvasContextMenu(
  props: CanvasContextMenuProps,
): React.JSX.Element {
  const { menu, canDeleteVertex, drawing, quickMode, finishDisabled, hasFocus, actions } = props;
  const { t } = useTranslation("segmentation");
  return (
    <Menu
      {...annotationPopupProps}
      open={menu != undefined}
      onClose={actions.closeMenu}
      anchorReference="anchorPosition"
      anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
    >
      {menu?.target && <MenuItem onClick={actions.focusPolygon}>{t("focusPolygon")}</MenuItem>}
      {menu?.target?.type === "vertex" && (
        <MenuItem disabled={!canDeleteVertex} onClick={actions.deleteVertex}>
          {t("deleteVertex")}
        </MenuItem>
      )}
      {drawing && (
        <MenuItem disabled={finishDisabled} onClick={actions.menuFinishDrawing}>
          {quickMode ? t("finishMask") : t("finishPolygon")}
        </MenuItem>
      )}
      <MenuItem onClick={actions.menuFit}>{t("fitImage")}</MenuItem>
      <MenuItem disabled={!hasFocus} onClick={actions.menuFitSelection}>
        {t("fitSelection")}
      </MenuItem>
      <MenuItem onClick={actions.menuShortcuts}>{t("keyboardShortcuts")}</MenuItem>
    </Menu>
  );
});
