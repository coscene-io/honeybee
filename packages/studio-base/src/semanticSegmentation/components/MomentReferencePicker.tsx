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

import type { SegmentationDocument, SemanticSegmentationStore } from "../types";

import "./workbench.css";

export type SpatialReference = {
  recordId: string;
  videoId?: string;
  targetType: "class" | "instance";
  targetId: string;
};

export function encodeSpatialReference(
  recordId: string,
  targetType: "class" | "instance",
  targetId: string,
  videoId?: string,
): string {
  const scope = videoId
    ? `${encodeURIComponent(recordId)}/${encodeURIComponent(videoId)}`
    : encodeURIComponent(recordId);
  return `spatial://${scope}/${targetType}/${encodeURIComponent(targetId)}`;
}

export function parseSpatialReference(value: string): SpatialReference | undefined {
  const match = /^spatial:\/\/([^/]+)\/(?:([^/]+)\/)?(class|instance)\/([^/]+)$/.exec(value);
  if (!match) {
    return undefined;
  }
  try {
    return {
      recordId: decodeURIComponent(match[1]!),
      videoId: match[2] ? decodeURIComponent(match[2]) : undefined,
      targetType: match[3] as "class" | "instance",
      targetId: decodeURIComponent(match[4]!),
    };
  } catch {
    return undefined;
  }
}

export function resolveSpatialReference(
  value: string,
  document: SegmentationDocument | undefined,
): string | undefined {
  const reference = parseSpatialReference(value);
  if (!reference) {
    return undefined;
  }
  const { recordId, videoId, targetType, targetId } = reference;
  if (
    document?.record.id !== recordId ||
    (videoId && !document.videos.some((video) => video.id === videoId))
  ) {
    return `空间引用 · ${targetType} ${targetId}（记录未打开）`;
  }
  const target = (targetType === "class" ? document.classes : document.instances).find(
    (item) => item.id === targetId,
  );
  return target
    ? `${targetType === "class" ? "类别" : "实例"} · ${target.name || "未命名"} · ${targetId}`
    : `空间引用 · ${targetId}（已删除）`;
}

export function MomentReferencePicker({
  store,
  value,
  onChange,
  disabled = false,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const document = useStore(store, (state) => state.document);
  const currentFrameId = useStore(store, (state) => state.currentFrameId);
  const unavailable = useStore(
    store,
    (state) =>
      state.readonly || state.loading || ["running", "stopping"].includes(state.propagation.status),
  );
  const recordId = document?.record.id;
  const currentVideoId =
    document?.frames.find((frame) => frame.id === currentFrameId)?.videoId ??
    document?.videos[0]?.id;
  const [openedScope, setOpenedScope] = useState<{ recordId: string; videoId: string }>();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  useEffect(() => {
    setOpen(false);
  }, [store, recordId, currentVideoId, disabled, unavailable]);
  const options = [
    ...(document?.classes.map((item) => ({ type: "class" as const, ...item })) ?? []),
    ...(document?.instances.map((item) => ({ type: "instance" as const, ...item })) ?? []),
  ];
  const display = resolveSpatialReference(value, document);
  return (
    <div className="seg-reference">
      <button
        type="button"
        title="引用已标注类别或实例"
        aria-label="引用空间类别或实例"
        disabled={disabled || unavailable || !document || !currentVideoId}
        onClick={() => {
          if (!recordId || !currentVideoId) {
            return;
          }
          setTarget("");
          setOpenedScope({ recordId, videoId: currentVideoId });
          setOpen(true);
        }}
      >
        ↗ 引用
      </button>
      {display && <small title={value}>{display}</small>}
      {open && (
        <div className="seg-modal-backdrop seg-reference-picker">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="引用已标注类别或实例"
            className="seg-modal"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setOpen(false);
              }
              if (event.key === "Tab") {
                const controls = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled), select:not(:disabled)",
                  ),
                ];
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && event.target === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && event.target === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <h2>引用已标注类别或实例</h2>
            <p>记录：{document?.record.name} · 引用保存稳定 ID</p>
            <select
              autoFocus
              aria-label="选择类别或实例"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
            >
              <option value="">请选择…</option>
              {options.map((item) => (
                <option key={`${item.type}/${item.id}`} value={`${item.type}/${item.id}`}>
                  {item.type === "class" ? "类别" : "实例"} · {item.name || "未命名"} · {item.id}
                </option>
              ))}
            </select>
            {options.length === 0 && (
              <p role="status">暂无可引用目标，请先在空间侧栏创建类别或实例。</p>
            )}
            <span className="seg-row">
              <button
                type="button"
                disabled={!target || unavailable || disabled}
                onClick={() => {
                  const selected = options.find((item) => `${item.type}/${item.id}` === target);
                  if (
                    openedScope?.recordId !== recordId ||
                    openedScope?.videoId !== currentVideoId ||
                    unavailable ||
                    disabled
                  ) {
                    setOpen(false);
                    return;
                  }
                  if (selected && document && openedScope) {
                    onChange(
                      encodeSpatialReference(
                        openedScope.recordId,
                        selected.type,
                        selected.id,
                        openedScope.videoId,
                      ),
                    );
                    setOpen(false);
                  }
                }}
              >
                插入引用
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
              >
                取消
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
