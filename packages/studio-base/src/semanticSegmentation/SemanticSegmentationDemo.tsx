// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import i18n from "i18next";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { useStore } from "zustand";

import CssBaseline from "@foxglove/studio-base/components/CssBaseline";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { SemanticSegmentationWorkbench } from "./SemanticSegmentationWorkbench";
import {
  MomentReferencePicker,
  parseSpatialReference,
  resolveSpatialReference,
} from "./components/MomentReferencePicker";
import { createSeedDocument } from "./mockService";
import {
  activateSegmentationRuntime,
  createSegmentationRuntime,
  getDemoRuntime,
  type SegmentationRuntime,
} from "./runtime";
import { frameInstanceKey } from "./service";
import { createSubmissionFixture, stageSubmissionFixture } from "./submissionFixture";

function DemoMoment({ runtime }: { runtime: SegmentationRuntime }): React.JSX.Element {
  const document = useStore(runtime.store, (state) => state.document);
  const readonly = useStore(runtime.store, (state) => state.readonly);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  return (
    <section className="seg-section">
      <h2>一刻 · 属性引用</h2>
      <label>
        属性名称
        <input aria-label="一刻属性名称" value="目标" readOnly />
      </label>
      <label>
        属性值
        <input
          aria-label="一刻属性值"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          disabled={readonly}
        />
      </label>
      <MomentReferencePicker
        store={runtime.store}
        value={value}
        onChange={setValue}
        disabled={readonly}
      />
      <p className="seg-muted">与现有一刻表单共用引用选择器；保存稳定 class / instance ID。</p>
      <button
        type="button"
        disabled={readonly || !value.startsWith("spatial://")}
        onClick={() => {
          const reference = parseSpatialReference(value);
          if (reference) {
            runtime.store
              .getState()
              .addMomentReference(
                `demo-moment-${saved.length + 1}`,
                reference.targetType,
                reference.targetId,
              );
            setSaved([...saved, value]);
          }
        }}
      >
        保存一刻引用
      </button>
      {saved.map((item, index) => (
        <p key={index}>{resolveSpatialReference(item, document)}</p>
      ))}
    </section>
  );
}

function DemoScenarios({ runtime }: { runtime: SegmentationRuntime }): React.JSX.Element {
  const [notice, setNotice] = useState("");
  const [fixtureBusy, setFixtureBusy] = useState(false);
  const stagedCount = useStore(runtime.store, (state) => state.stagedOperations.length);
  const submissionFixture =
    new URLSearchParams(window.location.search).get("submissionFrames") === "1000";
  return (
    <details className="seg-section" data-testid="demo-scenarios">
      <summary>演示故障与恢复</summary>
      <p className="seg-muted">只影响当前页面的内存服务，无外部请求。</p>
      {submissionFixture && (
        <button
          type="button"
          disabled={fixtureBusy || stagedCount > 0}
          onClick={() => {
            setFixtureBusy(true);
            setNotice("正在准备 1000 帧暂存样本…");
            void stageSubmissionFixture(runtime)
              .then(() => {
                setNotice(
                  "已准备 1000 个目标帧的暂存；点击顶部提交以测量准备阶段，期间仍可继续编辑。",
                );
              })
              .catch((error: unknown) => {
                setNotice(String(error));
              })
              .finally(() => {
                setFixtureBusy(false);
              });
          }}
        >
          {fixtureBusy ? "载入样本中…" : "准备 1000 帧提交样本"}
        </button>
      )}
      <div className="seg-row">
        <button
          type="button"
          onClick={() => {
            runtime.service.setControls({ delayMs: 0, streamDelayMs: 0, cancelDelayMs: 400 });
            setNotice(
              "突发夹具已启用：选择实例，后帧数设为 100，开始在线传播后点击 STOP。停止确认延迟 400ms。",
            );
          }}
        >
          模拟 100 帧突发与延迟停止
        </button>
        <button
          type="button"
          onClick={() => {
            runtime.service.setControls({ failNext: true });
            setNotice("下一次服务操作将失败，可重试恢复。");
          }}
        >
          下次请求失败
        </button>
        <button
          type="button"
          onClick={() => {
            runtime.service.setControls({ conflictNext: true });
            setNotice("下次修改同帧实例并提交将触发冲突。");
          }}
        >
          下次提交冲突
        </button>
        <button
          type="button"
          onClick={() => {
            runtime.service.reset();
            window.location.reload();
          }}
        >
          重置整个演示
        </button>
      </div>
      <p role="status">{notice}</p>
    </details>
  );
}

export function SemanticSegmentationDemo(): React.JSX.Element {
  const [runtime] = useState(() => {
    if (new URLSearchParams(window.location.search).get("submissionFrames") === "1000") {
      return createSegmentationRuntime(createSubmissionFixture());
    }
    if (new URLSearchParams(window.location.search).get("stressPolygons") !== "1000") {
      return getDemoRuntime();
    }
    const document = createSeedDocument();
    const annotation = document.annotations[frameInstanceKey("frame-0", "instance-1")];
    if (annotation) {
      annotation.polygons = Array.from({ length: 1000 }, (_, index) => {
        const x = 0.01 + (index % 40) * 0.024;
        const y = 0.01 + Math.floor(index / 40) * 0.039;
        return {
          id: `stress-polygon-${index}`,
          points: [
            { x, y },
            { x: x + 0.016, y },
            { x: x + 0.016, y: y + 0.025 },
            { x, y: y + 0.025 },
          ],
        };
      });
      document.annotationSummaries[frameInstanceKey("frame-0", "instance-1")] = {
        polygonCount: 1000,
        pointCount: 4000,
      };
    }
    return createSegmentationRuntime(document);
  });
  useEffect(() => {
    activateSegmentationRuntime(runtime);
  }, [runtime]);
  return (
    <ThemeProvider isDark>
      <CssBaseline>
        <div className="seg-demo">
          <SemanticSegmentationWorkbench
            runtime={runtime}
            demo
            momentEditor={
              <>
                <DemoMoment runtime={runtime} />
                <DemoScenarios runtime={runtime} />
              </>
            }
          />
        </div>
      </CssBaseline>
    </ThemeProvider>
  );
}

/** Runs before studio-web imports, login, telemetry, API rewriting or provider bootstrap. */
export async function renderSemanticSegmentationDemo(): Promise<void> {
  await i18n.use(initReactI18next).init({
    lng: "zh",
    fallbackLng: "zh",
    resources: { zh: { translation: {} } },
    interpolation: { escapeValue: false },
  });
  const root = window.document.getElementById("root");
  if (!root) {
    throw new Error("Missing #root element");
  }
  window.document.title = "coStudio · 空间标注本地演示";
  createRoot(root).render(<SemanticSegmentationDemo />);
}
