// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ArrowBidirectionalLeftRight20Regular } from "@fluentui/react-icons";
import { alpha, InputAdornment, TextField, Tooltip, Typography } from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";

// Minimum allowed seek step, stored in ms. 1e-6 s == 1e-3 ms
export const MIN_SEEK_STEP_MS = 1e-6 * 1000;
export const MAX_SEEK_STEP_MS = 3600 * 1000;

const useStyles = makeStyles()((theme) => ({
  root: {
    alignItems: "center",
    borderRadius: 4,
    display: "grid",
    gridTemplateColumns: "18px minmax(0, 1fr) 88px",
    gap: theme.spacing(1),
    minHeight: 32,
    paddingInline: 8,
    "&:focus-within": { backgroundColor: theme.palette.action.hover },
    "@media (pointer: coarse)": { minHeight: 48 },
  },
  icon: { color: theme.palette.text.secondary, height: 18, width: 18 },
  label: { fontSize: 12, lineHeight: 1.25 },
  input: {
    minWidth: 0,
    "& .MuiInputBase-root": {
      backgroundColor: alpha(theme.palette.text.primary, 0.025),
      borderRadius: 4,
      fontSize: 12,
      height: 26,
      paddingRight: 7,
    },
    "& .MuiOutlinedInput-notchedOutline": {
      borderColor: alpha(theme.palette.text.primary, 0.12),
    },
    "& input": {
      fontVariantNumeric: "tabular-nums",
      minWidth: 0,
      padding: theme.spacing(0, 0, 0, 0.875),
      textAlign: "right",
    },
    "& .MuiInputAdornment-root": { fontSize: 11, marginLeft: 4 },
    "@media (pointer: coarse)": {
      "& .MuiInputBase-root": { fontSize: 16, height: 44 },
    },
  },
}));

export interface SeekStepControlsProps {
  /** Whether the controls should be disabled */
  disabled?: boolean;
  /** Called when editing state changes to disable/enable global key listeners */
  // eslint-disable-next-line @coscene-io/no-boolean-parameters
  onEditingChange?: (editing: boolean) => void;
}

export default function SeekStepControls({
  disabled = false,
  onEditingChange,
}: SeekStepControlsProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("general");
  const id = useId();

  // Seek step configuration
  const [seekStepMs, setSeekStepMs] = useAppConfigurationValue<number>(AppSetting.SEEK_STEP_MS);
  const effectiveSeekMs =
    seekStepMs != undefined && seekStepMs >= MIN_SEEK_STEP_MS && seekStepMs <= MAX_SEEK_STEP_MS
      ? seekStepMs
      : 100;

  // Keep the draft separate so typing does not change playback until it is committed.
  const [seekStepInput, setSeekStepInput] = useState<string | undefined>();
  const editingSeekStep = seekStepInput != undefined;

  // Notify parent of editing state changes
  useEffect(() => {
    onEditingChange?.(editingSeekStep);
    return () => {
      onEditingChange?.(false);
    };
  }, [editingSeekStep, onEditingChange]);

  const commitSeekStep = useCallback(() => {
    if (seekStepInput == undefined) {
      return;
    }
    const trimmed = seekStepInput.trim();
    const minSec = MIN_SEEK_STEP_MS / 1000;
    const maxSec = MAX_SEEK_STEP_MS / 1000;

    if (trimmed === "") {
      void setSeekStepMs(100);
      setSeekStepInput(undefined);
      return;
    }

    const sec = Number(trimmed);
    if (!Number.isFinite(sec)) {
      void setSeekStepMs(100);
      setSeekStepInput(undefined);
      return;
    }

    let clampedSec = sec;
    if (sec < minSec) {
      clampedSec = MIN_SEEK_STEP_MS / 1000;
    } else if (sec > maxSec) {
      clampedSec = MAX_SEEK_STEP_MS / 1000;
    }

    void setSeekStepMs(clampedSec * 1000);
    setSeekStepInput(undefined);
  }, [seekStepInput, setSeekStepMs]);

  return (
    <Tooltip title={t("seekStepHelp")} describeChild>
      <div className={classes.root}>
        <ArrowBidirectionalLeftRight20Regular className={classes.icon} aria-hidden />
        <Typography
          component="label"
          htmlFor={id}
          className={classes.label}
          color={disabled ? "text.disabled" : "text.primary"}
        >
          {t("seekStep")}
        </Typography>
        <TextField
          id={id}
          className={classes.input}
          disabled={disabled}
          size="small"
          variant="outlined"
          value={seekStepInput ?? String(effectiveSeekMs / 1000)}
          onFocus={() => {
            setSeekStepInput(String(effectiveSeekMs / 1000));
          }}
          onChange={(e) => {
            setSeekStepInput(e.target.value);
          }}
          onBlur={commitSeekStep}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              commitSeekStep();
            } else if (e.key === "Escape" && editingSeekStep) {
              e.preventDefault();
              e.stopPropagation();
              setSeekStepInput(undefined);
            }
          }}
          slotProps={{
            htmlInput: { "aria-describedby": `${id}-unit ${id}-help`, inputMode: "decimal" },
            input: {
              endAdornment: (
                <InputAdornment id={`${id}-unit`} position="end" disableTypography>
                  {t("sec")}
                </InputAdornment>
              ),
            },
          }}
        />
        <span id={`${id}-help`} style={visuallyHidden}>
          {t("seekStepHelp")}
        </span>
      </div>
    </Tooltip>
  );
}
