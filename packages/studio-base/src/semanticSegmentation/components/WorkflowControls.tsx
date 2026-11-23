// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Alert,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { SemanticSegmentationStore, SubmissionBatch } from "../types";
import { OperationList, OperationScope } from "./OperationScope";
import { WorkflowConfirmation } from "./WorkflowConfirmation";

const statusNames: Record<SubmissionBatch["status"], string> = {
  queued: "排队中",
  submitting: "提交中",
  succeeded: "已提交",
  failed: "失败",
};

const statusColors: Record<SubmissionBatch["status"], "default" | "info" | "success" | "error"> = {
  queued: "default",
  submitting: "info",
  succeeded: "success",
  failed: "error",
};

const useStyles = makeStyles()((theme) => ({
  submission: { display: "flex", flexDirection: "column", gap: theme.spacing(1) },
  row: { display: "flex", gap: theme.spacing(1), alignItems: "center", flexWrap: "wrap" },
  stagedToggle: { justifyContent: "space-between", textTransform: "none" },
  dot: {
    width: 8,
    height: 8,
    marginRight: theme.spacing(1),
    borderRadius: "50%",
    backgroundColor: theme.palette.success.main,
  },
  staged: {
    maxHeight: 200,
    overflowY: "auto",
    padding: theme.spacing(1, 1.5),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    "& ol": { margin: theme.spacing(0.5, 0), paddingLeft: theme.spacing(2.5) },
  },
  clear: { alignSelf: "flex-start" },
  panel: {
    position: "absolute",
    inset: "0 0 0 auto",
    zIndex: 12,
    width: "min(340px, 100%)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1, 1, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  panelTitle: { flex: 1 },
  panelBody: {
    flex: 1,
    overflowY: "auto",
    padding: theme.spacing(1.5),
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
  },
  batch: { padding: theme.spacing(1.25, 1.5) },
  batchHeader: { display: "flex", alignItems: "center", gap: theme.spacing(1) },
}));

/** Submit message, submit, the staged list and clearing staged work. */
export function SubmissionControls({
  store,
  disabled = false,
  menu = false,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  disabled?: boolean;
  /** Inside the app-bar submit menu, where undo and redo are app-bar buttons already. */
  menu?: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const state = useStore(store);
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [showStaged, setShowStaged] = useState(false);
  useEffect(() => {
    setConfirmReset(false);
  }, [store, state.document?.record.id]);
  const staged = state.stagedOperations.length;
  const dirty = staged > 0;
  return (
    <div className={classes.submission}>
      <TextField
        size="small"
        variant="filled"
        fullWidth
        placeholder="提交说明（可选）"
        value={message}
        disabled={disabled}
        slotProps={{ htmlInput: { "aria-label": "提交说明" } }}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
      />
      <Button
        variant="contained"
        color={dirty ? "warning" : "primary"}
        disableElevation
        fullWidth
        disabled={disabled || !dirty}
        onClick={() => {
          state.submit(message || undefined);
          setMessage("");
        }}
      >
        {dirty ? `提交 ${staged}` : "提交"}
      </Button>
      <Button
        className={classes.stagedToggle}
        color="inherit"
        size="small"
        fullWidth
        aria-label="查看暂存操作"
        aria-expanded={showStaged}
        endIcon={showStaged ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => {
          setShowStaged((value) => !value);
        }}
      >
        <span>
          <span className={classes.dot} aria-hidden="true" />
          待提交队列 {staged}
        </span>
      </Button>
      {/* Mounted only while open: large snapshots stay out of the render path. */}
      <Collapse in={showStaged} unmountOnExit>
        <div className={classes.staged}>
          {dirty ? (
            <ol>
              {state.stagedOperations.map((operation) => (
                <li key={operation.id}>
                  <OperationScope operation={operation} document={state.document} />
                </li>
              ))}
            </ol>
          ) : (
            <Typography variant="body2">当前没有暂存修改</Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            提交进入后台队列，期间可以继续编辑。
          </Typography>
        </div>
      </Collapse>
      <div className={classes.row}>
        {!menu && (
          <>
            <Button size="small" disabled={disabled || !dirty} onClick={state.undo}>
              撤销
            </Button>
            <Button size="small" disabled={disabled || !state.canRedo} onClick={state.redo}>
              重做
            </Button>
          </>
        )}
        <Button
          className={classes.clear}
          size="small"
          color="error"
          disabled={disabled || !dirty}
          onClick={() => {
            setConfirmReset(true);
          }}
        >
          清除暂存
        </Button>
      </div>
      {confirmReset && (
        <WorkflowConfirmation
          title="确认清除暂存"
          confirmLabel="仅清除未提交修改"
          disabled={disabled}
          onCancel={() => {
            setConfirmReset(false);
          }}
          onConfirm={() => {
            setConfirmReset(false);
            store.getState().revertStaging();
          }}
        >
          <Typography variant="body2" gutterBottom>
            清除当前 {staged} 项未提交修改。
          </Typography>
          <Typography variant="body2" color="text.secondary">
            保留提交队列。当前绘制和编辑状态会重置。
          </Typography>
        </WorkflowConfirmation>
      )}
    </div>
  );
}

/** The submission queue, a side panel over the canvas holding the edit. */
export function WorkflowControls({
  store,
  hidden = false,
  onClose,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  hidden?: boolean;
  onClose?: () => void;
}): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const state = useStore(store);
  if (hidden) {
    return undefined;
  }
  return (
    <Paper square elevation={8} className={classes.panel} component="aside" aria-label="工作流管理">
      <div className={classes.panelHeader}>
        <Typography
          variant="subtitle2"
          component="h2"
          id="seg-submissions"
          className={classes.panelTitle}
        >
          提交队列 · {state.submissionQueue.length}
        </Typography>
        {onClose && (
          <IconButton size="small" aria-label="关闭提交队列" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </div>
      <div className={classes.panelBody}>
        {state.submissionQueue.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            提交后进入队列，编辑可以继续。
          </Typography>
        )}
        {state.submissionQueue.map((batch) => (
          <Paper variant="outlined" className={classes.batch} key={batch.id}>
            <div className={classes.batchHeader}>
              <Typography variant="body2" noWrap className={classes.panelTitle}>
                {batch.message || "空间标注提交"}
              </Typography>
              <Chip
                size="small"
                color={statusColors[batch.status]}
                label={statusNames[batch.status]}
              />
            </div>
            <Typography variant="caption" color="text.secondary" component="p">
              {batch.operations.length} 项 · 批次 {batch.id}
            </Typography>
            <OperationList operations={batch.operations} document={state.document} />
            {batch.error && (
              <Alert
                severity="error"
                action={
                  batch.status === "failed" ? (
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        state.retrySubmission(batch.id);
                      }}
                    >
                      重试提交
                    </Button>
                  ) : undefined
                }
              >
                {batch.error}
              </Alert>
            )}
            {!batch.error && batch.status === "failed" && (
              <Button
                size="small"
                onClick={() => {
                  state.retrySubmission(batch.id);
                }}
              >
                重试提交
              </Button>
            )}
          </Paper>
        ))}
      </div>
    </Paper>
  );
}
