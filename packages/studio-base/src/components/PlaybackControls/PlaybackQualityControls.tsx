// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import { Button, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import i18n from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { usePlayerSelection } from "@foxglove/studio-base/context/CoScenePlayerSelectionContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";

const ORIGINAL = "original";
const HIGH = "high";
const MEDIUM = "mid";
const LOW = "low";

const SPEED_OPTIONS = [ORIGINAL, HIGH, MEDIUM, LOW];
const useStyles = makeStyles()((theme) => ({
  button: {
    padding: theme.spacing(0.625, 0.5),
    backgroundColor: "transparent",
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

function PlaybackQualityControls(): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);

  const [playbackQuality, setPlaybackQuality] = useAppConfigurationValue<string>(
    AppSetting.PLAYBACK_QUALITY_LEVEL,
  );
  const { reloadCurrentSource } = usePlayerSelection();

  const { t } = useTranslation("cosSettings");
  const open = Boolean(anchorEl);
  const { classes, cx } = useStyles();

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(undefined);
  };

  const getPlaybackQualityTranslation = (quality?: string) => {
    switch (quality) {
      case HIGH:
        return t(HIGH);
      case LOW:
        return t(LOW);
      case MEDIUM:
        return t(MEDIUM);
      default:
        return t(ORIGINAL);
    }
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
          {getPlaybackQualityTranslation(playbackQuality)}
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
        {SPEED_OPTIONS.map((option) => (
          <MenuItem
            selected={playbackQuality === option}
            key={option}
            onClick={async () => {
              await setPlaybackQuality(option);
              await reloadCurrentSource({
                playbackQualityLevel: option,
              });
              handleClose();
            }}
          >
            {playbackQuality === option && (
              <ListItemIcon>
                <CheckIcon fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText
              inset={playbackQuality !== option}
              primary={getPlaybackQualityTranslation(option)}
              primaryTypographyProps={{ variant: "body2" }}
            />
          </MenuItem>
        ))}
        <Button
          variant="text"
          fullWidth
          onClick={() => {
            if (i18n.language === "zh") {
              window.open("https://docs.coscene.cn/docs/recipes/viz/frame-rate-optimization/");
            } else {
              window.open("https://docs.coscene.cn/en/docs/recipes/viz/frame-rate-optimization/");
            }
          }}
        >
          {t("understandFrameRateOptimization")}
        </Button>
      </Menu>
    </>
  );
}

export default React.memo(PlaybackQualityControls);
