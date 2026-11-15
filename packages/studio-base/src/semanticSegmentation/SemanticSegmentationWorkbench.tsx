// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { SegmentationCanvas } from "./components/SegmentationCanvas";
import { SpatialTree } from "./components/SpatialTree";
import { WorkflowControls } from "./components/WorkflowControls";
import {
  segmentationSession,
  type SegmentationRuntime,
  type DecodedSegmentationFrame,
} from "./runtime";

import "./components/workbench.css";

/** One Image panel's canvas over the shared session. Playback, STOP and submit live outside. */
export type SemanticSegmentationWorkbenchProps = {
  runtime: SegmentationRuntime;
  imageUrl?: string;
  /** Tree inside the canvas. The app shows it in the Space sidebar instead. */
  showTree?: boolean;
  sourceReady?: boolean;
  onClose?: () => void;
  decodedFrame?: DecodedSegmentationFrame;
  onFrameRendered?: (frame: DecodedSegmentationFrame) => void;
  onFrameRenderError?: (frame: DecodedSegmentationFrame) => void;
  /** Frame drawn by this canvas. Other open canvases keep their own frames. */
  frameId?: string;
  /** False when another canvas holds the edit. Omitted means this is the only canvas. */
  focused?: boolean;
  onClaimFocus?: () => void;
};

export function SemanticSegmentationWorkbench({
  runtime,
  imageUrl,
  showTree = true,
  sourceReady = true,
  decodedFrame,
  onFrameRendered,
  onFrameRenderError,
  frameId,
  focused,
  onClaimFocus,
}: SemanticSegmentationWorkbenchProps): React.JSX.Element {
  const { store } = runtime;
  const viewportRef = useRef<HTMLDivElement>(ReactNull);
  const rootRef = useRef<HTMLDivElement>(ReactNull);
  const state = useStore(store);
  // The workbench has no bars of its own; its panel header menu drives the side panel.
  const workflow = useStore(segmentationSession, (session) => session.workflow);
  const [initializationError, setInitializationError] = useState<string>();
  const locked = ["running", "stopping"].includes(state.propagation.status);
  const shownFrameId = frameId ?? state.currentFrameId;
  const frameReady = sourceReady && shownFrameId != undefined && state.isFrameReady(shownFrameId);
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
        {state.frameWindowError && (
          <div role="alert" className="seg-status seg-error seg-row">
            当前标注窗口读取失败：{state.frameWindowError.message}
            <button
              type="button"
              disabled={state.loading || locked}
              onClick={() => {
                void state.retryCurrentFrameWindow().catch((error: unknown) => {
                  setInitializationError(String(error));
                });
              }}
            >
              重试当前标注窗口
            </button>
          </div>
        )}
        {generalError && (
          <div role="alert" className="seg-status seg-error seg-row">
            {generalError}
            <button
              type="button"
              onClick={() => {
                state.clearError();
                setInitializationError(undefined);
              }}
            >
              关闭错误提示
            </button>
          </div>
        )}
        {!frameReady && (
          <div className="seg-status" role="status">
            正在等待当前视频帧和标注数据，完成后可继续编辑。
          </div>
        )}
      </div>
      <fieldset className="seg-disabled" disabled={locked} {...(locked ? { inert: "" } : {})}>
        <div
          className="seg-body"
          style={showTree ? undefined : { gridTemplateColumns: "minmax(320px, 1fr) 320px" }}
        >
          {showTree && (
            <aside className="seg-tree">
              <div className="seg-tree-header">
                实例 <span className="seg-muted">CLASS / INSTANCE / POLYGON</span>
              </div>
              <SpatialTree
                store={store}
                onPointerActivate={() => {
                  viewportRef.current?.focus({ preventScroll: true });
                }}
                disabled={locked || !frameReady || state.loading}
              />
            </aside>
          )}
          <main className="seg-editor">
            <div className="seg-canvas">
              <SegmentationCanvas
                store={store}
                viewportRef={viewportRef}
                imageUrl={imageUrl}
                decodedFrame={decodedFrame}
                onFrameRendered={onFrameRendered}
                onFrameRenderError={onFrameRenderError}
                disabled={locked || !frameReady || state.loading}
                compact
                frameId={frameId}
                onClaimFocus={onClaimFocus}
              />
            </div>
          </main>
          <WorkflowControls store={store} hidden={!workflow.open} />
        </div>
      </fieldset>
    </div>
  );
}
