// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import { Button, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

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

export default function CoScenePlabackTimeMode(): JSX.Element {
  const { t } = useTranslation("cosSettings");
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  const { classes, cx } = useStyles();

  const timeMode = useMemo(() => {
    const currentTimeMode = localStorage.getItem("CoScene_timeMode");
    if (currentTimeMode === RELATATIVE_TIME || currentTimeMode === ABSOLUTE_TIME) {
      return currentTimeMode;
    }
    return ABSOLUTE_TIME;
  }, []);

  const setTimeMode = useCallback((changedTimeMode: string) => {
    localStorage.setItem("CoScene_timeMode", changedTimeMode);
    location.reload();
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <>
      <Tooltip title={t("quality")}>
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
          {t(timeMode)}
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
            setTimeMode(ABSOLUTE_TIME);
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
            setTimeMode(RELATATIVE_TIME);
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
