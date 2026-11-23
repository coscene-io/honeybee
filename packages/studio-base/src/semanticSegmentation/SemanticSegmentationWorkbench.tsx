// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Alert, Button, alpha } from "@mui/material";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { SegmentationCanvas } from "./components/SegmentationCanvas";
import { WorkflowControls } from "./components/WorkflowControls";
import { segmentationErrorText } from "./errors";
import type { LiveSemanticSegmentationService } from "./liveService";
import {
  segmentationSession,
  type SegmentationRuntime,
  type DecodedSegmentationFrame,
} from "./runtime";

const useStyles = makeStyles()((theme) => ({
  // An overlay on the Image panel: the panel owns the pixels, so nothing here is opaque.
  root: {
    position: "relative",
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    color: theme.palette.text.primary,
  },
  focused: { boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}` },
  // The notices column ignores the pointer so the canvas stays usable around it.
  notices: {
    position: "absolute",
    inset: theme.spacing("auto", 1, 4.5),
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: theme.spacing(1),
    maxHeight: `calc(100% - ${theme.spacing(8)})`,
    overflowY: "auto",
    pointerEvents: "none",
  },
  notice: { pointerEvents: "auto", maxWidth: 480 },
  // A quiet marker instead of a banner: the frame or its annotations are still loading.
  loading: {
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.common.black, 0.67),
    color: theme.palette.common.white,
    fontSize: theme.typography.caption.fontSize,
    pointerEvents: "none",
  },
  lockable: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    border: 0,
    margin: 0,
    padding: 0,
  },
  body: { position: "relative", flex: 1, display: "flex", minHeight: 0 },
  editor: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  canvas: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    "& > *": { flex: 1 },
  },
}));

/** One Image panel's canvas over the shared session. Playback, STOP and submit live outside. */
export type SemanticSegmentationWorkbenchProps = {
  runtime: SegmentationRuntime;
  imageUrl?: string;
  sourceReady?: boolean;
  decodedFrame?: DecodedSegmentationFrame;
  /** Frame drawn by this canvas. Other open canvases keep their own frames. */
  frameId?: string;
  /** False when another canvas holds the edit. Omitted means this is the only canvas. */
  focused?: boolean;
  onClaimFocus?: () => void;
};

export function SemanticSegmentationWorkbench({
  runtime,
  imageUrl,
  sourceReady = true,
  decodedFrame,
  frameId,
  focused,
  onClaimFocus,
}: SemanticSegmentationWorkbenchProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("segmentation");
  const { store } = runtime;
  const viewportRef = useRef<HTMLDivElement>(ReactNull);
  const rootRef = useRef<HTMLDivElement>(ReactNull);
  const propagationStatus = useStore(store, (state) => state.propagation.status);
  const currentFrameId = useStore(store, (state) => state.currentFrameId);
  const loading = useStore(store, (state) => state.loading);
  const storeError = useStore(store, (state) => state.error);
  const frameWindowError = useStore(store, (state) => state.frameWindowError);
  // The submit menu in the app bar opens the queue side panel.
  const workflow = useStore(segmentationSession, (session) => session.workflow);
  const [initializationError, setInitializationError] = useState<string>();
  // A camera whose timeline failed shows no presence on frames that are not loaded yet; say so.
  const timeline = runtime.service as Partial<LiveSemanticSegmentationService>;
  const subscribeTimeline = useCallback(
    (onChange: () => void) =>
      timeline.subscribeTimeline?.(onChange) ??
      (() => {
        // No timeline: nothing to unsubscribe.
      }),
    [timeline],
  );
  const timelineWarning = useSyncExternalStore(subscribeTimeline, () =>
    timeline.timelineWarning?.(),
  );
  const [dismissedTimelineWarning, setDismissedTimelineWarning] = useState<string>();
  const locked = ["running", "stopping"].includes(propagationStatus);
  const shownFrameId = frameId ?? currentFrameId;
  const frameReady = useStore(
    store,
    (state) => sourceReady && shownFrameId != undefined && state.isFrameReady(shownFrameId),
  );
  // Only the canvas holding the edit reports errors; the others share the same store.
  const active = focused !== false;
  // A short wait (a frame step, playback, a streamed propagation frame) shows nothing; only a
  // load that lasts gets a small marker.
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (frameReady) {
      setSlowLoad(false);
      return;
    }
    const timer = setTimeout(() => {
      setSlowLoad(true);
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [frameReady, shownFrameId]);
  const generalError =
    (storeError !== frameWindowError?.message ? storeError : undefined) ?? initializationError;
  useEffect(() => {
    void runtime.initialize().catch((error: unknown) => {
      setInitializationError(segmentationErrorText(error));
    });
  }, [runtime]);
  useEffect(() => {
    if (!workflow.open || workflow.target == undefined) {
      return;
    }
    const target = workflow.target;
    const handle = requestAnimationFrame(() => {
      rootRef.current?.querySelector(`#${target}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [workflow.open, workflow.target, workflow.nonce]);
  useEffect(
    () => () => {
      segmentationSession.setState({ workflow: { open: false, nonce: 0 } });
    },
    [],
  );
  return (
    <div
      ref={rootRef}
      className={cx(classes.root, { [classes.focused]: focused === true })}
      data-canvas-focused={focused === true}
      data-testid="semantic-segmentation-workbench"
    >
      <div className={classes.notices} data-testid="workbench-notices">
        {frameWindowError && active && (
          <Alert
            severity="error"
            variant="filled"
            className={classes.notice}
            action={
              <Button
                color="inherit"
                size="small"
                disabled={loading || locked}
                onClick={() => {
                  void store
                    .getState()
                    .retryCurrentFrameWindow()
                    .catch((error: unknown) => {
                      setInitializationError(segmentationErrorText(error));
                    });
                }}
              >
                {t("retryFrameWindow")}
              </Button>
            }
          >
            {t("frameWindowFailed", { error: frameWindowError.message })}
          </Alert>
        )}
        {timelineWarning != undefined && timelineWarning !== dismissedTimelineWarning && active && (
          <Alert
            severity="warning"
            variant="filled"
            className={classes.notice}
            data-testid="timeline-warning"
            onClose={() => {
              setDismissedTimelineWarning(timelineWarning);
            }}
            slotProps={{ closeButton: { "aria-label": t("closeNotice"), title: t("closeNotice") } }}
          >
            {t("timelineWarning", { error: timelineWarning })}
          </Alert>
        )}
        {generalError && active && (
          <Alert
            severity="error"
            variant="filled"
            className={classes.notice}
            onClose={() => {
              store.getState().clearError();
              setInitializationError(undefined);
            }}
            slotProps={{ closeButton: { "aria-label": t("closeError"), title: t("closeError") } }}
          >
            {generalError}
          </Alert>
        )}
        {!frameReady && slowLoad && (
          <div className={classes.loading} role="status" title={t("waitingForFrame")}>
            {t("loading")}
          </div>
        )}
      </div>
      <fieldset className={classes.lockable} disabled={locked} {...(locked ? { inert: true } : {})}>
        <div className={classes.body}>
          <main className={classes.editor}>
            <div className={classes.canvas}>
              <SegmentationCanvas
                store={store}
                viewportRef={viewportRef}
                imageUrl={imageUrl}
                decodedFrame={decodedFrame}
                disabled={locked || !frameReady || loading}
                frameId={frameId}
                onClaimFocus={onClaimFocus}
                active={active}
              />
            </div>
          </main>
          <WorkflowControls
            store={store}
            // One queue for the session: only the canvas holding the edit shows it.
            hidden={!workflow.open || !active}
            onClose={() => {
              segmentationSession.setState((session) => ({
                workflow: { ...session.workflow, open: false },
              }));
            }}
          />
        </div>
      </fieldset>
    </div>
  );
}
