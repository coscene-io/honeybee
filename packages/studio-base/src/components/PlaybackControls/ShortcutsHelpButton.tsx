// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import KeyboardIcon from "@mui/icons-material/KeyboardOutlined";
import { Dialog, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";

import { MOD, SHORTCUTS, ShortcutKeys } from "./keyboardShortcuts";

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
}));

export function ShortcutsHelpButton(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("general");
  const [open, setOpen] = useState(false);

  // Rows reference the shared SHORTCUTS definitions so the dialog stays in sync with the per-control
  // tooltips. The zoom-at-cursor row interpolates the localized "scroll" word, so it's built here.
  const sections = useMemo(
    () =>
      [
        {
          titleKey: "shortcutsSectionPlayback",
          rows: [
            { keys: SHORTCUTS.playPause, labelKey: "shortcutPlayPause" },
            { keys: SHORTCUTS.seekStep, labelKey: "shortcutSeekStep" },
            { keys: SHORTCUTS.playbackSpeed, labelKey: "shortcutPlaybackSpeed" },
          ],
        },
        {
          titleKey: "shortcutsSectionMoments",
          rows: [
            { keys: SHORTCUTS.selectMoment, labelKey: "shortcutSelectMoment" },
            { keys: SHORTCUTS.seekToMoment, labelKey: "shortcutSeekToMoment" },
            { keys: SHORTCUTS.createMoment, labelKey: "shortcutCreateMoment" },
            { keys: SHORTCUTS.setInOut, labelKey: "shortcutSetInOut" },
            { keys: SHORTCUTS.deleteMoment, labelKey: "shortcutDeleteMoment" },
          ],
        },
        {
          titleKey: "shortcutsSectionTimeline",
          rows: [
            { keys: SHORTCUTS.zoom, labelKey: "shortcutZoom" },
            { keys: SHORTCUTS.zoomFit, labelKey: "shortcutZoomFit" },
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
                  <ShortcutKeys keys={row.keys} />
                </div>
              ))}
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
