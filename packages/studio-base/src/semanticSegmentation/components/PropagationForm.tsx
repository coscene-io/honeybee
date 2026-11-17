// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { sourceFrameLoaders } from "../sourceFrames";
import type { PropagationRequest, SemanticSegmentationStore } from "../types";
import type { CanvasPropagationScope } from "./propagationSeeds";

/**
 * How far one click propagates. The API needs an end time (there is no open-ended stream), and
 * both inference backends load the whole range into memory, so the range is bounded; STOP ends it
 * early and keeps every frame received so far.
 */
export const PROPAGATION_RANGES_SEC = [1, 3, 10] as const;
const DEFAULT_RANGE_SEC = 10;

/**
 * One-click propagation for one canvas: every seeded instance on the canvas's current frame
 * goes forward from that frame for the chosen range, starting at once.
 */
export function PropagationForm({
  store,
  scope,
  sourceReady = true,
  onStarted,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  scope: CanvasPropagationScope | undefined;
  sourceReady?: boolean;
  /** Called once the run starts: progress and STOP then live in the global lock bar. */
  onStarted?: () => void;
}): React.JSX.Element {
  const state = useStore(store);
  const [rangeSec, setRangeSec] = useState<number>(DEFAULT_RANGE_SEC);
  const [model, setModel] = useState("sam2.1-motion");
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState<"idle" | "preparing" | "starting">("idle");
  useEffect(() => {
    setLocalError(undefined);
  }, [store, state.document?.record.id, state.interactionResetVersion]);
  const document = state.document;
  const frame = document?.frames.find((item) => item.id === scope?.frameId);
  const capabilities = state.propagationCapabilities;
  const allowedModels = capabilities?.models ?? ["large", "small"];
  const supportedParameters =
    allowedModels.includes(model) &&
    !state.propagationCapabilitiesError &&
    state.propagationCapabilitiesLoading !== true;
  useEffect(() => {
    if (!capabilities) {
      return;
    }
    if (!capabilities.models.includes(model) && capabilities.models[0]) {
      setModel(capabilities.models[0]);
    }
  }, [capabilities, model]);
  const seeds = scope?.seeds ?? [];
  const firstSeed = seeds[0];
  const hasSeed = seeds.length > 0;
  const running = ["running", "stopping"].includes(state.propagation.status);

  /** Frames of the seed's video after the seed and within the range, in time order. */
  const framesAfter = () => {
    if (!frame) {
      return [];
    }
    const seedNs = BigInt(frame.logTimeNs);
    const endNs = seedNs + BigInt(rangeSec) * 1_000_000_000n;
    return (store.getState().document?.frames ?? [])
      .filter(
        (item) =>
          item.videoId === frame.videoId &&
          BigInt(item.logTimeNs) > seedNs &&
          BigInt(item.logTimeNs) <= endNs,
      )
      .sort((a, b) => (BigInt(a.logTimeNs) < BigInt(b.logTimeNs) ? -1 : 1));
  };

  const start = () => {
    if (!frame || !firstSeed) {
      return;
    }
    setLocalError(undefined);
    setBusy("preparing");
    void (async () => {
      // The document lists only the frames read so far: read the whole range first, so every
      // propagated frame has a local frame to land on.
      const loader = sourceFrameLoaders.get(frame.videoId);
      const seedNs = BigInt(frame.logTimeNs);
      await loader?.ensureRange(seedNs, seedNs + BigInt(rangeSec) * 1_000_000_000n);
      const targets = framesAfter();
      const last = targets.at(-1);
      if (!last) {
        throw new Error("种子帧之后没有可传播的帧（已到录像结尾）。");
      }
      const request: PropagationRequest = {
        instanceId: firstSeed.instanceId,
        fromFrameId: frame.id,
        endTimeNs: last.logTimeNs,
        model,
        seeds,
      };
      setBusy("starting");
      const running = store.getState().startPropagation(request);
      onStarted?.();
      await running;
    })()
      .catch((error: unknown) => {
        setLocalError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setBusy("idle");
      });
  };

  return (
    <section className="seg-section" aria-label="传播参数">
      <h2 id="seg-propagation">⇢ 实例传播</h2>
      {localError && (
        <div role="alert" className="seg-status seg-error">
          {localError}
        </div>
      )}
      <p className="seg-muted">
        {hasSeed
          ? `${seeds.length} 个实例 · ${seeds.reduce((count, seed) => count + (seed.kind === "polygons" ? seed.polygons.length : 0), 0)} 个多边形${seeds.some((seed) => seed.kind === "mask") ? ` · ${seeds.filter((seed) => seed.kind === "mask").length} 个 mask` : ""}`
          : "当前帧没有可传播的实例"}
      </p>
      {state.propagationCapabilitiesLoading === true && <p role="status">正在读取模型传播能力…</p>}
      {state.propagationCapabilitiesError && (
        <>
          <p role="alert">传播能力读取失败：{state.propagationCapabilitiesError}</p>
          <button
            type="button"
            disabled={state.propagationCapabilitiesLoading}
            onClick={() => {
              void state.refreshPropagationCapabilities();
            }}
          >
            重试模型能力
          </button>
        </>
      )}
      {frame && (
        <p aria-label="有效传播范围" className="seg-muted">
          从源帧 {frame.index + 1} 向后
        </p>
      )}
      <div className="seg-row" role="radiogroup" aria-label="传播范围">
        {PROPAGATION_RANGES_SEC.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rangeSec === value}
            className={rangeSec === value ? "seg-primary" : undefined}
            onClick={() => {
              setRangeSec(value);
            }}
          >
            {value} 秒
          </button>
        ))}
      </div>
      {allowedModels.length > 1 && (
        <label>
          模型
          <select
            aria-label="传播模型"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          >
            {allowedModels.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="seg-row">
        <button
          type="button"
          className="seg-primary"
          disabled={!sourceReady || !hasSeed || !supportedParameters || busy !== "idle" || running}
          onClick={start}
        >
          {busy === "preparing" ? "正在读取后续帧…" : "开始传播"}
        </button>
      </div>
      <p className="seg-muted">
        点击后立即开始，最多向后传播 {rangeSec} 秒。结果逐帧出现，画面跟着走；想提前结束就点顶部
        STOP，已收到的帧保留为草稿，提交后才保存。
      </p>
      {state.propagation.status !== "idle" && (
        <p aria-live="polite">
          {
            {
              running: "传播中",
              stopping: "正在停止",
              completed: "已完成",
              cancelled: "已停止",
              failed: "失败",
              idle: "",
            }[state.propagation.status]
          }{" "}
          · 已接收 {state.propagation.processedFrames} 帧
        </p>
      )}
    </section>
  );
}
