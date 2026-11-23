// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { SemanticSegmentationStore } from "../types";
import { OperationList, OperationScope } from "./OperationScope";
import { WorkflowConfirmation } from "./WorkflowConfirmation";

const statusNames = {
  queued: "排队中",
  submitting: "提交中",
  succeeded: "已提交",
  failed: "失败",
};

export function SubmissionControls({
  store,
  disabled = false,
  menu = false,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  disabled?: boolean;
  /** Lay the controls out as a column inside the submit menu instead of a toolbar row. */
  menu?: boolean;
}): React.JSX.Element {
  const state = useStore(store);
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [showStaged, setShowStaged] = useState(false);
  useEffect(() => {
    setConfirmReset(false);
  }, [store, state.document?.record.id]);
  const dirty = state.stagedOperations.length > 0;
  const content = (
    <>
      <input
        aria-label="提交说明"
        placeholder="提交说明（可选）"
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
        disabled={disabled}
      />
      <details
        className="seg-queue-details"
        onToggle={(event) => {
          setShowStaged(event.currentTarget.open);
        }}
      >
        <summary aria-label="查看暂存操作">
          <span className="seg-queue-dot" aria-hidden="true" />
          待提交队列 {state.stagedOperations.length}
        </summary>
        <div className="seg-popover">
          <strong>待提交队列</strong>
          {dirty && showStaged ? (
            <ol>
              {state.stagedOperations.map((operation) => (
                <li key={operation.id}>
                  <OperationScope operation={operation} document={state.document} />
                </li>
              ))}
            </ol>
          ) : (
            <p>{dirty ? "展开后显示暂存修改范围" : "当前没有暂存修改"}</p>
          )}
          <p className="seg-muted">提交进入后台队列，期间可以继续编辑。</p>
        </div>
      </details>
      <button
        type="button"
        className={`seg-submit${dirty ? " seg-dirty" : " seg-primary"}`}
        disabled={disabled || !dirty}
        onClick={() => {
          state.submit(message || undefined);
          setMessage("");
        }}
      >
        {dirty ? `提交 ${state.stagedOperations.length}` : "提交"}
      </button>
      {!menu && (
        <>
          <button
            type="button"
            className="seg-undo"
            disabled={disabled || !dirty}
            onClick={state.undo}
          >
            撤销
          </button>
          <button
            type="button"
            className="seg-redo"
            disabled={disabled || !state.canRedo}
            onClick={state.redo}
          >
            重做
          </button>
        </>
      )}
      <button
        type="button"
        className="seg-clear"
        disabled={disabled || !dirty}
        onClick={() => {
          setConfirmReset(true);
        }}
      >
        清除暂存
      </button>
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
          <p>
            记录 {state.document?.record.id} · 清除当前 {state.stagedOperations.length}{" "}
            项未提交修改。
          </p>
          <p>保留提交队列。当前绘制和编辑状态会重置。</p>
        </WorkflowConfirmation>
      )}
    </>
  );
  return menu ? <div className="seg-menu-submission">{content}</div> : content;
}

export function WorkflowControls({
  store,
  hidden = false,
  onClose,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  hidden?: boolean;
  onClose?: () => void;
}): React.JSX.Element {
  const state = useStore(store);
  return (
    <aside className="seg-controls" hidden={hidden} aria-label="工作流管理">
      <section className="seg-section">
        <h2 id="seg-submissions">
          ⇧ 提交队列 <span className="seg-muted">{state.submissionQueue.length}</span>
          {onClose && (
            <button
              type="button"
              className="seg-controls-close"
              aria-label="关闭提交队列"
              onClick={onClose}
            >
              关闭
            </button>
          )}
        </h2>
        {state.submissionQueue.length === 0 && (
          <p className="seg-muted">提交后进入队列，编辑可以继续。</p>
        )}
        <div className="seg-list">
          {state.submissionQueue.map((batch) => (
            <div className="seg-card" key={batch.id}>
              <strong>{batch.message || "空间标注提交"}</strong>
              <p className="seg-muted">批次 {batch.id}</p>
              <OperationList operations={batch.operations} document={state.document} />
              <p>
                {statusNames[batch.status]} · {batch.operations.length} 项
              </p>
              {batch.error && <p role="alert">{batch.error}</p>}
              {batch.status === "failed" && (
                <button
                  type="button"
                  onClick={() => {
                    state.retrySubmission(batch.id);
                  }}
                >
                  重试提交
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
