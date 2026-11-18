// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { sourceFrameLoaders } from "../sourceFrames";
import type { PropagationRequest, SegmentationFrame, SemanticSegmentationStore } from "../types";
import type { CanvasPropagationScope } from "./propagationSeeds";

/**
 * How far one click propagates. The API needs an end time (there is no open-ended stream), and
 * both inference backends load the whole range into memory, so the range is bounded; STOP ends it
 * early and keeps every frame received so far.
 */
export const PROPAGATION_RANGES_SEC = [1, 3, 10] as const;
const DEFAULT_RANGE_SEC = 10;

export type PropagationDirection = "forward" | "backward" | "both";
const DIRECTION_LABELS: Record<PropagationDirection, string> = {
  forward: "向后",
  backward: "向前",
  both: "双向",
};

/**
 * One-click propagation for one canvas: the checked seeded instances on the canvas's current
 * frame go forward, backward (when the service supports it) or both from that frame for the
 * chosen range, starting at once. "Both" runs forward, then backward if forward completed.
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
  const [direction, setDirection] = useState<PropagationDirection>("forward");
  /** Instances the user checked; undefined follows the default (tree selection, else all). */
  const [checked, setChecked] = useState<string[] | undefined>();
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState<"idle" | "preparing" | "starting">("idle");
  useEffect(() => {
    setLocalError(undefined);
  }, [store, state.document?.record.id, state.interactionResetVersion]);
  // Another frame or canvas has other seeds: return to the default choice.
  useEffect(() => {
    setChecked(undefined);
  }, [scope?.frameId]);
  const document = state.document;
  const frame = document?.frames.find((item) => item.id === scope?.frameId);
  const capabilities = state.propagationCapabilities;
  const allowedModels = capabilities?.models ?? [model];
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
  const backwardSupported = capabilities?.backward === true;
  const effectiveDirection: PropagationDirection = backwardSupported ? direction : "forward";
  const allSeeds = scope?.seeds ?? [];
  const treeSelected = new Set(
    state.selection.filter((node) => node.type === "instance").map((node) => node.id),
  );
  const defaultChoice = allSeeds.some((seed) => treeSelected.has(seed.instanceId))
    ? allSeeds.filter((seed) => treeSelected.has(seed.instanceId)).map((seed) => seed.instanceId)
    : allSeeds.map((seed) => seed.instanceId);
  const chosen = new Set(checked ?? defaultChoice);
  const seeds = allSeeds.filter((seed) => chosen.has(seed.instanceId));
  const firstSeed = seeds[0];
  const hasSeed = seeds.length > 0;
  const instanceName = (id: string) =>
    document?.instances.find((instance) => instance.id === id)?.name ?? id;
  const running = ["running", "stopping"].includes(state.propagation.status);

  /** Frames of the seed's video within the range on one side of the seed, in time order. */
  const framesTowards = (side: "forward" | "backward"): SegmentationFrame[] => {
    if (!frame) {
      return [];
    }
    const seedNs = BigInt(frame.logTimeNs);
    const rangeNs = BigInt(rangeSec) * 1_000_000_000n;
    return (store.getState().document?.frames ?? [])
      .filter((item) => {
        if (item.videoId !== frame.videoId) {
          return false;
        }
        const time = BigInt(item.logTimeNs);
        return side === "forward"
          ? time > seedNs && time <= seedNs + rangeNs
          : time < seedNs && time >= seedNs - rangeNs;
      })
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
      const rangeNs = BigInt(rangeSec) * 1_000_000_000n;
      const sides: ("forward" | "backward")[] =
        effectiveDirection === "both" ? ["forward", "backward"] : [effectiveDirection];
      await loader?.ensureRange(
        sides.includes("backward") ? seedNs - rangeNs : seedNs,
        sides.includes("forward") ? seedNs + rangeNs : seedNs,
      );
      // The end of each run: the last frame forward, the earliest frame backward.
      const runs = sides.flatMap((side) => {
        const targets = framesTowards(side);
        const end = side === "forward" ? targets.at(-1) : targets[0];
        return end ? [{ side, endTimeNs: end.logTimeNs }] : [];
      });
      if (runs.length === 0) {
        throw new Error(
          effectiveDirection === "backward"
            ? "种子帧之前没有可传播的帧（已到录像开头）。"
            : effectiveDirection === "forward"
              ? "种子帧之后没有可传播的帧（已到录像结尾）。"
              : "种子帧前后都没有可传播的帧。",
        );
      }
      setBusy("starting");
      for (const [index, run] of runs.entries()) {
        // A stopped or failed run ends the sequence; its received frames stay as drafts.
        if (index > 0 && store.getState().propagation.status !== "completed") {
          break;
        }
        const request: PropagationRequest = {
          instanceId: firstSeed.instanceId,
          fromFrameId: frame.id,
          endTimeNs: run.endTimeNs,
          model,
          seeds,
        };
        const running = store.getState().startPropagation(request);
        if (index === 0) {
          onStarted?.();
        }
        await running;
      }
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
      <h2>⇢ 实例传播</h2>
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
      {allSeeds.length > 1 && (
        <fieldset className="seg-section" aria-label="传播实例">
          <legend>传播哪些实例</legend>
          {allSeeds.map((seed) => (
            <label key={seed.instanceId} className="seg-row">
              <input
                type="checkbox"
                checked={chosen.has(seed.instanceId)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) {
                    next.add(seed.instanceId);
                  } else {
                    next.delete(seed.instanceId);
                  }
                  setChecked(allSeeds.map((item) => item.instanceId).filter((id) => next.has(id)));
                }}
              />
              {instanceName(seed.instanceId)}
              {seed.kind === "mask" ? " · mask" : ` · ${seed.polygons.length} 个多边形`}
            </label>
          ))}
        </fieldset>
      )}
      {backwardSupported && (
        <div className="seg-row" role="radiogroup" aria-label="传播方向">
          {(Object.keys(DIRECTION_LABELS) as PropagationDirection[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={direction === value}
              className={direction === value ? "seg-primary" : undefined}
              onClick={() => {
                setDirection(value);
              }}
            >
              {DIRECTION_LABELS[value]}
            </button>
          ))}
        </div>
      )}
      {frame && (
        <p aria-label="有效传播范围" className="seg-muted">
          从源帧 {frame.index + 1} {DIRECTION_LABELS[effectiveDirection]}
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
        点击后立即开始，最多{DIRECTION_LABELS[effectiveDirection]}传播 {rangeSec}{" "}
        秒。结果逐帧出现，画面跟着走；想提前结束就点顶部 STOP，已收到的帧保留为草稿，提交后才保存。
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
