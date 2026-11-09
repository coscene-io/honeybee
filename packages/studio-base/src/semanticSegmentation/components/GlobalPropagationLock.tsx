// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { segmentationSession } from "../runtime";
import type { SemanticSegmentationStore } from "../types";

function ActiveLock({
  store,
}: {
  store: StoreApi<SemanticSegmentationStore>;
}): React.JSX.Element | undefined {
  const propagation = useStore(store, (state) => state.propagation);
  const overlayRef = useRef<HTMLDivElement>(ReactNull);
  const stopRef = useRef<HTMLButtonElement>(ReactNull);
  const locked = ["running", "stopping"].includes(propagation.status);
  const stopping = propagation.status === "stopping";
  const stopDisabled = stopping && propagation.cancellationPending !== false;
  useEffect(() => {
    if (!locked) {
      return;
    }
    const previousFocus = document.activeElement;
    const inertState = new Map<HTMLElement, boolean>();
    const makeInert = () => {
      for (const element of document.body.children) {
        if (!(element instanceof HTMLElement) || element === overlayRef.current) {
          continue;
        }
        if (!inertState.has(element)) {
          inertState.set(element, element.inert);
        }
        element.inert = true;
      }
    };
    makeInert();
    const observer = new MutationObserver(makeInert);
    observer.observe(document.body, { childList: true });
    const blockShortcuts = (event: KeyboardEvent) => {
      if (event.target === stopRef.current && ["Enter", " ", "Tab"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockShortcuts, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", blockShortcuts, true);
      for (const [element, wasInert] of inertState) {
        element.inert = wasInert;
      }
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  }, [locked]);
  useEffect(() => {
    if (locked && !stopDisabled) {
      stopRef.current?.focus();
    }
  }, [locked, stopDisabled]);
  return locked
    ? createPortal(
        <div
          ref={overlayRef}
          className="seg-global-lock"
          role="dialog"
          aria-modal="true"
          aria-label="在线传播锁定"
        >
          <div className="seg-global-stop" role="status">
            <strong>
              {stopping ? "正在停止传播，等待服务确认" : "在线传播中"} · 已接收{" "}
              {propagation.processedFrames} 帧
            </strong>
            <span>其他操作已锁定，确认停止后可继续编辑。</span>
            {stopping && propagation.error && <span role="alert">{propagation.error}</span>}
            <button
              type="button"
              ref={stopRef}
              disabled={stopDisabled}
              onKeyDown={(event) => {
                if (!stopDisabled && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  event.stopPropagation();
                  store.getState().stopPropagation();
                }
              }}
              onClick={() => {
                store.getState().stopPropagation();
              }}
            >
              {stopping ? (stopDisabled ? "正在停止…" : "重试停止") : "STOP · 停止传播"}
            </button>
          </div>
        </div>,
        document.body,
      )
    : undefined;
}

/** Protects the real player, source controls, sidebar and portal menus during a live stream. */
export function GlobalPropagationLock(): React.JSX.Element | undefined {
  const runtime = useStore(segmentationSession, (state) => state.runtime);
  return runtime ? <ActiveLock store={runtime.store} /> : undefined;
}
