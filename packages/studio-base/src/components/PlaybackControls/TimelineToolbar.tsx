// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { alpha, Popover } from "@mui/material";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useResizeDetector } from "react-resize-detector";
import { makeStyles } from "tss-react/mui";

import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";

export const TIMELINE_TOOLBAR_HEIGHT_PX = 40;

const useStyles = makeStyles()((theme) => ({
  root: {
    alignItems: "center",
    backgroundColor: theme.palette.background.paper,
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: "flex",
    flex: "0 0 auto",
    flexWrap: "wrap",
    columnGap: 6,
    rowGap: 0,
    minHeight: TIMELINE_TOOLBAR_HEIGHT_PX,
    minWidth: 0,
    paddingInline: 8,
    whiteSpace: "nowrap",
    // Each wrapped line keeps the original toolbar rhythm, allowing for the bottom border.
    "& > div": {
      alignItems: "center",
      display: "flex",
      minHeight: TIMELINE_TOOLBAR_HEIGHT_PX - 1,
    },
    "& .MuiIconButton-root": { width: 30 },
  },
  controls: {
    "& .MuiIconButton-root": { borderRadius: 5, height: 30, padding: 5 },
    "& .MuiButton-root": { borderRadius: 5, minHeight: 30, boxShadow: "none" },
    "& button:focus-visible": {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: -2,
    },
    "& button[aria-pressed=true]": {
      backgroundColor: alpha(theme.palette.primary.main, 0.1),
      color: theme.palette.primary.main,
    },
    "& #play-pause-button": {
      backgroundColor: alpha(theme.palette.primary.main, 0.1),
      color: theme.palette.primary.main,
    },
    "& svg": { flexShrink: 0, height: 18, width: 18 },
  },
  compact: { columnGap: 4, paddingInline: 6 },
  group: { alignItems: "center", display: "flex", flexShrink: 0, gap: 2 },
  end: { marginLeft: "auto" },
  zoom: { flex: "0 1 180px", minWidth: 120 },
  time: {
    flex: "0 1 auto",
    minWidth: 0,
    "& .MuiFormControl-root": { maxWidth: "100%" },
  },
  spacer: { flex: 1, minWidth: 0 },
  divider: { backgroundColor: theme.palette.divider, height: 18, width: 1, flexShrink: 0 },
  paper: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    width: 240,
    maxWidth: "calc(100vw - 32px)",
    padding: 6,
  },
  tools: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    "&& .MuiIconButton-root": {
      borderRadius: 4,
      color: theme.palette.text.primary,
      justifyContent: "flex-start",
      width: "100%",
      height: 32,
      paddingInline: 8,
      gap: 8,
      "& svg": { color: theme.palette.text.secondary },
      "@media (pointer: coarse)": { height: 48 },
    },
  },
}));

export type TimelineToolbarProps = {
  onHeightChange?: (height: number) => void;
  playback?: React.ReactNode;
  playbackOptions?: React.ReactNode;
  seekStep?: React.ReactNode;
  speed?: React.ReactNode;
  time?: (options: { compact: boolean }) => React.ReactNode;
  sourceInfo?: React.ReactNode;
  create?: (options: { showLabel: boolean }) => React.ReactNode;
  editing: (options: { showLabel: boolean }) => React.ReactNode;
  zoom: React.ReactNode;
  fit: (options: { showLabel: boolean }) => React.ReactNode;
  help: (options: { showLabel: boolean }) => React.ReactNode;
};

/** Measure this strip, rather than the window: open sidebars also consume toolbar space. */
export function TimelineToolbar(props: TimelineToolbarProps): React.JSX.Element {
  const { onHeightChange } = props;
  const { width, height, ref } = useResizeDetector<HTMLDivElement>({
    observerOptions: { box: "border-box" },
    refreshMode: "debounce",
    refreshRate: 60,
  });
  const availableWidth = width != undefined && width > 0 ? width : Infinity;
  const compact = availableWidth < 640;
  const condensed = availableWidth < 1000;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("general");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>();
  const id = useId();

  useEffect(() => {
    onHeightChange?.(Math.max(TIMELINE_TOOLBAR_HEIGHT_PX, Math.ceil(height ?? 0)));
  }, [height, onHeightChange]);

  return (
    <>
      <div
        ref={ref}
        className={cx(classes.root, classes.controls, {
          [classes.compact]: compact,
        })}
        data-timeline-toolbar
        data-testid="timeline-toolbar"
        data-compact={compact}
        role="toolbar"
        aria-label={t("timelineControls")}
      >
        <div className={classes.group}>
          {props.playback}
          {props.playbackOptions}
          {props.speed}
        </div>
        {props.time && <span className={classes.divider} aria-hidden />}
        <div className={classes.time}>{props.time?.({ compact: condensed })}</div>
        <div className={classes.group}>{props.sourceInfo}</div>
        <div className={classes.spacer} />
        <div className={classes.group}>
          {props.create?.({ showLabel: false })}
          {props.editing({ showLabel: false })}
        </div>
        <div className={classes.zoom}>{props.zoom}</div>
        <div className={cx(classes.group, classes.end)}>
          {props.fit({ showLabel: false })}
          <HoverableIconButton
            size="small"
            icon={<MoreHorizIcon />}
            aria-label={t("timelineMoreTools")}
            title={t("timelineMoreTools")}
            aria-haspopup="dialog"
            aria-expanded={anchorEl != undefined}
            aria-controls={anchorEl ? id : undefined}
            onClick={(event) => {
              setAnchorEl(event.currentTarget);
            }}
          />
        </div>
      </div>
      <Popover
        id={id}
        open={anchorEl != undefined}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(undefined);
          window.requestAnimationFrame(() => {
            if (anchorEl?.isConnected === true) {
              anchorEl.focus();
            }
          });
        }}
        disableRestoreFocus
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            className: cx(classes.paper, classes.controls),
            role: "dialog",
            "aria-label": t("timelineMoreTools"),
          },
        }}
      >
        <div className={classes.tools}>
          {props.help({ showLabel: true })}
          {props.seekStep}
        </div>
      </Popover>
    </>
  );
}
