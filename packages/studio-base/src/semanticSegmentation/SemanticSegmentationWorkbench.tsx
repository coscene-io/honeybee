// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { SegmentationCanvas } from "./components/SegmentationCanvas";
import { SpatialTree } from "./components/SpatialTree";
import { SubmissionControls, WorkflowControls } from "./components/WorkflowControls";
import {
  segmentationSession,
  type SegmentationRuntime,
  type DecodedSegmentationFrame,
} from "./runtime";
import type { FramePresenter } from "./types";

import "./components/workbench.css";

export type SemanticSegmentationWorkbenchProps = {
  runtime: SegmentationRuntime;
  imageUrl?: string;
  showTree?: boolean;
  demo?: boolean;
  embedded?: boolean;
  sourceReady?: boolean;
  onClose?: () => void;
  onFullscreen?: () => void | Promise<void>;
  onFrameChange?: (timestampSec: number) => void;
  onPresentFrame?: FramePresenter;
  decodedFrame?: DecodedSegmentationFrame;
  onFrameRendered?: (frame: DecodedSegmentationFrame) => void;
  onFrameRenderError?: (frame: DecodedSegmentationFrame) => void;
  momentEditor?: React.ReactNode;
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
  demo = false,
  embedded = false,
  sourceReady = true,
  onClose,
  onFullscreen,
  onFrameChange,
  onPresentFrame,
  decodedFrame,
  onFrameRendered,
  onFrameRenderError,
  momentEditor,
  frameId,
  focused,
  onClaimFocus,
}: SemanticSegmentationWorkbenchProps): React.JSX.Element {
  const { store } = runtime;
  const viewportRef = useRef<HTMLDivElement>(ReactNull);
  const rootRef = useRef<HTMLDivElement>(ReactNull);
  const state = useStore(store);
  // The in-panel workbench has no bars of its own; its panel header menu drives the side panel.
  const workflow = useStore(segmentationSession, (session) => session.workflow);
  const [playing, setPlaying] = useState(false);
  const [playDirection, setPlayDirection] = useState<1 | -1>(1);
  const [initializationError, setInitializationError] = useState<string>();
  const locked = ["running", "stopping"].includes(state.propagation.status);
  const shownFrameId = frameId ?? state.currentFrameId;
  const frameReady = sourceReady && shownFrameId != undefined && state.isFrameReady(shownFrameId);
  const generalError =
    (state.error !== state.frameWindowError?.message ? state.error : undefined) ??
    initializationError;
  const currentFrame = state.document?.frames.find((item) => item.id === state.currentFrameId);
  const frames =
    state.document?.frames.filter((item) => item.videoId === currentFrame?.videoId) ?? [];
  const frameIndex = Math.max(
    0,
    frames.findIndex((frame) => frame.id === state.currentFrameId),
  );
  const frame = frames[frameIndex];
  const video = state.document?.videos.find((item) => item.id === frame?.videoId);
  useEffect(() => {
    void runtime.initialize().catch((error: unknown) => {
      setInitializationError(String(error));
    });
  }, [runtime]);
  useEffect(() => {
    if (!embedded || !workflow.open || workflow.target == undefined) {
      return;
    }
    const target = workflow.target;
    const frameId = requestAnimationFrame(() => {
      rootRef.current?.querySelector(`#${target}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [embedded, workflow.open, workflow.target, workflow.nonce]);
  useEffect(
    () => () => {
      if (embedded) {
        segmentationSession.setState({ workflow: { open: false, nonce: 0 } });
      }
    },
    [embedded],
  );
  useEffect(() => {
    if (locked || state.readonly) {
      setPlaying(false);
    }
  }, [locked, state.readonly]);
  useEffect(() => {
    if (!playing || locked) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Wait as long as the recorded gap to the next frame; frame times are uneven.
    const scheduleNext = () => {
      const current = store.getState();
      const allFrames = current.document?.frames ?? [];
      const index = allFrames.findIndex((item) => item.id === current.currentFrameId);
      const here = allFrames[index];
      const next = allFrames[index + playDirection];
      if (!here || !next) {
        setPlaying(false);
        return;
      }
      const gapMs = Math.abs(next.timestampSec - here.timestampSec) * 1000;
      timer = setTimeout(() => {
        store.getState().setCurrentFrame(next.id);
        onFrameChange?.(next.timestampSec);
        scheduleNext();
      }, gapMs);
    };
    scheduleNext();
    return () => {
      if (timer != undefined) {
        clearTimeout(timer);
      }
    };
  }, [playing, locked, playDirection, store, onFrameChange]);
  // Seek once per streamed timestamp, even when source metadata recreates frame objects.
  const streamedTimestamp = frame?.timestampSec;
  useLayoutEffect(() => {
    if (focused === false || !onPresentFrame) {
      return;
    }
    return store.getState().registerFramePresenter(onPresentFrame);
  }, [focused, store, onPresentFrame]);
  useEffect(() => {
    if (!onPresentFrame && locked && streamedTimestamp != undefined) {
      onFrameChange?.(streamedTimestamp);
    }
  }, [locked, streamedTimestamp, onFrameChange, onPresentFrame]);
  const seekFrame = (index: number) => {
    const current = store.getState();
    if (
      !sourceReady ||
      current.loading ||
      !current.currentFrameId ||
      !current.isFrameReady(current.currentFrameId) ||
      ["running", "stopping"].includes(current.propagation.status)
    ) {
      return;
    }
    const selected = frames[index];
    if (selected) {
      state.setCurrentFrame(selected.id);
      onFrameChange?.(selected.timestampSec);
    }
  };
  return (
    <div
      ref={rootRef}
      className={`seg-workbench${embedded ? " seg-embedded" : ""}${focused === true ? " seg-canvas-focused" : ""}`}
      data-testid="semantic-segmentation-workbench"
    >
      <div className="seg-notifications" data-testid="workbench-notices">
        {/* Embedded canvases sit under the global lock; its top banner is the only STOP. */}
        {locked && !embedded && (
          <div className="seg-status seg-row" role="status">
            <strong>
              {state.propagation.status === "stopping"
                ? "正在停止传播，等待服务确认"
                : "在线传播中"}{" "}
              · {state.propagation.processedFrames} 帧
            </strong>
            {state.propagation.status === "stopping" && state.propagation.error && (
              <span role="alert">{state.propagation.error}</span>
            )}
            <span className="seg-spacer" />
            <button
              type="button"
              className="seg-stop"
              disabled={
                state.propagation.status === "stopping" &&
                state.propagation.cancellationPending !== false
              }
              onClick={state.stopPropagation}
            >
              {state.propagation.status === "stopping"
                ? state.propagation.cancellationPending === false
                  ? "重试停止"
                  : "正在停止…"
                : "STOP · 停止传播"}
            </button>
          </div>
        )}
        {state.readonly && (
          <div role="status" className="seg-status seg-readonly">
            历史版本 {state.viewingRevisionId} · 只读查看 · 返回当前编辑可继续暂存操作
          </div>
        )}
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
        {!embedded && (
          <header className="seg-header">
            <div className="seg-brand">co</div>
            <div>
              <h1>空间理解标注工作台</h1>
              <span className="seg-muted">
                {state.document?.record.name ?? "正在加载标注…"} / {video?.name ?? "视频流"}
              </span>
            </div>
            <span className="seg-spacer" />
            <span className="seg-badge">
              {demo ? "本地演示 · Mock 服务" : "本地标注 · Mock 服务"}
            </span>
            {onClose && (
              <button type="button" onClick={onClose}>
                返回画布
              </button>
            )}
          </header>
        )}
        {!embedded && (
          <div className="seg-toolbar seg-mgmt-bar" aria-label="功能管理栏">
            <strong className="seg-mgmt-title">
              空间 / {frame ? `帧 ${frame.index + 1}` : "载入中"}
            </strong>
            <button
              type="button"
              className="seg-mgmt-chip"
              onClick={(event) => {
                const root = event.currentTarget.closest(".seg-workbench");
                requestAnimationFrame(() => {
                  root
                    ?.querySelector("#seg-propagation")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              传播
            </button>
            <button
              type="button"
              className="seg-mgmt-chip"
              onClick={(event) => {
                const root = event.currentTarget.closest(".seg-workbench");
                requestAnimationFrame(() => {
                  root
                    ?.querySelector("#seg-revisions")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              版本历史
            </button>
            <span className="seg-spacer" />
            <SubmissionControls store={store} disabled={!frameReady || state.loading} />
          </div>
        )}
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
                disabled={locked || state.readonly || !frameReady || state.loading}
              />
              {momentEditor}
            </aside>
          )}
          <main className="seg-editor">
            <div className="seg-canvas">
              <SegmentationCanvas
                store={store}
                viewportRef={viewportRef}
                imageUrl={imageUrl}
                onFullscreen={onFullscreen}
                decodedFrame={decodedFrame}
                onFrameRendered={onFrameRendered}
                onFrameRenderError={onFrameRenderError}
                disabled={locked || !frameReady || state.loading}
                compact={embedded}
                frameId={frameId}
                onClaimFocus={onClaimFocus}
              />
            </div>
            {!embedded && (
              <div className="seg-timeline">
                <div className="seg-row">
                  <button
                    type="button"
                    aria-label="上一帧"
                    disabled={frameIndex === 0}
                    onClick={() => {
                      seekFrame(frameIndex - 1);
                    }}
                  >
                    Ⅰ◀
                  </button>
                  <button
                    type="button"
                    aria-label="向前播放"
                    onClick={() => {
                      setPlayDirection(-1);
                      setPlaying(!playing || playDirection !== -1);
                    }}
                  >
                    ◀ {playing && playDirection === -1 ? "暂停" : "向前播放"}
                  </button>
                  <button
                    type="button"
                    aria-label="向后播放"
                    onClick={() => {
                      setPlayDirection(1);
                      setPlaying(!playing || playDirection !== 1);
                    }}
                  >
                    {playing && playDirection === 1 ? "Ⅱ 暂停" : "▶ 向后播放"}
                  </button>
                  <button
                    type="button"
                    aria-label="下一帧"
                    disabled={frameIndex === frames.length - 1}
                    onClick={() => {
                      seekFrame(frameIndex + 1);
                    }}
                  >
                    ▶Ⅰ
                  </button>
                  <span className="seg-spacer" />
                  <span>
                    {(frame?.timestampSec ?? 0).toFixed(3)}s / {video?.durationSec ?? 0}s
                  </span>
                  <span className="seg-muted">
                    {frameIndex + 1} / {frames.length} 帧
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="视频帧时间轴"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  value={frameIndex}
                  onChange={(event) => {
                    setPlaying(false);
                    seekFrame(Number(event.target.value));
                  }}
                />
              </div>
            )}
          </main>
          <WorkflowControls
            store={store}
            sourceReady={frameReady && !state.loading}
            hidden={embedded && !workflow.open}
          />
        </div>
        {!embedded && (
          <footer className="seg-footer">
            <span>
              {state.stagedOperations.length > 0
                ? `${state.stagedOperations.length} 项本地暂存 · 尚未提交`
                : "没有未提交修改"}
            </span>
            <span>{state.loading ? "同步中…" : frameReady ? "就绪" : "标注窗口未就绪"}</span>
          </footer>
        )}
      </fieldset>
    </div>
  );
}
