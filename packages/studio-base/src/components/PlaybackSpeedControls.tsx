// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Popover, Tooltip } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useMessagePipeline } from "@foxglove/studio-base/components/MessagePipeline";
import PlaybackSpeedSlider from "@foxglove/studio-base/components/PlaybackControls/PlaybackSpeedSlider";
import {
  SHORTCUTS,
  ShortcutHint,
} from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcuts";
import { formatPlaybackSpeed } from "@foxglove/studio-base/components/playbackSpeed";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlaybackSpeed } from "@foxglove/studio-base/players/types";

const selectPlaybackSpeed = (store: WorkspaceContextStore) => store.playbackControls.speed;

const useStyles = makeStyles()((theme) => ({
  button: {
    padding: theme.spacing(0.625, 0.5),
    backgroundColor: "transparent",
    minWidth: "auto",

    ":hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
  popoverPaper: {
    backgroundColor: theme.palette.background.paper,
    borderRadius: 12,
    padding: theme.spacing(1.25, 1.5, 1.5),
  },
}));

function PlaybackSpeedControls(props: { disabled?: boolean }): React.JSX.Element {
  const { classes } = useStyles();
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);
  const speed = useWorkspaceStore(selectPlaybackSpeed);
  const [previewSpeed, setPreviewSpeed] = useState<PlaybackSpeed | undefined>(undefined);
  const displaySpeed = previewSpeed ?? speed;
  const setPlaybackSpeed = useMessagePipeline(useCallback((state) => state.setPlaybackSpeed, []));
  const { t } = useTranslation();
  const {
    playbackControlActions: { setSpeed },
  } = useWorkspaceActions();

  useEffect(() => {
    if (setPlaybackSpeed) {
      setPlaybackSpeed(speed);
    }
  }, [speed, setPlaybackSpeed]);

  const commitSpeed = (next: PlaybackSpeed) => {
    setSpeed(next);
    setPreviewSpeed(undefined);
  };

  const handleClose = () => {
    setPreviewSpeed(undefined);
    setAnchorEl(undefined);
  };

  return (
    <>
      <Tooltip
        title={
          <ShortcutHint
            label={t("playbackSpeed", { ns: "general" })}
            keys={SHORTCUTS.playbackSpeed}
          />
        }
      >
        <Button
          className={classes.button}
          id="playback-speed-button"
          aria-label={`${t("playbackSpeed", { ns: "general" })} ${formatPlaybackSpeed(displaySpeed)}`}
          aria-haspopup="dialog"
          aria-expanded={open ? "true" : undefined}
          aria-controls={open ? "playback-speed-popover" : undefined}
          onClick={(event) => {
            setAnchorEl(event.currentTarget);
          }}
          data-testid="PlaybackSpeedControls-Dropdown"
          disabled={props.disabled}
          disableRipple
          variant="contained"
          color="inherit"
        >
          {formatPlaybackSpeed(displaySpeed)}
        </Button>
      </Tooltip>
      <Popover
        id="playback-speed-popover"
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        disableAutoFocus
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{
          paper: {
            className: classes.popoverPaper,
            role: "dialog",
            "aria-label": t("playbackSpeed", { ns: "general" }),
            square: false,
          },
        }}
      >
        <div data-tourid="playback-speed-controls">
          {open && (
            <PlaybackSpeedSlider
              value={displaySpeed}
              ariaLabel={t("playbackSpeed", { ns: "general" })}
              onPreview={(next) => {
                setPreviewSpeed(next);
              }}
              onCommit={commitSpeed}
              onCancel={() => {
                setPreviewSpeed(undefined);
              }}
              reset={{
                label: t("resetToDefault", { ns: "general" }),
                onReset: () => {
                  commitSpeed(1);
                },
              }}
            />
          )}
        </div>
      </Popover>
    </>
  );
}

export default React.memo(PlaybackSpeedControls);
