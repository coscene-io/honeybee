// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Stack, TextField } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()((theme) => ({
  creationRow: {
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
  },
}));

type ClassCreationRowProps = {
  name: string;
  error: string | undefined;
  locked: boolean;
  cancelDisabled: boolean;
  onName: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The inline "new class" form at the end of the tree. */
export const ClassCreationRow = memo(function ClassCreationRow({
  name,
  error,
  locked,
  cancelDisabled,
  onName,
  onConfirm,
  onCancel,
}: ClassCreationRowProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <Stack role="group" aria-label={t("newClassRow")} spacing={1} className={classes.creationRow}>
      <TextField
        autoFocus
        fullWidth
        disabled={locked}
        label={t("className")}
        value={name}
        error={error != undefined}
        helperText={error ?? t("enterConfirmsEscCancels")}
        slotProps={{ htmlInput: { maxLength: 100 } }}
        onChange={(event) => {
          onName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            onConfirm();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <Stack direction="row" spacing={1}>
        <Button size="small" disabled={locked} onClick={onConfirm}>
          {t("confirm")}
        </Button>
        <Button size="small" disabled={cancelDisabled} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </Stack>
    </Stack>
  );
});
