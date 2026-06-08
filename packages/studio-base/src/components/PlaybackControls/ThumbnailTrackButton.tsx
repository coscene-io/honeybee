// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CheckIcon from "@mui/icons-material/Check";
import MovieIcon from "@mui/icons-material/Movie";
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { useState } from "react";

import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";
import { Topic } from "@foxglove/studio-base/players/types";

/**
 * Toolbar control for the timeline video-thumbnail strip: toggles the strip on/off and selects
 * which CompressedVideo track to render.
 */
export function ThumbnailTrackButton({
  enabled,
  topic,
  videoTopics,
  onToggleEnabled,
  onSelectTopic,
}: {
  enabled: boolean;
  topic: undefined | string;
  videoTopics: readonly Topic[];
  onToggleEnabled: () => void;
  onSelectTopic: (topic: string) => void;
}): React.JSX.Element | ReactNull {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | ReactNull>(ReactNull);

  if (videoTopics.length === 0) {
    return ReactNull;
  }

  return (
    <>
      <HoverableIconButton
        size="small"
        title="Timeline thumbnails"
        color={enabled ? "primary" : "inherit"}
        icon={<MovieIcon fontSize="small" />}
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
      />
      <Menu
        anchorEl={anchorEl}
        open={anchorEl != undefined}
        onClose={() => {
          setAnchorEl(ReactNull);
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            onToggleEnabled();
          }}
        >
          <ListItemIcon>{enabled && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>Show thumbnails</ListItemText>
        </MenuItem>
        <Divider />
        {videoTopics.map((videoTopic) => (
          <MenuItem
            key={videoTopic.name}
            selected={enabled && videoTopic.name === topic}
            disabled={!enabled}
            onClick={() => {
              onSelectTopic(videoTopic.name);
              setAnchorEl(ReactNull);
            }}
          >
            <ListItemIcon>
              {videoTopic.name === topic && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { noWrap: true } }}>{videoTopic.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
