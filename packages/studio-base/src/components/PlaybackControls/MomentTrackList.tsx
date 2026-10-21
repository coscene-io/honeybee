// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { alpha, IconButton, Tooltip } from "@mui/material";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { EVENT_LANE_HEIGHT_PX } from "./constants";
import type { MomentTrackLayout, MomentTrackView } from "./momentTracks";
import { useVisibleEventLanes } from "./useVisibleEventLanes";

const useStyles = makeStyles()((theme) => ({
  root: { position: "relative" },
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "flex-start",
    borderBottom: `1px solid ${theme.palette.divider}`,
    background: theme.palette.background.paper,
    color: theme.palette.text.primary,
    fontSize: 12,
    "&:hover": { backgroundColor: alpha(theme.palette.text.primary, 0.04) },
  },
  title: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: "28px",
    minWidth: 0,
    paddingRight: 6,
  },
  button: { padding: 5, height: 28, width: 28, borderRadius: 4, flexShrink: 0 },
  toggleSpacer: { height: 28, width: 28, flexShrink: 0 },
}));

export function MomentTrackList({
  layout,
  view,
  onViewChange,
}: {
  layout: MomentTrackLayout;
  view: MomentTrackView;
  onViewChange: (view: MomentTrackView) => void;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(ReactNull);
  const visible = useVisibleEventLanes(root, layout.laneCount, "top");
  const { classes } = useStyles();
  const { t } = useTranslation("event");
  return (
    <div
      ref={root}
      className={classes.root}
      data-testid="moment-track-list"
      style={{ height: layout.laneCount * EVENT_LANE_HEIGHT_PX }}
    >
      {layout.rows
        .filter((row) => row.lane <= visible.last && row.lane + row.laneCount > visible.first)
        .map(({ track, lane, laneCount, collapsed, hidden }) => {
          const title =
            track.kind === "ungrouped"
              ? t("moments")
              : track.kind === "missing"
                ? t("ungroupedValue")
                : track.kind === "unknown"
                  ? t("unknownOption", { value: track.title })
                  : track.title;
          const label = track.fieldName === "" ? title : `${track.fieldName}: ${title}`;
          return (
            <div
              key={track.id}
              className={classes.row}
              data-track-id={track.id}
              data-testid="moment-track-title"
              style={{
                top: lane * EVENT_LANE_HEIGHT_PX,
                height: laneCount * EVENT_LANE_HEIGHT_PX,
                paddingLeft: track.depth * 12,
                opacity: hidden ? 0.55 : 1,
              }}
            >
              {track.children.length > 0 ? (
                <IconButton
                  size="small"
                  className={classes.button}
                  aria-label={t("toggleGroup", { name: label })}
                  aria-expanded={!collapsed}
                  onClick={() => {
                    onViewChange({
                      ...view,
                      collapsed: { ...view.collapsed, [track.id]: !collapsed },
                    });
                  }}
                >
                  {collapsed ? (
                    <ChevronRightIcon fontSize="inherit" />
                  ) : (
                    <ExpandMoreIcon fontSize="inherit" />
                  )}
                </IconButton>
              ) : (
                <span aria-hidden className={classes.toggleSpacer} />
              )}
              <Tooltip title={label}>
                <span className={classes.title}>
                  {label} ({track.count})
                </span>
              </Tooltip>
              <Tooltip title={t(hidden ? "showTrack" : "hideTrack", { name: label })}>
                <IconButton
                  size="small"
                  className={classes.button}
                  aria-label={t(hidden ? "showTrack" : "hideTrack", { name: label })}
                  onClick={() => {
                    onViewChange({
                      ...view,
                      hidden: { ...view.hidden, [track.id]: !hidden },
                    });
                  }}
                >
                  {hidden ? (
                    <VisibilityOffIcon fontSize="inherit" />
                  ) : (
                    <VisibilityIcon fontSize="inherit" />
                  )}
                </IconButton>
              </Tooltip>
            </div>
          );
        })}
    </div>
  );
}
