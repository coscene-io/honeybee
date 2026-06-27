// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { Fragment } from "react";
import { makeStyles } from "tss-react/mui";

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Platform-specific modifier symbol: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = isMac ? "⌘" : "Ctrl";

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
  createMoment: ["Alt + 1"],
  setInOut: ["I", "O"],
  deleteMoment: ["Delete", "Backspace"],
  zoom: [`${MOD} + =`, `${MOD} + −`],
  zoomIn: [`${MOD} + =`],
  zoomOut: [`${MOD} + −`],
  zoomFit: ["Shift + Z"],
} as const;

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
