// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ArrowRedo20Regular, ArrowUndo20Regular } from "@fluentui/react-icons";
import { Popover } from "@mui/material";
import { useState } from "react";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { openWorkflowPanel, segmentationSession, type SegmentationRuntime } from "../runtime";
import { SubmissionControls } from "./WorkflowControls";

import "./workbench.css";

const useStyles = makeStyles()((theme) => ({
  paper: {
    marginTop: theme.spacing(0.5),
    width: 280,
    maxWidth: "calc(100vw - 24px)",
    border: `1px solid ${theme.palette.divider}`,
    backgroundImage: "none",
  },
  menu: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.5),
    padding: theme.spacing(1),
    color: theme.palette.text.primary,
    fontSize: theme.typography.body2.fontSize,
    "& hr": {
      width: "100%",
      margin: theme.spacing(0.5, 0),
      border: 0,
      borderTop: `1px solid ${theme.palette.divider}`,
    },
    "& button:focus-visible, & input:focus-visible, & summary:focus-visible": {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 1,
    },
  },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(1.5),
    width: "100%",
    minHeight: 32,
    padding: theme.spacing(0, 1),
    border: 0,
    borderRadius: theme.shape.borderRadius,
    background: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    "&:hover:not(:disabled)": { backgroundColor: theme.palette.action.hover },
    "&:disabled": { color: theme.palette.text.disabled, cursor: "default" },
  },
  danger: { color: theme.palette.error.main },
  badge: {
    display: "inline-block",
    marginLeft: theme.spacing(0.75),
    padding: theme.spacing(0, 0.75),
    borderRadius: 9,
    backgroundColor: theme.palette.warning.main,
    color: theme.palette.warning.contrastText,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "16px",
  },
  // Layout and colors for the shared SubmissionControls when it is shown as a menu.
  submission: {
    "& .seg-menu-submission": {
      display: "flex",
      flexDirection: "column",
      gap: theme.spacing(1),
    },
    "& .seg-menu-submission input": {
      order: 1,
      height: 32,
      minWidth: 0,
      padding: theme.spacing(0, 1),
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.background.default,
      color: theme.palette.text.primary,
      font: "inherit",
      "&::placeholder": { color: theme.palette.text.secondary },
      "&:disabled": { opacity: 0.5 },
    },
    "& .seg-menu-submission .seg-submit": {
      order: 2,
      height: 32,
      border: 0,
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
      font: "inherit",
      fontWeight: 600,
      cursor: "pointer",
      "&.seg-dirty": {
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
      },
      "&:disabled": {
        backgroundColor: theme.palette.action.disabledBackground,
        color: theme.palette.action.disabled,
        cursor: "default",
      },
    },
    "& .seg-menu-submission .seg-queue-details": {
      order: 3,
      color: theme.palette.text.primary,
      // Reset the legacy dark "pill" summary from workbench.css so it reads like the other menu rows.
      "& summary": {
        display: "flex",
        alignItems: "center",
        gap: theme.spacing(1),
        minHeight: 32,
        padding: theme.spacing(0, 1),
        border: 0,
        borderRadius: theme.shape.borderRadius,
        backgroundColor: "transparent",
        color: "inherit",
        fontSize: "inherit",
        cursor: "pointer",
        listStyle: "none",
        "&:hover": { backgroundColor: theme.palette.action.hover },
        "&::-webkit-details-marker": { display: "none" },
      },
    },
    "& .seg-menu-submission .seg-queue-dot": {
      width: 8,
      height: 8,
      borderRadius: "50%",
      backgroundColor: theme.palette.success.main,
    },
    "& .seg-menu-submission .seg-popover": {
      position: "static",
      width: "auto",
      maxHeight: 200,
      overflow: "auto",
      marginTop: theme.spacing(0.5),
      padding: theme.spacing(1, 1.5),
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.background.default,
      boxShadow: "none",
      color: theme.palette.text.primary,
      "& ol": { margin: theme.spacing(0.5, 0), paddingLeft: theme.spacing(2.5) },
      "& p": { margin: theme.spacing(0.5, 0) },
    },
    "& .seg-menu-submission .seg-clear": {
      order: 4,
      minHeight: 32,
      padding: theme.spacing(0, 1),
      border: 0,
      borderRadius: theme.shape.borderRadius,
      background: "none",
      color: theme.palette.error.main,
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
      "&:hover:not(:disabled)": { backgroundColor: theme.palette.action.hover },
      "&:disabled": { color: theme.palette.text.disabled, cursor: "default" },
    },
  },
}));

function ActionButtons({
  runtime,
  sourceReady,
}: {
  runtime: SegmentationRuntime;
  sourceReady: boolean;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { store } = runtime;
  const state = useStore(store);
  const workflowOpen = useStore(segmentationSession, (session) => session.workflow.open);
  const [propagateAnchor, setPropagateAnchor] = useState<HTMLElement>();
  const [submitAnchor, setSubmitAnchor] = useState<HTMLElement>();
  const locked = ["running", "stopping"].includes(state.propagation.status);
  const frameReady =
    sourceReady && state.currentFrameId != undefined && state.isFrameReady(state.currentFrameId);
  const busy = !frameReady || state.loading;
  const staged = state.stagedOperations.length;
  const dirty = staged > 0;
  const closePropagate = () => {
    setPropagateAnchor(undefined);
  };
  const closeSubmit = () => {
    setSubmitAnchor(undefined);
  };
  const goWorkflow = (target?: string) => {
    openWorkflowPanel(target);
    closePropagate();
    closeSubmit();
  };
  return (
    <>
      <button
        type="button"
        title="撤销标注"
        aria-label="撤销标注"
        disabled={busy || !dirty || state.readonly}
        onClick={state.undo}
      >
        <ArrowUndo20Regular />
      </button>
      <button
        type="button"
        title="重做标注"
        aria-label="重做标注"
        disabled={busy || !state.canRedo || state.readonly}
        onClick={state.redo}
      >
        <ArrowRedo20Regular />
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={propagateAnchor != undefined}
        onClick={(event) => {
          setPropagateAnchor(event.currentTarget);
        }}
      >
        传播
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={submitAnchor != undefined}
        onClick={(event) => {
          setSubmitAnchor(event.currentTarget);
        }}
      >
        提交
        {dirty && (
          <span className={classes.badge} aria-label={`${staged} 项暂存`}>
            {staged}
          </span>
        )}
      </button>

      <Popover
        open={propagateAnchor != undefined}
        anchorEl={propagateAnchor}
        onClose={closePropagate}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { className: classes.paper } }}
      >
        <div className={classes.menu} role="dialog" aria-label="传播与任务">
          <button
            type="button"
            className={classes.item}
            onClick={() => {
              goWorkflow("seg-propagation");
            }}
          >
            传播实例…
          </button>
          <button
            type="button"
            className={classes.item}
            aria-pressed={workflowOpen}
            onClick={() => {
              segmentationSession.setState((session) => ({
                workflow: { open: !session.workflow.open, nonce: session.workflow.nonce + 1 },
              }));
              closePropagate();
            }}
          >
            {workflowOpen ? "收起工作流面板" : "展开工作流面板"}
          </button>
        </div>
      </Popover>

      <Popover
        open={submitAnchor != undefined}
        anchorEl={submitAnchor}
        onClose={closeSubmit}
        keepMounted
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { className: classes.paper } }}
      >
        <div className={cx(classes.menu, classes.submission)} role="dialog" aria-label="提交">
          <SubmissionControls store={store} disabled={busy} menu />
          <hr />
          <button
            type="button"
            className={classes.item}
            onClick={() => {
              goWorkflow("seg-revisions");
            }}
          >
            版本历史
          </button>
          <button
            type="button"
            className={cx(classes.item, classes.danger)}
            disabled={locked}
            onClick={() => {
              closeSubmit();
              segmentationSession.setState({
                open: false,
                imageUrl: undefined,
                sourceReady: false,
              });
            }}
          >
            结束标注
          </button>
        </div>
      </Popover>
    </>
  );
}

/**
 * Undo, redo, propagate and submit for the open record session.
 * A panel id limits the menu to that canvas. The app bar omits it and shows the one record session.
 */
export function SegmentationActionMenu({
  panelId,
}: {
  panelId?: string;
}): React.JSX.Element | undefined {
  const session = useStore(segmentationSession);
  const forThisCanvas = panelId == undefined || session.panelId === panelId;
  return session.open && session.runtime && forThisCanvas ? (
    <ActionButtons runtime={session.runtime} sourceReady={session.sourceReady} />
  ) : undefined;
}
