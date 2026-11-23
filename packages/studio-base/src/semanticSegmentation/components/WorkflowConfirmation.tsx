// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";

/** A destructive confirmation. Rendered only while open, so it never outlives its context. */
export function WorkflowConfirmation({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  disabled = false,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Dialog
      open
      maxWidth="xs"
      fullWidth
      onClose={onCancel}
      // Keys stay in the dialog: the editor and playback shortcuts must not see them.
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button autoFocus onClick={onCancel}>
          取消
        </Button>
        <Button variant="contained" color="error" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
