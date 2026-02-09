// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import { Button, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useMessagePipeline } from "@foxglove/studio-base/components/MessagePipeline";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlaybackSpeed } from "@foxglove/studio-base/players/types";

const SPEED_OPTIONS: PlaybackSpeed[] = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 0.8, 1, 2, 3, 5];

const formatSpeed = (val: PlaybackSpeed) => `${val < 0.1 ? val.toFixed(2) : val}×`;

const selectPlaybackSpeed = (store: WorkspaceContextStore) => store.playbackControls.speed;

const useStyles = makeStyles()((theme) => ({
  button: {
    padding: theme.spacing(0.625, 0.5),
    backgroundColor: "transparent",

    ":hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

function PlaybackSpeedControls(props: { disabled?: boolean }): React.JSX.Element {
  const { classes } = useStyles();
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  const speed = useWorkspaceStore(selectPlaybackSpeed);
  const setPlaybackSpeed = useMessagePipeline(useCallback((state) => state.setPlaybackSpeed, []));
  // Speed setting lives on the Workspace/persists accross layouts
  const { t } = useTranslation();
  const {
    playbackControlActions: { setSpeed },
  } = useWorkspaceActions();

  useEffect(() => {
    if (setPlaybackSpeed) {
      setPlaybackSpeed(speed);
    }
  }, [speed, setPlaybackSpeed]);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <>
      <Tooltip title={t("playbackSpeed", { ns: "general" })}>
        <Button
          className={classes.button}
          id="playback-speed-button"
          aria-controls={open ? "playback-speed-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={open ? "true" : undefined}
          onClick={handleClick}
          data-testid="PlaybackSpeedControls-Dropdown"
          disabled={props.disabled}
          disableRipple
          variant="contained"
          color="inherit"
          endIcon={<ArrowDropDownIcon />}
        >
          {formatSpeed(speed)}
        </Button>
      </Tooltip>
      <Menu
        id="playback-speed-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
        data-tourid="playback-speed-controls"
        aria-labelledby="playback-speed-button"
        slotProps={{
          list: {
            dense: true,
          },
        }}
      >
        {SPEED_OPTIONS.map((option) => (
          <MenuItem
            selected={speed === option}
            key={option}
            onClick={() => {
              setSpeed(option);
              handleClose();
            }}
          >
            {speed === option && (
              <ListItemIcon>
                <CheckIcon fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText
              inset={speed !== option}
              primary={formatSpeed(option)}
              slotProps={{
                primary: {
                  variant: "inherit",
                },
              }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default React.memo(PlaybackSpeedControls);
