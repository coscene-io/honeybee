// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ChevronRight12Regular } from "@fluentui/react-icons";
import { Divider, Menu, MenuItem, Typography } from "@mui/material";
import { PropsWithChildren, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { AppBarMenuItem } from "./types";

const useStyles = makeStyles<void, "endIcon">()((theme, _params, classes) => ({
  menu: {
    pointerEvents: "none",
  },
  paper: {
    pointerEvents: "auto",
    marginTop: theme.spacing(-1),
  },
  menuItem: {
    justifyContent: "space-between",
    cursor: "pointer",
    gap: theme.spacing(2),

    "&.Mui-selected, &.Mui-selected:hover": {
      backgroundColor: theme.palette.action.hover,
    },
    [`:not(:hover, :focus) .${classes.endIcon}`]: {
      opacity: 0.6,
    },
    kbd: {
      font: "inherit",
      color: theme.palette.text.disabled,
    },
  },
  menuList: {
    minWidth: 180,
    maxWidth: 280,
  },
  endIcon: {
    marginRight: theme.spacing(-0.75),
  },
}));

export function NestedMenuItem(
  props: PropsWithChildren<{
    id?: string;
    items: AppBarMenuItem[];
    open: boolean;
    onPointerEnter: (itemId: string) => void;
  }>,
): React.JSX.Element {
  const { classes } = useStyles();
  const { children, items, open, onPointerEnter, id } = props;
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLLIElement>(undefined);

  const handlePointerEnter = () => {
    if (id) {
      onPointerEnter(id);
    }
  };

  return (
    <>
      <MenuItem
        id={id}
        ref={(element) => {
          setAnchorEl(element ?? undefined);
        }}
        selected={open}
        className={classes.menuItem}
        onPointerEnter={handlePointerEnter}
        data-testid={id}
      >
        {children}
        <ChevronRight12Regular className={classes.endIcon} />
      </MenuItem>
      <Menu
        classes={{
          root: classes.menu,
          paper: classes.paper,
        }}
        open={open}
        disablePortal
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        onMouseLeave={() => {
          setAnchorEl(undefined);
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        autoFocus={false}
        disableAutoFocus
        disableEnforceFocus
        hideBackdrop
        slotProps={{
          list: {
            dense: true,
            className: classes.menuList,
          },
        }}
      >
        {items.map((item, idx) => {
          switch (item.type) {
            case "item":
              return (
                <MenuItem
                  className={classes.menuItem}
                  key={item.key}
                  onClick={item.onClick}
                  disabled={item.disabled}
                >
                  {item.label}
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </MenuItem>
              );
            case "divider":
              return <Divider variant="middle" key={`divider${idx}`} />;
            case "subheader":
              return (
                <MenuItem disabled key={item.key}>
                  <Typography variant="overline">{item.label}</Typography>
                </MenuItem>
              );
          }
        })}
      </Menu>
    </>
  );
}
