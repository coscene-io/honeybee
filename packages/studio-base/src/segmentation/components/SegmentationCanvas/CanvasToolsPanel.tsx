// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import PanToolIcon from "@mui/icons-material/PanTool";
import RemoveIcon from "@mui/icons-material/Remove";
import { Button, Divider, IconButton, Typography } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ShortcutKeys } from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcuts";

import { SEGMENTATION_SHORTCUTS } from "../../shortcuts";

const useStyles = makeStyles()((theme) => ({
  toolsPanel: {
    position: "absolute",
    right: theme.spacing(1.5),
    bottom: theme.spacing(7),
    zIndex: 6,
    width: 240,
    maxWidth: `calc(100% - ${theme.spacing(3)})`,
    padding: 6,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    boxShadow: theme.shadows[8],
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  menuRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    paddingInline: 8,
    fontSize: theme.typography.body2.fontSize,
    "@media (pointer: coarse)": { height: 48 },
  },
  menuButton: {
    "&&": {
      justifyContent: "flex-start",
      width: "100%",
      minWidth: 0,
      borderRadius: 4,
      color: theme.palette.text.primary,
      textTransform: "none",
      fontSize: theme.typography.body2.fontSize,
      fontWeight: "inherit",
      whiteSpace: "nowrap",
      "& svg": { color: theme.palette.text.secondary },
      "&[aria-pressed=true]": { backgroundColor: theme.palette.action.selected },
      "&.Mui-disabled": { color: theme.palette.text.disabled },
    },
  },
  menuKeys: { marginLeft: "auto" },
  stepper: { justifyContent: "space-between" },
  stepperButton: {
    "&&": {
      borderRadius: 4,
      color: theme.palette.text.primary,
      "& svg": { color: theme.palette.text.secondary },
    },
  },
  menuSlider: {
    marginLeft: "auto",
    width: 100,
    minWidth: 0,
    accentColor: theme.palette.primary.main,
  },
  menuDivider: { marginBlock: 6 },
  menuCaption: {
    color: theme.palette.text.secondary,
    fontVariantNumeric: "tabular-nums",
    paddingInline: 8,
    paddingBlock: 2,
  },
  toolsFab: {
    position: "absolute",
    right: theme.spacing(1.5),
    bottom: theme.spacing(1.5),
    zIndex: 6,
    width: 40,
    height: 40,
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    boxShadow: theme.shadows[4],
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
}));

export type ToolsActions = {
  toggleTools: () => void;
  closeTools: () => void;
  zoomOut: () => void;
  zoomIn: () => void;
  fit: () => void;
  fitSelection: () => void;
  actualSize: () => void;
  togglePan: () => void;
  setOpacity: (value: number) => void;
  openShortcuts: () => void;
  /** Returns keyboard focus to the viewport after a pointer click on a control. */
  refocusAfterClick: (event: React.MouseEvent<HTMLElement>) => void;
};

export type ToolsPanelProps = {
  open: boolean;
  /** True at the fitted view: zoom 1 and no pan. */
  atFit: boolean;
  screenScale: number;
  width: number;
  height: number;
  navigationLocked: boolean;
  hasFocus: boolean;
  panTool: boolean;
  opacity: number;
  actions: ToolsActions;
};

function ToolsFab({ open, actions }: Pick<ToolsPanelProps, "open" | "actions">): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <IconButton
      className={classes.toolsFab}
      size="small"
      aria-label={t("viewTools")}
      aria-expanded={open}
      onClick={actions.toggleTools}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </svg>
    </IconButton>
  );
}

type ZoomStepperProps = Pick<
  ToolsPanelProps,
  "atFit" | "screenScale" | "navigationLocked" | "actions"
>;

function ZoomStepper({
  atFit,
  screenScale,
  navigationLocked,
  actions,
}: ZoomStepperProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <div className={cx(classes.menuRow, classes.stepper)}>
      <IconButton
        size="small"
        className={classes.stepperButton}
        disabled={navigationLocked}
        aria-label={t("zoomOut")}
        data-tool="zoom-out"
        onClick={actions.zoomOut}
      >
        <RemoveIcon fontSize="small" />
      </IconButton>
      <Typography variant="body2" aria-live="polite" data-tool="zoom-label">
        {atFit ? t("fitPrefix") : ""}
        {Math.round(screenScale * 100)}%
      </Typography>
      <IconButton
        size="small"
        className={classes.stepperButton}
        disabled={navigationLocked}
        aria-label={t("zoomIn")}
        data-tool="zoom-in"
        onClick={actions.zoomIn}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  shortcut,
  ...rest
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: React.ComponentProps<typeof ShortcutKeys>["keys"];
  disabled?: boolean;
  onClick: () => void;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "data-tool": string;
  "data-keep-control-focus"?: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <Button className={classes.menuButton} startIcon={icon} {...rest}>
      {label}
      {shortcut && (
        <span className={classes.menuKeys}>
          <ShortcutKeys keys={shortcut} />
        </span>
      )}
    </Button>
  );
}

function ToolsPanel({
  atFit,
  screenScale,
  navigationLocked,
  hasFocus,
  panTool,
  opacity,
  width,
  height,
  actions,
}: Omit<ToolsPanelProps, "open">): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <div
      className={classes.toolsPanel}
      role="group"
      aria-label={t("viewTools")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          actions.closeTools();
        }
      }}
      onClick={actions.refocusAfterClick}
    >
      <ZoomStepper
        atFit={atFit}
        screenScale={screenScale}
        navigationLocked={navigationLocked}
        actions={actions}
      />
      <ToolButton
        icon={<FitScreenIcon />}
        label={t("fitCanvas")}
        aria-label={t("fitCanvas")}
        shortcut={SEGMENTATION_SHORTCUTS.fit}
        disabled={navigationLocked}
        data-tool="fit"
        onClick={actions.fit}
      />
      <ToolButton
        icon={<CenterFocusStrongIcon />}
        label={t("fitSelection")}
        aria-label={t("fitSelection")}
        shortcut={SEGMENTATION_SHORTCUTS.fitSelection}
        disabled={navigationLocked || !hasFocus}
        data-tool="fit-selection"
        onClick={actions.fitSelection}
      />
      <ToolButton
        icon={<AspectRatioIcon />}
        label={t("actualSize")}
        shortcut={SEGMENTATION_SHORTCUTS.actualSize}
        disabled={navigationLocked}
        data-tool="actual"
        onClick={actions.actualSize}
      />
      <ToolButton
        icon={<PanToolIcon />}
        label={t("pan")}
        aria-label={t("pan")}
        aria-pressed={panTool}
        shortcut={SEGMENTATION_SHORTCUTS.panTool}
        disabled={navigationLocked}
        data-tool="pan"
        onClick={actions.togglePan}
      />
      <Divider className={classes.menuDivider} />
      <label className={classes.menuRow} data-tool="opacity">
        {t("opacity")}
        <input
          className={classes.menuSlider}
          aria-label={t("overlayOpacity")}
          disabled={navigationLocked}
          type="range"
          min={0}
          max={0.7}
          step={0.05}
          value={opacity}
          onChange={(event) => {
            actions.setOpacity(Number(event.target.value));
          }}
        />
      </label>
      <Divider className={classes.menuDivider} />
      <ToolButton
        icon={<KeyboardIcon />}
        label={t("keyboardShortcuts")}
        aria-label={t("keyboardShortcuts")}
        data-keep-control-focus
        data-tool="shortcuts"
        onClick={actions.openShortcuts}
      />
      <Typography variant="caption" className={classes.menuCaption} data-tool="size">
        {width} × {height}
      </Typography>
    </div>
  );
}

/** The view tools toggle and, when open, the zoom / fit / pan / opacity panel. */
export const CanvasToolsPanel = memo(function CanvasToolsPanel({
  open,
  ...panel
}: ToolsPanelProps): React.JSX.Element {
  return (
    <>
      {open && <ToolsPanel {...panel} />}
      <ToolsFab open={open} actions={panel.actions} />
    </>
  );
});
