// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useId, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { PropagationRequest, SemanticSegmentationStore } from "../types";
import type { CanvasPropagationScope } from "./propagationSeeds";

/**
 * Propagation parameters for one canvas. The scope names the video, frame and every seeded
 * instance, so the request always covers that canvas as a whole and never mixes canvases.
 */
export function PropagationForm({
  store,
  scope,
  sourceReady = true,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  scope: CanvasPropagationScope | undefined;
  sourceReady?: boolean;
}): React.JSX.Element {
  const state = useStore(store);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [beforeInput, setBeforeInput] = useState("10");
  const [afterInput, setAfterInput] = useState("30");
  const beforeFrames = Number(beforeInput);
  const afterFrames = Number(afterInput);
  const rangeId = useId();
  const [resolution, setResolution] = useState(1080);
  const [model, setModel] = useState("sam2.1-motion");
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLocalError(undefined);
  }, [store, state.document?.record.id, state.interactionResetVersion]);
  const document = state.document;
  const frame = document?.frames.find((item) => item.id === scope?.frameId);
  const capabilities = state.propagationCapabilities;
  const allowedDirections = capabilities?.directions ?? ["forward", "backward"];
  const allowedModels = capabilities?.models ?? ["large", "small"];
  const allowedResolutions = capabilities?.resolutions ?? [540, 720, 1080, 2160];
  const allowBefore = allowedDirections.includes("backward");
  const allowAfter = allowedDirections.includes("forward");
  const resolutionReady =
    allowedResolutions.length === 0 || allowedResolutions.includes(resolution);
  const supportedParameters =
    allowedDirections.includes(direction) &&
    allowedModels.includes(model) &&
    resolutionReady &&
    !state.propagationCapabilitiesError &&
    state.propagationCapabilitiesLoading !== true;
  useEffect(() => {
    if (!capabilities) {
      return;
    }
    if (!capabilities.directions.includes(direction) && capabilities.directions[0]) {
      setDirection(capabilities.directions[0]);
    }
    if (!capabilities.models.includes(model) && capabilities.models[0]) {
      setModel(capabilities.models[0]);
    }
    if (
      !capabilities.resolutions.includes(resolution) &&
      capabilities.resolutions[0] != undefined
    ) {
      setResolution(capabilities.resolutions[0]);
    }
    if (!capabilities.directions.includes("backward")) {
      setBeforeInput("0");
    }
    if (!capabilities.directions.includes("forward")) {
      setAfterInput("0");
    }
  }, [capabilities, direction, model, resolution]);
  const seeds = scope?.seeds ?? [];
  const firstSeed = seeds[0];
  const instanceId = firstSeed?.instanceId;
  const hasSeed = seeds.length > 0;
  const validBefore =
    beforeInput.trim() !== "" &&
    Number.isInteger(beforeFrames) &&
    beforeFrames >= 0 &&
    beforeFrames <= 10000;
  const validAfter =
    afterInput.trim() !== "" &&
    Number.isInteger(afterFrames) &&
    afterFrames >= 0 &&
    afterFrames <= 10000;
  const validRange = validBefore && validAfter && beforeFrames + afterFrames > 0;
  const videoFrames =
    document?.frames
      .filter((item) => item.videoId === frame?.videoId)
      .sort((a, b) => a.index - b.index) ?? [];
  const seedIndex = videoFrames.findIndex((item) => item.id === frame?.id);
  const effectiveBefore = validRange ? Math.min(beforeFrames, Math.max(0, seedIndex)) : 0;
  const effectiveAfter = validRange
    ? Math.min(afterFrames, Math.max(0, videoFrames.length - seedIndex - 1))
    : 0;
  const clippedRange =
    validRange && (effectiveBefore !== beforeFrames || effectiveAfter !== afterFrames);
  const effectiveRange = `前 ${effectiveBefore} 帧${effectiveBefore > 0 ? `（${seedIndex - effectiveBefore + 1}–${seedIndex}）` : "（无）"} / 后 ${effectiveAfter} 帧${effectiveAfter > 0 ? `（${seedIndex + 2}–${seedIndex + effectiveAfter + 1}）` : "（无）"}`;
  const request: PropagationRequest | undefined =
    frame && instanceId
      ? {
          instanceId,
          fromFrameId: frame.id,
          direction,
          frameCount: direction === "forward" ? afterFrames : beforeFrames,
          ...(allowedResolutions.length > 0 ? { resolution } : {}),
          model,
          polygonIds: firstSeed.polygons.map((polygon) => polygon.id),
          seedPolygons: firstSeed.polygons,
          seeds,
        }
      : undefined;
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
    <section className="seg-section" aria-label="传播参数">
      <h2 id="seg-propagation">⇢ 实例传播</h2>
      {localError && (
        <div role="alert" className="seg-status seg-error">
          {localError}
        </div>
      )}
      <p className="seg-muted">
        {hasSeed
          ? `${seeds.length} 个实例 · ${seeds.reduce((count, seed) => count + seed.polygons.length, 0)} 个多边形`
          : "当前帧没有可传播的实例"}
      </p>
      <label>
        方向
        <select
          aria-label="传播方向"
          value={direction}
          onChange={(event) => {
            setDirection(event.target.value as "forward" | "backward");
          }}
        >
          <option value="forward" disabled={!allowAfter}>
            向后（时间增加）→{!allowAfter ? "（不支持）" : ""}
          </option>
          <option value="backward" disabled={!allowBefore}>
            向前（时间减少）←{!allowBefore ? "（不支持）" : ""}
          </option>
        </select>
      </label>
      {!capabilities &&
        !state.propagationCapabilitiesError &&
        state.propagationCapabilitiesLoading !== true && (
          <p className="seg-muted">服务未声明传播能力；使用兼容选项，具体可用性由服务验证。</p>
        )}
      {state.propagationCapabilitiesLoading === true && <p role="status">正在读取模型传播能力…</p>}
      {state.propagationCapabilitiesError && (
        <>
          <p role="alert">传播能力读取失败：{state.propagationCapabilitiesError}</p>
          <button
            type="button"
            disabled={state.propagationCapabilitiesLoading}
            onClick={() => {
              invoke(state.refreshPropagationCapabilities);
            }}
          >
            重试模型能力
          </button>
        </>
      )}
      {capabilities && !allowBefore && (
        <p className="seg-muted">
          时间减少方向不可用：
          {capabilities.directionReasons?.backward ?? "当前适配器不支持此方向"}。
        </p>
      )}
      {capabilities && !allowAfter && (
        <p className="seg-muted">
          时间增加方向不可用：{capabilities.directionReasons?.forward ?? "当前适配器不支持此方向"}。
        </p>
      )}
      <label>
        前帧数
        <input
          aria-label="前帧数"
          type="number"
          min={0}
          max={10000}
          value={beforeInput}
          disabled={!allowBefore}
          aria-invalid={!validBefore}
          aria-describedby={!validBefore ? `${rangeId}-before-error` : undefined}
          onChange={(event) => {
            if (allowBefore) {
              setBeforeInput(event.target.value);
            }
          }}
        />
        {!validBefore && (
          <small id={`${rangeId}-before-error`} role="alert">
            前帧数必须是 0–10000 的有限整数。
          </small>
        )}
      </label>
      <label>
        后帧数
        <input
          aria-label="后帧数"
          type="number"
          min={0}
          max={10000}
          value={afterInput}
          disabled={!allowAfter}
          aria-invalid={!validAfter}
          aria-describedby={!validAfter ? `${rangeId}-after-error` : undefined}
          onChange={(event) => {
            if (allowAfter) {
              setAfterInput(event.target.value);
            }
          }}
        />
        {!validAfter && (
          <small id={`${rangeId}-after-error`} role="alert">
            后帧数必须是 0–10000 的有限整数。
          </small>
        )}
      </label>
      {validBefore && validAfter && beforeFrames + afterFrames === 0 && (
        <p role="alert">前帧数和后帧数不能同时为 0。</p>
      )}
      {validRange && frame && (
        <p aria-label="有效传播范围" className="seg-muted">
          源帧 {frame.index + 1} [{frame.id}] · 有效范围：{effectiveRange}
          {clippedRange ? " · 已按片段边界裁剪。" : ""}
        </p>
      )}
      {validRange && effectiveBefore + effectiveAfter === 0 && (
        <p role="alert">当前范围内没有可传播的其他帧。</p>
      )}
      {allowedResolutions.length > 0 && (
        <label>
          分辨率
          <select
            aria-label="传播分辨率"
            value={resolution}
            onChange={(event) => {
              setResolution(Number(event.target.value));
            }}
          >
            {allowedResolutions.map((value) => (
              <option key={value} value={value}>
                {value}p
              </option>
            ))}
          </select>
        </label>
      )}
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
      <div className="seg-row">
        <button
          type="button"
          className="seg-primary"
          disabled={
            !sourceReady ||
            state.readonly ||
            !hasSeed ||
            !request ||
            !validRange ||
            !supportedParameters ||
            request.frameCount < 1 ||
            busy
          }
          onClick={() => {
            if (request) {
              invoke(async () => {
                await state.startPropagation(request);
              });
            }
          }}
        >
          在线传播
        </button>
      </div>
      <p className="seg-muted">
        在线传播只走向后续帧。播放期间只有 STOP 可用。停止后可修改种子并重新传播。
      </p>
      <p aria-live="polite">
        传播状态：{state.propagation.status} · 已接收 {state.propagation.processedFrames} 帧
      </p>
      {["running", "stopping"].includes(state.propagation.status) && (
        <button
          type="button"
          disabled={state.propagation.status === "stopping"}
          onClick={state.stopPropagation}
        >
          停止
        </button>
      )}
    </section>
  );
}
