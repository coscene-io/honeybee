// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/*
 * @Author: Jesslynwong jiaxin.wang@coscene.io
 * @Date: 2023-01-31 11:45:44
 * @LastEditors: Jesslynwong jiaxin.wang@coscene.io
 * @LastEditTime: 2023-03-02 13:58:54
 * @FilePath: /honeybee/packages/studio-base/src/components/PanelSettings/ActionMenu.tsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import MoreVertIcon from "@mui/icons-material/MoreVert";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { useTranslation } from "react-i18next";

export function ActionMenu({
  allowShare,
  onReset,
  onShare,
}: {
  allowShare: boolean;
  onReset: () => void;
  onShare: () => void;
}): JSX.Element {
  const [anchorEl, setAnchorEl] = React.useState<undefined | HTMLElement>();
  const open = Boolean(anchorEl);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(undefined);
  };
  const { t } = useTranslation("general");

  return (
    <div>
      <IconButton
        id="basic-button"
        aria-controls={open ? "basic-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={handleClick}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu
        id="basic-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "basic-button",
        }}
      >
        <MenuItem
          disabled={!allowShare}
          onClick={() => {
            onShare();
            handleClose();
          }}
        >
          {t("importExportSettings")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onReset();
            handleClose();
          }}
        >
          {t("resetToDefault")}
        </MenuItem>
      </Menu>
    </div>
  );
}
