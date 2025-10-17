// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Button,
  ClickAwayListener,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";

// Minimum allowed seek step, stored in ms. 1e-6 s == 1e-3 ms
export const MIN_SEEK_STEP_MS = 1e-6 * 1000;
export const MAX_SEEK_STEP_MS = 3600 * 1000;

const useStyles = makeStyles()((theme) => ({
  seekStepButton: {
    minWidth: "auto",
    padding: theme.spacing(1, 1),
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

export interface SeekStepControlsProps {
  /** Whether the controls should be disabled */
  disabled?: boolean;
  /** Called when editing state changes to disable/enable global key listeners */
  // eslint-disable-next-line @foxglove/no-boolean-parameters
  onEditingChange?: (editing: boolean) => void;
}

export default function SeekStepControls({
  disabled = false,
  onEditingChange,
}: SeekStepControlsProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation(["cosGeneral", "general"]);

  // Seek step configuration
  const [seekStepMs, setSeekStepMs] = useAppConfigurationValue<number>(AppSetting.SEEK_STEP_MS);
  const effectiveSeekMs =
    seekStepMs != undefined && seekStepMs >= MIN_SEEK_STEP_MS && seekStepMs <= MAX_SEEK_STEP_MS
      ? seekStepMs
      : 100;

  // Editing state
  const [editingSeekStep, setEditingSeekStep] = useState(false);
  const [seekStepInput, setSeekStepInput] = useState<string>(String(effectiveSeekMs / 1000));
  const seekInputRef = useRef<HTMLInputElement | ReactNull>(ReactNull);

  // Notify parent of editing state changes
  useEffect(() => {
    onEditingChange?.(editingSeekStep);
  }, [editingSeekStep, onEditingChange]);

  // Update input when editing starts or effective value changes
  useEffect(() => {
    if (editingSeekStep) {
      setSeekStepInput(String(effectiveSeekMs / 1000));
      // Focus input next tick
      setTimeout(() => seekInputRef.current?.focus(), 0);
    }
  }, [editingSeekStep, effectiveSeekMs]);

  const commitSeekStep = useCallback(() => {
    const sec = Number(seekStepInput.trim());
    const minSec = MIN_SEEK_STEP_MS / 1000; // Convert ms to seconds for comparison
    const maxSec = MAX_SEEK_STEP_MS / 1000; // Convert ms to seconds for comparison

    if (!Number.isFinite(sec) || sec < minSec || sec > maxSec) {
      // Reset to a sensible default and inform the user
      void setSeekStepMs(100);
      setSeekStepInput("0.1");
      toast.error(t("invalidSeekStep", { ns: "cosGeneral" }));
      setEditingSeekStep(false);
      return;
    }

    // Preserve sub-millisecond precision by avoiding integer rounding
    const nMs = Math.max(MIN_SEEK_STEP_MS, sec * 1000);
    void setSeekStepMs(nMs);
    setEditingSeekStep(false);
  }, [seekStepInput, setSeekStepMs, t]);

  const startEditing = useCallback(() => {
    setEditingSeekStep(true);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingSeekStep(false);
    setSeekStepInput(String(effectiveSeekMs / 1000));
  }, [effectiveSeekMs]);

  if (editingSeekStep) {
    return (
      <ClickAwayListener onClickAway={commitSeekStep}>
        <TextField
          inputRef={seekInputRef}
          autoFocus
          size="small"
          variant="outlined"
          value={seekStepInput}
          onChange={(e) => {
            setSeekStepInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitSeekStep();
            } else if (e.key === "Escape") {
              cancelEditing();
            }
            e.stopPropagation();
          }}
          style={{ width: 100 }}
          placeholder={t("sec", { ns: "general" })}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">{t("sec", { ns: "general" })}</InputAdornment>
              ),
            },
          }}
        />
      </ClickAwayListener>
    );
  }

  return (
    <Tooltip title={t("seekStep", { ns: "cosGeneral" })}>
      <Button
        className={classes.seekStepButton}
        size="small"
        disabled={disabled}
        onClick={startEditing}
        variant="text"
        color="inherit"
      >
        <Typography variant="body2" marginLeft="4px" fontWeight="bold">
          {(effectiveSeekMs / 1000).toFixed(9).replace(/\.?0+$/, "")} {t("sec", { ns: "general" })}
        </Typography>
      </Button>
    </Tooltip>
  );
}
