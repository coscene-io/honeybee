// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { SemanticSegmentationStore } from "../types";
import { OperationList, OperationScope } from "./OperationScope";
import { PropagationForm } from "./PropagationForm";
import { WorkflowConfirmation } from "./WorkflowConfirmation";
import { buildCanvasPropagationScope } from "./propagationSeeds";

const statusNames = {
  preparing: "准备中",
  queued: "排队中",
  running: "处理中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
  submitting: "提交中",
  succeeded: "已提交",
  conflict: "冲突 · 此批修改已丢弃",
};

export function SubmissionControls({
  store,
  disabled = false,
  menu = false,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  disabled?: boolean;
  /** Lay the controls out as a column inside the panel header menu instead of a toolbar row. */
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
  const preparing = state.submissionQueue.find((batch) => batch.status === "preparing");
  const content = (
    <>
      <input
        aria-label="提交说明"
        placeholder="提交说明（可选）"
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
        disabled={disabled || state.readonly}
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
        disabled={disabled || !dirty || state.readonly || preparing != undefined}
        onClick={() => {
          state.submit(message || undefined);
          setMessage("");
        }}
      >
        {preparing
          ? `准备提交中 · ${Math.round((preparing.preparationProgress ?? 0) * 100)}%`
          : dirty
            ? `提交 ${state.stagedOperations.length}`
            : "提交"}
      </button>
      {!menu && (
        <>
          <button
            type="button"
            className="seg-undo"
            disabled={disabled || !dirty || state.readonly}
            onClick={state.undo}
          >
            撤销
          </button>
          <button
            type="button"
            className="seg-redo"
            disabled={disabled || !state.canRedo || state.readonly}
            onClick={state.redo}
          >
            重做
          </button>
        </>
      )}
      <button
        type="button"
        className="seg-clear"
        disabled={disabled || !dirty || state.readonly}
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
          disabled={disabled || state.readonly}
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
          <p>保留已提交版本和提交队列；不会创建新版本。当前绘制和编辑状态会重置。</p>
        </WorkflowConfirmation>
      )}
    </>
  );
  return menu ? <div className="seg-menu-submission">{content}</div> : content;
}

export function WorkflowControls({
  store,
  sourceReady = true,
  hidden = false,
  showPropagation = true,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  sourceReady?: boolean;
  hidden?: boolean;
  showPropagation?: boolean;
}): React.JSX.Element {
  const state = useStore(store);
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: string; headId?: string }>();
  const [historyTarget, setHistoryTarget] = useState<string>();
  useEffect(() => {
    setRollbackTarget(undefined);
    setHistoryTarget(undefined);
    setLocalError(undefined);
  }, [store, state.document?.record.id, state.interactionResetVersion]);
  const document = state.document;
  const pendingWork =
    state.stagedOperations.length > 0 ||
    state.submissionQueue.some((batch) =>
      ["preparing", "queued", "submitting", "failed"].includes(batch.status),
    );
  const invoke = (action: () => Promise<void>) => {
    setLocalError(undefined);
    setBusy(true);
    void action()
      .catch((error: unknown) => {
        setLocalError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <aside className="seg-controls" hidden={hidden} aria-label="工作流管理">
      {localError && (
        <div role="alert" className="seg-status seg-error">
          {localError}
        </div>
      )}
      {showPropagation && (
        <PropagationForm
          store={store}
          scope={buildCanvasPropagationScope(document, state.currentFrameId)}
          sourceReady={sourceReady}
        />
      )}
      <section className="seg-section">
        <h2 id="seg-submissions">
          ⇧ 提交队列 <span className="seg-muted">{state.submissionQueue.length}</span>
        </h2>
        {state.submissionQueue.length === 0 && (
          <p className="seg-muted">提交后进入队列，编辑可以继续。</p>
        )}
        <div className="seg-list">
          {state.submissionQueue.map((batch) => (
            <div className="seg-card" key={batch.id}>
              <strong>{batch.message || "空间标注提交"}</strong>
              <p className="seg-muted">
                批次 {batch.id} ·{" "}
                {batch.revisionId ? `已提交版本 ${batch.revisionId}` : "版本待确认"}
              </p>
              <OperationList operations={batch.operations} document={state.document} />
              {batch.status === "preparing" && (
                <progress
                  aria-label={`${batch.id} 提交准备进度`}
                  value={batch.preparationProgress ?? 0}
                  max={1}
                />
              )}
              <p>
                {statusNames[batch.status]} · {batch.operations.length} 项
              </p>
              {batch.error && <p role="alert">{batch.error}</p>}
              {batch.conflicts && batch.conflicts.length > 0 && (
                <p role="alert">
                  同帧实例冲突：{batch.conflicts.join(", ")}。仅丢弃冲突批次，保留后续编辑。
                </p>
              )}
              {batch.status === "failed" && (
                <button
                  type="button"
                  disabled={state.readonly}
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
      <section className="seg-section">
        <h2 id="seg-revisions">◷ 版本历史</h2>
        {pendingWork && <p className="seg-muted">回退前请先提交或清除暂存，并等待提交队列完成。</p>}
        {state.viewingRevisionId && (
          <button
            type="button"
            onClick={() => {
              invoke(async () => {
                await state.viewRevision();
              });
            }}
          >
            返回当前编辑
          </button>
        )}
        <div className="seg-list">
          {state.revisions.map((revision) => (
            <div className="seg-card" key={revision.id}>
              <strong>{revision.message}</strong>
              <p className="seg-muted">
                {revision.id} · 作者 {revision.author ?? "未知（旧版本未记录）"} ·{" "}
                {new Date(revision.createdAt).toLocaleString()}
              </p>
              <div className="seg-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (pendingWork) {
                      setHistoryTarget(revision.id);
                    } else {
                      invoke(async () => {
                        await state.viewRevision(revision.id);
                      });
                    }
                  }}
                >
                  只读查看
                </button>
                <button
                  type="button"
                  disabled={busy || pendingWork}
                  title={pendingWork ? "请先提交或清除暂存，并等待提交队列完成" : undefined}
                  onClick={() => {
                    setRollbackTarget({ id: revision.id, headId: state.revisions[0]?.id });
                  }}
                >
                  回退到此版本
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {historyTarget && (
        <div className="seg-modal-backdrop">
          <div
            className="seg-modal"
            role="dialog"
            aria-modal="true"
            aria-label="保留草稿并查看历史"
          >
            <h2>保留当前草稿并只读查看？</h2>
            <p>暂存修改和提交队列会保留。返回当前编辑后可继续编辑；历史版本只读。</p>
            <div className="seg-row">
              <button
                type="button"
                onClick={() => {
                  const id = historyTarget;
                  setHistoryTarget(undefined);
                  invoke(async () => {
                    await store.getState().viewRevision(id);
                  });
                }}
              >
                保留草稿并查看
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryTarget(undefined);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {rollbackTarget && (
        <div className="seg-modal-backdrop">
          <div className="seg-modal" role="dialog" aria-modal="true" aria-label="确认版本回退">
            <h2>回退到 {rollbackTarget.id}？</h2>
            <p>将恢复此版本的已提交标注，并追加一条回退记录。</p>
            <div className="seg-row">
              <button
                type="button"
                onClick={() => {
                  const { id, headId } = rollbackTarget;
                  setRollbackTarget(undefined);
                  invoke(async () => {
                    await state.rollbackRevision(id, headId);
                  });
                }}
              >
                确认回退
              </button>
              <button
                type="button"
                onClick={() => {
                  setRollbackTarget(undefined);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
