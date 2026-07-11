// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Button, CircularProgress, IconButton, Typography } from "@mui/material";
import { makeStyles } from "tss-react/mui";

type Props = {
  readonly message: string;
  readonly cancelLabel?: string;
  readonly onCancel?: () => void;
  readonly closeLabel?: string;
  readonly onClose?: () => void;
};

const useStyles = makeStyles()((theme) => ({
  root: {
    alignItems: "center",
    backgroundColor: theme.palette.background.paper,
    borderTop: `1px solid ${theme.palette.divider}`,
    borderBottom: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    display: "flex",
    flex: "none",
    gap: theme.spacing(0.75),
    justifyContent: "center",
    minHeight: theme.spacing(3.5),
    padding: theme.spacing(0.25, 1),
    position: "relative",
  },
  progress: {
    color: theme.palette.primary.main,
  },
  message: {
    fontSize: theme.typography.caption.fontSize,
  },
  cancelButton: {
    fontSize: theme.typography.caption.fontSize,
    minWidth: "auto",
    padding: theme.spacing(0.25, 0.75),
  },
  closeButton: {
    color: "inherit",
    fontSize: theme.typography.pxToRem(16),
    padding: theme.spacing(0.25),
    position: "absolute",
    right: theme.spacing(0.5),
  },
}));

export default function FrameNavigationStatus(props: Props): React.JSX.Element {
  const { message, cancelLabel, onCancel, closeLabel, onClose } = props;
  const { classes } = useStyles();

  return (
    <div className={classes.root} role="status" aria-live="polite">
      {onCancel != undefined && (
        <CircularProgress className={classes.progress} size={14} thickness={5} />
      )}
      <Typography className={classes.message} component="span">
        {message}
      </Typography>
      {onCancel != undefined && cancelLabel != undefined && (
        <Button className={classes.cancelButton} onClick={onCancel} size="small" type="button">
          {cancelLabel}
        </Button>
      )}
      {onCancel == undefined && onClose != undefined && closeLabel != undefined && (
        <IconButton
          aria-label={closeLabel}
          className={classes.closeButton}
          onClick={onClose}
          size="small"
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      )}
    </div>
  );
}
