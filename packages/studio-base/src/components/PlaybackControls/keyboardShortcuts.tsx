// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { Fragment } from "react";
import { makeStyles } from "tss-react/mui";

import type { general } from "@foxglove/studio-base/i18n/en/general";

export function isMacUserAgent(userAgent: string): boolean {
  return /Mac|iPhone|iPad/.test(userAgent);
}

const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMac = isMacUserAgent(userAgent);

/** Platform-specific modifier symbol: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = isMac ? "⌘" : "Ctrl";

export function getCreateMomentShortcut(currentUserAgent: string): "Option + 1" | "Alt + 1" {
  return isMacUserAgent(currentUserAgent) ? "Option + 1" : "Alt + 1";
}

/**
 * Keyboard shortcut definitions, keyed by action. Each value is a list of interchangeable
 * shortcuts rendered as separate key chips joined by "/" — e.g. ["←", "→"] reads "← / →".
 * Combined chords stay one chip ("Alt + 1").
 *
 * This is the single source of truth shared by the keyboard shortcuts help dialog
 * (ShortcutsHelpButton) and the per-control tooltips (Scrubber, PlaybackControls,
 * PlaybackSpeedControls), so the two never drift apart.
 *
 * `zoomCursor` interpolates the localized "scroll" word, so it's built at the call site where the
 * translation is available rather than stored here.
 */
export const SHORTCUTS = {
  playPause: ["Space"],
  seekBackward: ["←"],
  seekForward: ["→"],
  seekStep: ["←", "→"],
  playbackSpeed: ["−", "+"],
  selectMoment: ["↑", "↓"],
  seekToMoment: ["Enter"],
  createMoment: [getCreateMomentShortcut(userAgent)],
  setInOut: ["I", "O"],
  deleteMoment: ["Delete", "Backspace"],
  zoom: [`${MOD} + =`, `${MOD} + −`],
  zoomIn: [`${MOD} + =`],
  zoomOut: [`${MOD} + −`],
  zoomFit: ["Shift + Z"],
} as const;

type GeneralKey = keyof typeof general;

export type SegmentationShortcutRow = {
  labelKey: GeneralKey;
  keys: readonly string[];
};

export type SegmentationShortcutSection = {
  titleKey: GeneralKey;
  rows: readonly SegmentationShortcutRow[];
};

/**
 * Annotation-canvas bindings, matching what SegmentationCanvas handles. `drag` and `click` are the
 * localized words used inside chords such as "Space + drag"; they cannot live in this table because
 * the translation is only available at the call site.
 */
export function getSegmentationShortcuts(
  currentUserAgent: string,
  words: { drag: string; click: string } = { drag: "drag", click: "click" },
): {
  sections: readonly SegmentationShortcutSection[];
  byAction: Record<
    "fit" | "fitSelection" | "actualSize" | "zoomIn" | "zoomOut" | "panTool",
    readonly string[]
  >;
} {
  const mac = isMacUserAgent(currentUserAgent);
  const mod = mac ? "⌘" : "Ctrl";
  const byAction = {
    fit: ["F"],
    fitSelection: ["Shift + F"],
    actualSize: ["0"],
    zoomIn: ["+"],
    zoomOut: ["−"],
    panTool: ["H"],
  } as const;
  return {
    byAction,
    sections: [
      {
        titleKey: "segmentationSectionView",
        rows: [
          { labelKey: "segmentationFit", keys: byAction.fit },
          { labelKey: "segmentationFitSelection", keys: byAction.fitSelection },
          { labelKey: "segmentationActualSize", keys: byAction.actualSize },
          { labelKey: "segmentationZoom", keys: [...byAction.zoomIn, ...byAction.zoomOut] },
          { labelKey: "segmentationPanTool", keys: byAction.panTool },
          { labelKey: "segmentationTemporaryPan", keys: [`Space + ${words.drag}`] },
          { labelKey: "segmentationViewOriginal", keys: ["O"] },
        ],
      },
      {
        titleKey: "segmentationSectionEdit",
        rows: [
          { labelKey: "segmentationToggleEditing", keys: ["Enter"] },
          { labelKey: "segmentationCancel", keys: ["Esc"] },
          { labelKey: "segmentationDeleteVertices", keys: ["Delete", "Backspace"] },
          {
            labelKey: "segmentationDeleteVertex",
            keys: [`${mac ? "Option" : "Alt"} + ${words.click}`],
          },
          { labelKey: "segmentationNudge", keys: ["←", "↑", "↓", "→"] },
          { labelKey: "segmentationNudgeLarge", keys: ["Shift + ←↑↓→"] },
        ],
      },
      {
        titleKey: "segmentationSectionHistory",
        rows: [
          { labelKey: "segmentationUndo", keys: [`${mod} + Z`] },
          {
            labelKey: "segmentationRedo",
            keys: mac ? [`${mod} + Shift + Z`] : [`${mod} + Shift + Z`, `${mod} + Y`],
          },
        ],
      },
      {
        titleKey: "segmentationSectionFrames",
        rows: [
          { labelKey: "segmentationStepFrame", keys: ["←", "→"] },
          { labelKey: "segmentationStepFrameLarge", keys: ["Shift + ←", "Shift + →"] },
        ],
      },
    ],
  };
}

export const SEGMENTATION_SHORTCUTS = getSegmentationShortcuts(userAgent).byAction;

const useStyles = makeStyles()((theme) => ({
  keyGroup: {
    alignItems: "center",
    display: "inline-flex",
    flex: "0 0 auto",
    gap: theme.spacing(0.5),
  },
  keySeparator: {
    color: theme.palette.text.secondary,
  },
  key: {
    backgroundColor: theme.palette.action.hover,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    color: theme.palette.text.primary,
    fontFamily: theme.typography.fontMonospace,
    fontSize: theme.typography.pxToRem(12),
    paddingBlock: theme.spacing(0.25),
    paddingInline: theme.spacing(0.75),
    whiteSpace: "nowrap",
  },
  // Tooltips render on a dark background, so the chips need light-on-dark styling instead of the
  // panel's light-background palette.
  keySeparatorOnDark: {
    color: alpha(theme.palette.common.white, 0.6),
  },
  keyOnDark: {
    backgroundColor: alpha(theme.palette.common.white, 0.16),
    borderColor: alpha(theme.palette.common.white, 0.28),
    color: theme.palette.common.white,
  },
  hint: {
    alignItems: "center",
    display: "inline-flex",
    gap: theme.spacing(1),
  },
}));

/**
 * Renders a list of interchangeable shortcut keys as chips joined by "/".
 * Use `variant="tooltip"` when rendering inside a (dark) MUI tooltip.
 */
export function ShortcutKeys({
  keys,
  variant = "panel",
}: {
  keys: readonly string[];
  variant?: "panel" | "tooltip";
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const onDark = variant === "tooltip";

  return (
    <span className={classes.keyGroup}>
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && (
            <span className={cx(classes.keySeparator, { [classes.keySeparatorOnDark]: onDark })}>
              /
            </span>
          )}
          <span className={cx(classes.key, { [classes.keyOnDark]: onDark })}>{key}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Tooltip body that pairs a control's existing hint text with its keyboard shortcut chip(s),
 * so the shortcuts surfaced in the help dialog are also discoverable on the controls themselves.
 */
export function ShortcutHint({
  label,
  keys,
}: {
  label: string;
  keys: readonly string[];
}): React.JSX.Element {
  const { classes } = useStyles();

  return (
    <span className={classes.hint}>
      <span>{label}</span>
      <ShortcutKeys keys={keys} variant="tooltip" />
    </span>
  );
}
