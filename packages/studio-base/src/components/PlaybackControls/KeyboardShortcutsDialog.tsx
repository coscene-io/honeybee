// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dialog, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  useWorkspaceSlotValues,
  type ShortcutSection,
} from "@foxglove/studio-base/context/WorkspaceSlots";

import { MOD, SHORTCUTS, ShortcutKeys } from "./keyboardShortcuts";
import {
  closeKeyboardShortcuts,
  useKeyboardShortcutsDialogStore,
} from "./keyboardShortcutsDialogStore";

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
  columns: {
    display: "grid",
    gap: theme.spacing(3),
    gridTemplateColumns: "1fr 1fr",
    [theme.breakpoints.down("sm")]: {
      gridTemplateColumns: "1fr",
    },
  },
  columnTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
  },
}));

/**
 * The one keyboard shortcuts dialog; the Workspace mounts it once and anything opens it with
 * `openKeyboardShortcuts()`. Features add a column through WorkspaceSlots `shortcutColumns`.
 */
export function KeyboardShortcutsDialog(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("general");
  const open = useKeyboardShortcutsDialogStore((state) => state.open);
  const extraColumns = useWorkspaceSlotValues("shortcutColumns");

  // Rows reference the shared SHORTCUTS definitions so the dialog stays in sync with the per-control
  // tooltips. The zoom-at-cursor row interpolates the localized "scroll" word, so it's built here.
  const sections = useMemo(
    (): readonly ShortcutSection[] =>
      (
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
        ] as const
      ).map((section) => ({
        title: t(section.titleKey),
        rows: section.rows.map((row) => ({ label: t(row.labelKey), keys: row.keys })),
      })),
    [t],
  );

  const renderSections = (list: readonly ShortcutSection[]) =>
    list.map((section) => (
      <div key={section.title} className={classes.section}>
        <Typography variant="caption" component="div" className={classes.sectionTitle}>
          {section.title}
        </Typography>
        {section.rows.map((row) => (
          <div key={row.label} className={classes.row}>
            <Typography variant="body2" className={classes.label}>
              {row.label}
            </Typography>
            <ShortcutKeys keys={row.keys} />
          </div>
        ))}
      </div>
    ));

  return (
    <Dialog
      open={open}
      onClose={closeKeyboardShortcuts}
      maxWidth={extraColumns.length > 0 ? "md" : "xs"}
      fullWidth
    >
      <DialogTitle>{t("keyboardShortcuts")}</DialogTitle>
      <DialogContent>
        {extraColumns.length > 0 ? (
          <div className={classes.columns}>
            <div>{renderSections(sections)}</div>
            {extraColumns.map((column) => (
              <div key={column.title}>
                <Typography variant="subtitle2" className={classes.columnTitle}>
                  {column.title}
                </Typography>
                {renderSections(column.sections)}
              </div>
            ))}
          </div>
        ) : (
          renderSections(sections)
        )}
      </DialogContent>
    </Dialog>
  );
}
