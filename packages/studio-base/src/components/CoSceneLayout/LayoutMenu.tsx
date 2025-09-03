// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Menu, MenuItem } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

export function LayoutMenu({
  anchorEl,
  handleMenuClose,
  layout,
  onDeleteLayout,
}: {
  anchorEl: HTMLElement | undefined;
  handleMenuClose: () => void;
  layout: Layout;
  onDeleteLayout: (layout: Layout) => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const confirm = useConfirm();

  // todo: 实现
  const confirmDelete = useCallback(() => {
    void onDeleteLayout(layout);
    handleMenuClose();
  }, [onDeleteLayout, handleMenuClose, layout]);

  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
      <MenuItem onClick={handleMenuClose}>{t("rename")}</MenuItem>
      <MenuItem onClick={handleMenuClose}>{t("copyLayout")}</MenuItem>
      <Divider />
      <MenuItem onClick={confirmDelete}>{t("delete")}</MenuItem>
    </Menu>
  );
}
