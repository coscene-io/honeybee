// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import { Button, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";

const RELATATIVE_TIME = "relativeTime";
const ABSOLUTE_TIME = "absoluteTime";

const useStyles = makeStyles()((theme) => ({
  button: {
    padding: theme.spacing(0.625, 0.5),
    backgroundColor: "transparent",
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

function CoScenePlabackTimeMode(): React.JSX.Element {
  const { t } = useTranslation("cosSettings");
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  const { classes, cx } = useStyles();
  const { reloadCurrentSource } = usePlayerSelection();

  const [timeModeSetting, setTimeMode] = useAppConfigurationValue<string>(AppSetting.TIME_MODE);
  const timeMode = timeModeSetting === "relativeTime" ? "relativeTime" : "absoluteTime";

  const timeModeText = timeMode === RELATATIVE_TIME ? t(RELATATIVE_TIME) : t(ABSOLUTE_TIME);

  const handleSetTimeMode = useCallback(
    async (changedTimeMode: string) => {
      await setTimeMode(changedTimeMode);

      await reloadCurrentSource({
        timeMode: changedTimeMode === "relativeTime" ? "relativeTime" : "absoluteTime",
      });
    },
    [setTimeMode, reloadCurrentSource],
  );

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <>
      <Tooltip title={t("timeMode")}>
        <Button
          id="playback-quality-button"
          aria-controls={open ? "playback-quality-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={open ? "true" : undefined}
          onClick={handleClick}
          data-testid="PlaybackSpeedControls-Dropdown"
          disableRipple
          variant="contained"
          color="inherit"
          endIcon={<ArrowDropDownIcon />}
          className={cx(classes.button)}
        >
          {timeModeText}
        </Button>
      </Tooltip>

      <Menu
        id="playback-quality-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "playback-quality-button",
        }}
        anchorOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
      >
        <MenuItem
          selected={timeMode === ABSOLUTE_TIME}
          onClick={() => {
            void handleSetTimeMode(ABSOLUTE_TIME);
          }}
        >
          {timeMode === ABSOLUTE_TIME && (
            <ListItemIcon>
              <CheckIcon fontSize="small" />
            </ListItemIcon>
          )}
          <ListItemText
            inset={timeMode !== ABSOLUTE_TIME}
            primary={t(ABSOLUTE_TIME)}
            primaryTypographyProps={{ variant: "body2" }}
          />
        </MenuItem>
        <MenuItem
          selected={timeMode === RELATATIVE_TIME}
          onClick={() => {
            void handleSetTimeMode(RELATATIVE_TIME);
          }}
        >
          {timeMode === RELATATIVE_TIME && (
            <ListItemIcon>
              <CheckIcon fontSize="small" />
            </ListItemIcon>
          )}
          <ListItemText
            inset={timeMode !== RELATATIVE_TIME}
            primary={t(RELATATIVE_TIME)}
            primaryTypographyProps={{ variant: "body2" }}
          />
        </MenuItem>
      </Menu>
    </>
  );
}

export default React.memo(CoScenePlabackTimeMode);
