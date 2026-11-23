// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Alert, Button } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { SegmentationCanvas } from "./components/SegmentationCanvas";
import { WorkflowControls } from "./components/WorkflowControls";
import {
  segmentationSession,
  type SegmentationRuntime,
  type DecodedSegmentationFrame,
} from "./runtime";

import "./components/workbench.css";

const useStyles = makeStyles()({
  // The notices column ignores the pointer so the canvas stays usable around it.
  notice: { pointerEvents: "auto", maxWidth: 480 },
});

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
  const { classes } = useStyles();
  const { store } = runtime;
  const viewportRef = useRef<HTMLDivElement>(ReactNull);
  const rootRef = useRef<HTMLDivElement>(ReactNull);
  const state = useStore(store);
  // The submit menu in the app bar opens the queue side panel.
  const workflow = useStore(segmentationSession, (session) => session.workflow);
  const [initializationError, setInitializationError] = useState<string>();
  const locked = ["running", "stopping"].includes(state.propagation.status);
  const shownFrameId = frameId ?? state.currentFrameId;
  const frameReady = sourceReady && shownFrameId != undefined && state.isFrameReady(shownFrameId);
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
    (state.error !== state.frameWindowError?.message ? state.error : undefined) ??
    initializationError;
  useEffect(() => {
    void runtime.initialize().catch((error: unknown) => {
      setInitializationError(String(error));
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
      className={`seg-workbench seg-embedded${focused === true ? " seg-canvas-focused" : ""}`}
      data-testid="semantic-segmentation-workbench"
    >
      <div className="seg-notifications" data-testid="workbench-notices">
        {state.frameWindowError && active && (
          <Alert
            severity="error"
            variant="filled"
            className={classes.notice}
            action={
              <Button
                color="inherit"
                size="small"
                disabled={state.loading || locked}
                onClick={() => {
                  void state.retryCurrentFrameWindow().catch((error: unknown) => {
                    setInitializationError(String(error));
                  });
                }}
              >
                重试当前标注窗口
              </Button>
            }
          >
            当前标注窗口读取失败：{state.frameWindowError.message}
          </Alert>
        )}
        {generalError && active && (
          <Alert
            severity="error"
            variant="filled"
            className={classes.notice}
            onClose={() => {
              state.clearError();
              setInitializationError(undefined);
            }}
            slotProps={{ closeButton: { "aria-label": "关闭错误提示", title: "关闭错误提示" } }}
          >
            {generalError}
          </Alert>
        )}
        {!frameReady && slowLoad && (
          <div
            className="seg-loading"
            role="status"
            title="正在等待当前视频帧和标注数据，完成后可继续编辑。"
          >
            加载中…
          </div>
        )}
      </div>
      <fieldset className="seg-disabled" disabled={locked} {...(locked ? { inert: true } : {})}>
        <div className="seg-body">
          <main className="seg-editor">
            <div className="seg-canvas">
              <SegmentationCanvas
                store={store}
                viewportRef={viewportRef}
                imageUrl={imageUrl}
                decodedFrame={decodedFrame}
                disabled={locked || !frameReady || state.loading}
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
