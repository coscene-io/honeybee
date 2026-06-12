// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import KeyboardIcon from "@mui/icons-material/KeyboardOutlined";
import { Dialog, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

const SECTIONS = [
  {
    titleKey: "shortcutsSectionPlayback",
    rows: [
      { combo: "Space", labelKey: "shortcutPlayPause" },
      { combo: "← / →", labelKey: "shortcutSeekStep" },
      { combo: "− / +", labelKey: "shortcutPlaybackSpeed" },
    ],
  },
  {
    titleKey: "shortcutsSectionMoments",
    rows: [
      { combo: "↑ / ↓", labelKey: "shortcutSelectMoment" },
      { combo: "Enter", labelKey: "shortcutSeekToMoment" },
      { combo: "Alt + 1", labelKey: "shortcutCreateMoment" },
      { combo: "I / O", labelKey: "shortcutSetInOut" },
      { combo: "Delete / Backspace", labelKey: "shortcutDeleteMoment" },
    ],
  },
  {
    titleKey: "shortcutsSectionTimeline",
    rows: [
      { combo: `${MOD} + = / −`, labelKey: "shortcutZoom" },
      { combo: "Shift + Z", labelKey: "shortcutZoomFit" },
      { combo: `${MOD} + ${isMac ? "scroll" : "wheel"}`, labelKey: "shortcutZoomCursor" },
    ],
  },
] as const;

const useStyles = makeStyles()((theme) => ({
  section: {
    marginTop: theme.spacing(2),
    "&:first-of-type": {
      marginTop: 0,
    },
  },
  sectionTitle: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    marginBottom: theme.spacing(1),
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  row: {
    alignItems: "center",
    display: "flex",
    gap: theme.spacing(2),
    justifyContent: "space-between",
    paddingBlock: theme.spacing(0.5),
  },
  label: {
    color: theme.palette.text.primary,
  },
  keys: {
    backgroundColor: theme.palette.action.hover,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    color: theme.palette.text.primary,
    flex: "0 0 auto",
    fontFamily: theme.typography.fontMonospace,
    fontSize: theme.typography.pxToRem(12),
    paddingBlock: theme.spacing(0.25),
    paddingInline: theme.spacing(0.75),
    whiteSpace: "nowrap",
  },
}));

export function ShortcutsHelpButton(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("general");
  const [open, setOpen] = useState(false);

  return (
    <>
      <HoverableIconButton
        size="small"
        title={t("keyboardShortcuts")}
        aria-label={t("keyboardShortcuts")}
        icon={<KeyboardIcon fontSize="small" />}
        onClick={() => {
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("keyboardShortcuts")}</DialogTitle>
        <DialogContent>
          {SECTIONS.map((section) => (
            <div key={section.titleKey} className={classes.section}>
              <Typography variant="caption" component="div" className={classes.sectionTitle}>
                {t(section.titleKey)}
              </Typography>
              {section.rows.map((row) => (
                <div key={row.labelKey} className={classes.row}>
                  <Typography variant="body2" className={classes.label}>
                    {t(row.labelKey)}
                  </Typography>
                  <span className={classes.keys}>{row.combo}</span>
                </div>
              ))}
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
