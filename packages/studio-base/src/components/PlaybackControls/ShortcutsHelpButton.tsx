// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import KeyboardIcon from "@mui/icons-material/KeyboardOutlined";
import { Dialog, DialogContent, DialogTitle, Typography } from "@mui/material";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

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
}));

export function ShortcutsHelpButton(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("general");
  const [open, setOpen] = useState(false);

  // Each row's `keys` is a list of interchangeable shortcuts rendered as separate key chips
  // joined by a "/" — e.g. ["←", "→"] reads "← / →". Combined chords stay one chip ("Alt + 1").
  const sections = useMemo(
    () =>
      [
        {
          titleKey: "shortcutsSectionPlayback",
          rows: [
            { keys: ["Space"], labelKey: "shortcutPlayPause" },
            { keys: ["←", "→"], labelKey: "shortcutSeekStep" },
            { keys: ["−", "+"], labelKey: "shortcutPlaybackSpeed" },
          ],
        },
        {
          titleKey: "shortcutsSectionMoments",
          rows: [
            { keys: ["↑", "↓"], labelKey: "shortcutSelectMoment" },
            { keys: ["Enter"], labelKey: "shortcutSeekToMoment" },
            { keys: ["Alt + 1"], labelKey: "shortcutCreateMoment" },
            { keys: ["I", "O"], labelKey: "shortcutSetInOut" },
            { keys: ["Delete", "Backspace"], labelKey: "shortcutDeleteMoment" },
          ],
        },
        {
          titleKey: "shortcutsSectionTimeline",
          rows: [
            { keys: [`${MOD} + =`, `${MOD} + −`], labelKey: "shortcutZoom" },
            { keys: ["Shift + Z"], labelKey: "shortcutZoomFit" },
            { keys: [`${MOD} + ${t("mouseWheel")}`], labelKey: "shortcutZoomCursor" },
          ],
        },
      ] as const,
    [t],
  );

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
          {sections.map((section) => (
            <div key={section.titleKey} className={classes.section}>
              <Typography variant="caption" component="div" className={classes.sectionTitle}>
                {t(section.titleKey)}
              </Typography>
              {section.rows.map((row) => (
                <div key={row.labelKey} className={classes.row}>
                  <Typography variant="body2" className={classes.label}>
                    {t(row.labelKey)}
                  </Typography>
                  <div className={classes.keyGroup}>
                    {row.keys.map((key, index) => (
                      <Fragment key={key}>
                        {index > 0 && <span className={classes.keySeparator}>/</span>}
                        <span className={classes.key}>{key}</span>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
