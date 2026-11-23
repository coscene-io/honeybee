// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box, Button, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { MouseEvent } from "react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import type { SemanticSegmentationStore } from "../../types";

const useStyles = makeStyles()((theme) => ({
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing(1),
  },
  headerCount: {
    color: theme.palette.text.secondary,
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  viewModes: {
    width: "100%",
    display: "flex",
    gap: theme.spacing(0.75),
    "& .MuiToggleButton-root": {
      flex: 1,
      minHeight: 0,
      height: 26,
      margin: 0,
      padding: theme.spacing(0, 1),
      border: 0,
      borderRadius: "4px !important",
      backgroundColor: theme.palette.action.hover,
      fontSize: 12,
      textTransform: "none",
      fontWeight: 500,
      color: theme.palette.text.secondary,
      "&.Mui-selected": {
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        "&:hover": { backgroundColor: theme.palette.primary.dark },
      },
    },
  },
  toolRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: theme.spacing(0.75),
    "& .MuiButton-root": {
      textTransform: "none",
      minWidth: 0,
      minHeight: 0,
      height: 26,
      padding: theme.spacing(0, 0.5),
      fontSize: 12,
      borderColor: theme.palette.divider,
      color: theme.palette.text.secondary,
    },
  },
  secondaryTools: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(0.75),
    "& .MuiButton-root": { minHeight: 0, height: 24, fontSize: 12 },
  },
}));

export type TreeToolbarActions = {
  setViewMode: (mode: SemanticSegmentationStore["viewMode"]) => void;
  beginCreation: () => void;
  openMerge: () => void;
  openDelete: () => void;
  toggleSelecting: () => void;
  toggleEditing: (event: MouseEvent<HTMLElement>) => void;
  clearFocus: () => void;
};

type TreeToolbarProps = {
  instanceCount: number;
  viewMode: SemanticSegmentationStore["viewMode"];
  hasFocus: boolean;
  editing: boolean;
  selecting: boolean;
  disabled: boolean;
  locked: boolean;
  newDisabled: boolean;
  mergeDisabled: boolean;
  deleteDisabled: boolean;
  hintId: string;
  actions: TreeToolbarActions;
};

/** Header, display modes and the tree-wide action buttons. */
export const TreeToolbar = memo(function TreeToolbar(props: TreeToolbarProps): React.JSX.Element {
  const { instanceCount, viewMode, hasFocus, editing, selecting, disabled, locked } = props;
  const { newDisabled, mergeDisabled, deleteDisabled, hintId, actions } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <>
      <Box className={classes.header}>
        <Typography variant="subtitle1">{t("instances")}</Typography>
        <Typography className={classes.headerCount} component="span">
          {t("instanceCount", { instanceCount })}
        </Typography>
      </Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        className={classes.viewModes}
        value={viewMode}
        aria-label={t("annotationDisplay")}
        onChange={(_event, value: SemanticSegmentationStore["viewMode"] | ReactNull) => {
          if (value && !disabled) {
            actions.setViewMode(value);
          }
        }}
        disabled={disabled}
      >
        <ToggleButton value="original">{t("original")}</ToggleButton>
        <ToggleButton
          value="instance"
          disabled={!hasFocus}
          aria-describedby={!hasFocus ? hintId : undefined}
        >
          {t("instance")}
        </ToggleButton>
        <ToggleButton value="all">{t("all")}</ToggleButton>
      </ToggleButtonGroup>
      {!hasFocus && (
        <Typography id={hintId} variant="caption" color="text.secondary">
          {t("instanceViewNeedsSelection")}
        </Typography>
      )}
      <Box className={classes.toolRow}>
        <Button
          size="small"
          variant="outlined"
          disabled={newDisabled}
          onClick={actions.beginCreation}
        >
          {t("new")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={mergeDisabled}
          onClick={actions.openMerge}
        >
          {t("merge")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={deleteDisabled}
          onClick={actions.openDelete}
        >
          {t("delete")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={locked}
          aria-pressed={selecting}
          onClick={actions.toggleSelecting}
        >
          {t("select")}
        </Button>
      </Box>
      <Box className={classes.secondaryTools}>
        <Button
          size="small"
          variant={editing ? "contained" : "text"}
          disabled={locked || !hasFocus}
          aria-pressed={editing}
          onClick={actions.toggleEditing}
        >
          {editing ? t("doneEditing") : t("edit")}
        </Button>
        {hasFocus && (
          <Button size="small" disabled={disabled} onClick={actions.clearFocus}>
            {t("clearFocus")}
          </Button>
        )}
      </Box>
    </>
  );
});
