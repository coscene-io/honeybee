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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";

import type { SegmentationStore, SubmissionBatch } from "../types";
import { OperationList, OperationScope } from "./OperationScope";

const statusKeys = {
  queued: "batchQueued",
  submitting: "batchSubmitting",
  succeeded: "batchSucceeded",
  failed: "batchFailed",
} as const satisfies Record<SubmissionBatch["status"], string>;

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
  // Long server messages wrap instead of scrolling sideways.
  batchErrorMessage: { flex: 1, minWidth: 0, overflow: "visible", overflowWrap: "anywhere" },
}));

/** Submit message, submit, the staged list and clearing staged work. */
export function SubmissionControls({
  store,
  disabled = false,
  menu = false,
}: {
  store: StoreApi<SegmentationStore>;
  disabled?: boolean;
  /** Inside the app-bar submit menu, where undo and redo are app-bar buttons already. */
  menu?: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const document = useStore(store, (state) => state.document);
  const stagedOperations = useStore(store, (state) => state.stagedOperations);
  const canRedo = useStore(store, (state) => state.canRedo);
  const [message, setMessage] = useState("");
  const confirm = useConfirm();
  const [showStaged, setShowStaged] = useState(false);
  const staged = stagedOperations.length;
  const dirty = staged > 0;
  const clearStaged = async () => {
    const recordId = store.getState().document?.record.id;
    const answer = await confirm({
      title: t("confirmClearStaged"),
      prompt: (
        <>
          <Typography variant="body2" gutterBottom>
            {t("clearStagedCount", { count: staged })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("clearStagedHint")}
          </Typography>
        </>
      ),
      ok: t("clearUnsubmittedOnly"),
      cancel: t("cancel"),
      variant: "danger",
    });
    // The dialog is outside the editor: the record or the lock may have changed meanwhile.
    const state = store.getState();
    const status = state.propagation.status;
    if (
      answer === "ok" &&
      state.document?.record.id === recordId &&
      status !== "running" &&
      status !== "stopping"
    ) {
      state.revertStaging();
    }
  };
  return (
    <div className={classes.submission}>
      <TextField
        size="small"
        variant="filled"
        fullWidth
        placeholder={t("submitMessagePlaceholder")}
        value={message}
        disabled={disabled}
        slotProps={{ htmlInput: { "aria-label": t("submitMessage") } }}
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
          store.getState().submit(message || undefined);
          setMessage("");
        }}
      >
        {dirty ? t("submitCount", { count: staged }) : t("submit")}
      </Button>
      <Button
        className={classes.stagedToggle}
        color="inherit"
        size="small"
        fullWidth
        aria-label={t("showStaged")}
        aria-expanded={showStaged}
        endIcon={showStaged ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => {
          setShowStaged((value) => !value);
        }}
      >
        <span>
          <span className={classes.dot} aria-hidden="true" />
          {t("stagedQueue", { count: staged })}
        </span>
      </Button>
      {/* Mounted only while open: large snapshots stay out of the render path. */}
      <Collapse in={showStaged} unmountOnExit>
        <div className={classes.staged}>
          {dirty ? (
            <ol>
              {stagedOperations.map((operation) => (
                <li key={operation.id}>
                  <OperationScope operation={operation} document={document} />
                </li>
              ))}
            </ol>
          ) : (
            <Typography variant="body2">{t("noStagedChanges")}</Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t("submitInBackground")}
          </Typography>
        </div>
      </Collapse>
      <div className={classes.row}>
        {!menu && (
          <>
            <Button
              size="small"
              disabled={disabled || !dirty}
              onClick={() => {
                store.getState().undo();
              }}
            >
              {t("undo")}
            </Button>
            <Button
              size="small"
              disabled={disabled || !canRedo}
              onClick={() => {
                store.getState().redo();
              }}
            >
              {t("redo")}
            </Button>
          </>
        )}
        <Button
          className={classes.clear}
          size="small"
          color="error"
          disabled={disabled || !dirty}
          onClick={() => {
            void clearStaged();
          }}
        >
          {t("clearStaged")}
        </Button>
      </div>
    </div>
  );
}

/** The submission queue, a side panel over the canvas holding the edit. */
export function WorkflowControls({
  store,
  hidden = false,
  onClose,
}: {
  store: StoreApi<SegmentationStore>;
  hidden?: boolean;
  onClose?: () => void;
}): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const document = useStore(store, (state) => state.document);
  const submissionQueue = useStore(store, (state) => state.submissionQueue);
  if (hidden) {
    return undefined;
  }
  return (
    <Paper
      square
      elevation={8}
      className={classes.panel}
      component="aside"
      aria-label={t("workflowPanel")}
    >
      <div className={classes.panelHeader}>
        <Typography
          variant="subtitle2"
          component="h2"
          id="seg-submissions"
          className={classes.panelTitle}
        >
          {t("submissionQueueCount", { count: submissionQueue.length })}
        </Typography>
        {onClose && (
          <IconButton size="small" aria-label={t("closeSubmissionQueue")} onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </div>
      <div className={classes.panelBody}>
        {submissionQueue.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("queueEmpty")}
          </Typography>
        )}
        {submissionQueue.map((batch) => (
          <Paper variant="outlined" className={classes.batch} key={batch.id}>
            <div className={classes.batchHeader}>
              <Typography variant="body2" noWrap className={classes.panelTitle}>
                {batch.message || t("defaultBatchMessage")}
              </Typography>
              <Chip
                size="small"
                color={statusColors[batch.status]}
                label={t(statusKeys[batch.status])}
              />
            </div>
            {/* The batch (request) ID is for support; it stays on hover only. */}
            <Typography variant="caption" color="text.secondary" component="p" title={batch.id}>
              {t("batchOperations", { count: batch.operations.length })}
            </Typography>
            <OperationList operations={batch.operations} document={document} />
            {batch.error && (
              // Actions go under the message: server errors can be long (a URL, a rule) and the
              // alert's action slot would squeeze them into a narrow column.
              <Alert severity="error" classes={{ message: classes.batchErrorMessage }}>
                {batch.error}
                {batch.status === "failed" && (
                  <FailedBatchActions store={store} batchId={batch.id} color="inherit" />
                )}
              </Alert>
            )}
            {!batch.error && batch.status === "failed" && (
              <FailedBatchActions store={store} batchId={batch.id} />
            )}
          </Paper>
        ))}
      </div>
    </Paper>
  );
}

/**
 * A failed batch holds the queue. Retry sends it again; Discard drops its changes and returns the
 * batches held behind it to staging (`discardSubmission`).
 */
function FailedBatchActions({
  store,
  batchId,
  color,
}: {
  store: StoreApi<SegmentationStore>;
  batchId: string;
  color?: "inherit";
}): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  return (
    <Stack direction="row" spacing={0.5}>
      <Button
        color={color}
        size="small"
        onClick={() => {
          store.getState().retrySubmission(batchId);
        }}
      >
        {t("retrySubmit")}
      </Button>
      <Button
        color={color}
        size="small"
        title={t("discardSubmitHint")}
        onClick={() => {
          store.getState().discardSubmission(batchId);
        }}
      >
        {t("discardSubmit")}
      </Button>
    </Stack>
  );
}
