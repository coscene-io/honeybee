// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ArrowRedo20Regular, ArrowUndo20Regular } from "@fluentui/react-icons";
import { Button, Divider, MenuItem, MenuList, Popover } from "@mui/material";
import { useState } from "react";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { AppBarIconButton } from "@foxglove/studio-base/components/AppBar/AppBarIconButton";

import {
  endSegmentationSession,
  openWorkflowPanel,
  segmentationSession,
  type SegmentationRuntime,
} from "../runtime";
import { SubmissionControls } from "./WorkflowControls";

const useStyles = makeStyles()((theme) => ({
  paper: {
    marginTop: theme.spacing(0.5),
    width: 300,
    maxWidth: "calc(100vw - 24px)",
  },
  content: { padding: theme.spacing(1.5, 1.5, 1) },
  submit: { whiteSpace: "nowrap", gap: theme.spacing(0.75) },
  count: {
    minWidth: 18,
    padding: theme.spacing(0, 0.5),
    borderRadius: 9,
    backgroundColor: theme.palette.warning.main,
    color: theme.palette.warning.contrastText,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "18px",
    textAlign: "center",
  },
  danger: { color: theme.palette.error.main },
}));

function ActionButtons({
  runtime,
  sourceReady,
}: {
  runtime: SegmentationRuntime;
  sourceReady: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { store } = runtime;
  const state = useStore(store);
  const [submitAnchor, setSubmitAnchor] = useState<HTMLElement>();
  const locked = ["running", "stopping"].includes(state.propagation.status);
  const frameReady =
    sourceReady && state.currentFrameId != undefined && state.isFrameReady(state.currentFrameId);
  const busy = !frameReady || state.loading;
  const staged = state.stagedOperations.length;
  const dirty = staged > 0;
  const closeSubmit = () => {
    setSubmitAnchor(undefined);
  };
  return (
    <>
      <AppBarIconButton
        title="撤销标注"
        aria-label="撤销标注"
        disabled={busy || !dirty}
        onClick={state.undo}
      >
        <ArrowUndo20Regular />
      </AppBarIconButton>
      <AppBarIconButton
        title="重做标注"
        aria-label="重做标注"
        disabled={busy || !state.canRedo}
        onClick={state.redo}
      >
        <ArrowRedo20Regular />
      </AppBarIconButton>
      <Button
        className={classes.submit}
        variant="outlined"
        size="small"
        color="inherit"
        aria-haspopup="dialog"
        aria-expanded={submitAnchor != undefined}
        onClick={(event) => {
          setSubmitAnchor(event.currentTarget);
        }}
      >
        提交
        {dirty && (
          <span className={classes.count} aria-label={`${staged} 项暂存`}>
            {staged}
          </span>
        )}
      </Button>
      <Popover
        open={submitAnchor != undefined}
        anchorEl={submitAnchor}
        onClose={closeSubmit}
        keepMounted
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { className: classes.paper } }}
      >
        <div role="dialog" aria-label="提交">
          <div className={classes.content}>
            <SubmissionControls store={store} disabled={busy} menu />
          </div>
          <Divider />
          <MenuList dense>
            <MenuItem
              onClick={() => {
                openWorkflowPanel("seg-submissions");
                closeSubmit();
              }}
            >
              提交队列
            </MenuItem>
            <MenuItem
              className={classes.danger}
              disabled={locked}
              onClick={() => {
                closeSubmit();
                endSegmentationSession();
              }}
            >
              结束标注
            </MenuItem>
          </MenuList>
        </div>
      </Popover>
    </>
  );
}

/** Undo, redo and submit for the open record session, shown once in the app bar. */
export function SegmentationActionMenu(): React.JSX.Element | undefined {
  const session = useStore(segmentationSession);
  return session.open && session.runtime ? (
    <ActionButtons runtime={session.runtime} sourceReady={session.sourceReady} />
  ) : undefined;
}
