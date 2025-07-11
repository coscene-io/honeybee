// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Dialog, DialogContent, DialogTitle, DialogActions, Button, Paper } from "@mui/material";
import { useCallback, useRef } from "react";
import { useKeyPressEvent } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { DialogsStore, useDialogs } from "@foxglove/studio-base/context/DialogsContext";

type ConfirmVariant = "danger" | "primary" | "toast";
type ConfirmAction = "ok" | "cancel";

export type ConfirmOptions = {
  // the title of the confirm modal
  title: string;
  // text in the body of the confirm modal. Specify a string or JSX Element
  prompt?: string | React.JSX.Element;
  // the text for the OK button - defaults to "OK"
  ok?: string;
  // the text for the cancel button - defaults to "Cancel"
  // set to false to completely hide the cancel button
  cancel?: string | false;
  // indicate the type of confirmation
  variant?: ConfirmVariant;
  // if true, the escape key will not close the modal
  disableEscapeKeyDown?: boolean;
  // if true, the backdrop click will not close the modal
  disableBackdropClick?: boolean;
};

type ConfirmModalProps = ConfirmOptions & {
  onComplete: (value: ConfirmAction) => void;
};

function ConfirmModal(props: ConfirmModalProps) {
  const originalOnComplete = props.onComplete;

  const completed = useRef(false);
  const onComplete = useCallback(
    (result: ConfirmAction) => {
      if (!completed.current) {
        completed.current = true;
        originalOnComplete(result);
      }
    },
    [originalOnComplete],
  );

  useKeyPressEvent("Enter", () => {
    onComplete("ok");
  });

  const buttons = [
    props.cancel !== false && (
      <Button
        variant="outlined"
        color="inherit"
        key="cancel"
        onClick={() => {
          onComplete("cancel");
        }}
      >
        {props.cancel ?? "Cancel"}
      </Button>
    ),
    <Button
      key="confirm"
      variant="contained"
      color={props.variant === "danger" ? "error" : "primary"}
      type="submit"
    >
      {props.ok ?? "OK"}
    </Button>,
  ];
  if (props.variant === "danger") {
    buttons.reverse();
  }

  // Toast variant - positioned at top right
  if (props.variant === "toast") {
    return (
      <Paper
        elevation={8}
        style={{
          position: "fixed",
          top: 50,
          right: 16,
          zIndex: 9999,
          maxWidth: 400,
          minWidth: 300,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
          borderRadius: 8,
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onComplete("ok");
          }}
        >
          <DialogTitle>{props.title}</DialogTitle>
          <DialogContent>{props.prompt}</DialogContent>
          <DialogActions>{buttons}</DialogActions>
        </form>
      </Paper>
    );
  }

  return (
    <Dialog
      open
      onClose={(_e, reason) => {
        if ((props.disableEscapeKeyDown ?? false) && reason === "escapeKeyDown") {
          return;
        }
        if ((props.disableBackdropClick ?? false) && reason === "backdropClick") {
          return;
        }
        onComplete("cancel");
      }}
      maxWidth="sm"
      fullWidth
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onComplete("ok");
        }}
      >
        <DialogTitle>{props.title}</DialogTitle>
        <DialogContent>{props.prompt}</DialogContent>
        <DialogActions>{buttons}</DialogActions>
      </form>
    </Dialog>
  );
}

export type confirmTypes = (options: ConfirmOptions) => Promise<ConfirmAction>;
export type confirmModalTypes = React.JSX.Element | undefined;

const selectAddDialog = (store: DialogsStore) => store.addDialog;
const selectRemoveDialog = (store: DialogsStore) => store.removeDialog;

// Returns a function that can be used similarly to the DOM confirm(), but
// backed by a React element rather than a native modal, and asynchronous.
export function useConfirm(): (options: ConfirmOptions) => Promise<ConfirmAction> {
  const addDialog = useDialogs(selectAddDialog);
  const removeDialog = useDialogs(selectRemoveDialog);

  const openConfirm = useCallback(
    async (options: ConfirmOptions, key?: string) => {
      const dialogKey = key ?? uuidv4();
      return await new Promise<ConfirmAction>((resolve) => {
        addDialog({
          key: dialogKey,
          dialog: (
            <ConfirmModal
              {...options}
              onComplete={(value) => {
                resolve(value);
                removeDialog({ key: dialogKey });
              }}
            />
          ),
        });
      });
    },
    [addDialog, removeDialog],
  );

  return openConfirm;
}
