// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React, { useCallback, useEffect, useRef, useState } from "react";

import { PanelExtensionContext } from "@foxglove/studio";

import ActionDetailModal from "./components/ActionDetailModal";
import { ActionItem, DurationInput, RecordButton } from "./components/ui";
import { fetchAvailableActionsWithInfo, getActionDetail } from "./services";
import { defaultConfig, type FaultRecordConfig } from "./settings";
import type { ActionInfo, PanelState, StartRecordReq, StopRecordReq } from "./types";

interface FaultRecordPanelProps {
  context: PanelExtensionContext;
}

export default function FaultRecordPanel({ context }: FaultRecordPanelProps): React.JSX.Element {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<FaultRecordConfig>(defaultConfig);
  const [state, setState] = useState<PanelState>({
    recordingState: "idle",
    selectedActionName: "",
    preparationDuration: 30,
    recordDuration: 30,
    logs: [],
  });

  // 当前正在录制的action名称
  const [currentRecordingAction, setCurrentRecordingAction] = useState<string>("");

  // Add initial log entry
  const [initialLogAdded, setInitialLogAdded] = useState(false);
  const [availableActions, setAvailableActions] = useState<ActionInfo[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [isStartLoading, setIsStartLoading] = useState(false);
  const [isStopLoading, setIsStopLoading] = useState(false);
  const [showActionDetail, setShowActionDetail] = useState(false);
  const [selectedActionDetail, setSelectedActionDetail] = useState<ActionInfo | undefined>(
    undefined,
  );
  const [_isLoadingActionDetail, setIsLoadingActionDetail] = useState(false);
  const hydratingRef = useRef(false);

  // Inject mockService if not present - COMMENTED OUT FOR REAL SERVICE TESTING
  // if (!("mockService" in context)) {
  //   try {
  //     (context as any).mockService = require("./mockService").mockService;
  //   } catch (e) {
  //     // eslint-disable-next-line no-console
  //     console.error("mockService 注入失败", e);
  //   }
  // }

  // Add log line
  const addLog = useCallback((message: string, type: "info" | "success" | "error" = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
          ts: timestamp,
          msg: message,
          level: type === "success" ? "info" : type,
        },
      ].slice(-50), // Keep last 50 logs
    }));
  }, []);

  // Auto-scroll to latest log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.logs]);

  // Add initial log when component mounts
  useEffect(() => {
    if (!initialLogAdded) {
      addLog(`面板初始化 - 默认配置加载完成`, "info");
      addLog(
        `初始服务配置 - 开始: ${config.startRecordService.serviceName}, 停止: ${config.stopRecordService.serviceName}`,
        "info",
      );
      addLog(
        `初始时长配置 - 触发前: ${state.preparationDuration}s, 录制: ${state.recordDuration}s`,
        "info",
      );
      setInitialLogAdded(true);
    }
  }, [
    initialLogAdded,
    addLog,
    config.startRecordService.serviceName,
    config.stopRecordService.serviceName,
    state.preparationDuration,
    state.recordDuration,
  ]);

  // Load available actions
  const loadAvailableActions = useCallback(async () => {
    setIsLoadingActions(true);
    try {
      const actions = await fetchAvailableActionsWithInfo(
        context,
        config.actionListService.serviceName,
      );
      setAvailableActions(actions);

      // Validate current selection; clear if not available
      setState((prev) => {
        const prevName = prev.selectedActionName;
        if (prevName && !actions.some((action: ActionInfo) => action.action_name === prevName)) {
          addLog(`当前选择的action "${prevName}" 不再可用，已清空选择`, "error");
          return { ...prev, selectedActionName: "" };
        }
        return prev;
      });

      addLog(`成功加载 ${actions.length} 个可用Action`, "success");
    } catch (error: unknown) {
      addLog(`加载action列表失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      setAvailableActions([]);
    } finally {
      setIsLoadingActions(false);
    }
  }, [addLog, context, config.actionListService.serviceName]);

  // Fetch on mount only
  useEffect(() => {
    void loadAvailableActions();
  }, [loadAvailableActions]);

  // Wire onRender to hydrate config and state from renderState
  useEffect(() => {
    // CRITICAL: Watch extensionData to ensure onRender is called when external config changes
    context.watch("extensionData");

    context.onRender = (renderState: unknown, done?: () => void) => {
      try {
        const panelConfig = (renderState as { extensionData?: { panelConfig?: FaultRecordConfig } })
          .extensionData?.panelConfig;
        const savedState = (renderState as { config?: Partial<PanelState> }).config;

        // Update the separate config state if needed.
        if (panelConfig) {
          // Check for service configuration changes
          const oldStartService = config.startRecordService.serviceName;
          const newStartService = panelConfig.startRecordService.serviceName;
          const oldStopService = config.stopRecordService.serviceName;
          const newStopService = panelConfig.stopRecordService.serviceName;
          const oldPreparationDuration = config.defaultPreparationDuration;
          const newPreparationDuration = panelConfig.defaultPreparationDuration;
          const oldRecordDuration = config.defaultRecordDuration;
          const newRecordDuration = panelConfig.defaultRecordDuration;

          let hasServiceChanges = false;
          let hasDurationChanges = false;

          if (oldStartService !== newStartService) {
            addLog(
              `外部配置更新开始录制服务: "${oldStartService}" -> "${newStartService}"`,
              "info",
            );
            hasServiceChanges = true;
          }
          if (oldStopService !== newStopService) {
            addLog(`外部配置更新停止录制服务: "${oldStopService}" -> "${newStopService}"`, "info");
            hasServiceChanges = true;
          }
          if (
            oldPreparationDuration !== newPreparationDuration ||
            oldRecordDuration !== newRecordDuration
          ) {
            hasDurationChanges = true;
          }

          // Only log summary if there are actual changes
          if (hasServiceChanges) {
            addLog(
              `配置更新完成 - 开始录制服务: ${newStartService || "undefined"}, 停止录制服务: ${
                newStopService || "undefined"
              }`,
              "info",
            );
          }
          if (hasDurationChanges) {
            addLog(
              `配置更新完成 - 默认触发前时长: ${newPreparationDuration}s, 默认录制时长: ${newRecordDuration}s`,
              "info",
            );
          }

          setConfig(panelConfig);
        }

        // We can merge all state updates into one call to setState.
        if (panelConfig || (savedState && Object.keys(savedState).length > 0)) {
          hydratingRef.current = true;

          setState((prev) => {
            // Start with the previous state.
            let nextState = { ...prev };

            // Apply savedState first.
            if (savedState) {
              nextState = { ...nextState, ...savedState };
            }

            // Apply data from the host, overwriting what was in savedState.
            if (panelConfig) {
              // Update the durations with type checking (without duplicate logging)
              if (
                typeof (panelConfig as { defaultPreparationDuration?: number })
                  .defaultPreparationDuration === "number"
              ) {
                const newValue = (panelConfig as { defaultPreparationDuration: number })
                  .defaultPreparationDuration;
                nextState.preparationDuration = newValue;
              }
              if (
                typeof (panelConfig as { defaultRecordDuration?: number }).defaultRecordDuration ===
                "number"
              ) {
                const newValue = (panelConfig as { defaultRecordDuration: number })
                  .defaultRecordDuration;
                nextState.recordDuration = newValue;
              }
            }

            return nextState;
          });
        }

        // CRITICAL: Call done() to notify PanelExtensionAdapter that rendering is complete
        if (done) {
          done();
        }
      } catch {
        // Still call done() even if there's an error to prevent hanging
        if (done) {
          done();
        }
      }
      // Note: Removed duplicate done() call from finally block to prevent double execution
    };
    return () => {
      context.onRender = undefined;
    };
  }, [
    addLog,
    context,
    setState,
    setConfig,
    config.defaultPreparationDuration,
    config.defaultRecordDuration,
    config.startRecordService.serviceName,
    config.stopRecordService.serviceName,
  ]);

  // Persist panel state into layout via saveState; avoid saving during hydration
  useEffect(() => {
    const save = (context as { saveState?: (s: PanelState) => void }).saveState;
    if (!save) {
      return;
    }
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    save(state);
  }, [state, context]);

  // Start record (async; do not block UI)
  const handleStartRecord = useCallback(
    async (actionName: string) => {
      if (state.preparationDuration < 0) {
        addLog("触发前数据时长不能小于0", "error");
        return;
      }

      if (!actionName) {
        addLog("请选择要录制的Action", "error");
        return;
      }

      setIsStartLoading(true);
      addLog(`开始录制 - Action: ${actionName}, Service: ${config.startRecordService.serviceName}`);
      addLog(
        `开始录制参数 - 触发前时长: ${state.preparationDuration}s, 录制时长: ${state.recordDuration}s`,
        "info",
      );
      addLog(
        `实际调用服务: ${config.startRecordService.serviceName} (类型: ${config.startRecordService.serviceType})`,
        "info",
      );

      try {
        const req: StartRecordReq = {
          action_name: actionName,
          preparation_duration_s: state.preparationDuration,
          record_duration_s: state.recordDuration,
        };
        addLog(`发送请求参数: ${JSON.stringify(req)}`, "info");

        // Fire-and-forget service call - ONLY REAL SERVICE
        if (context.callService) {
          addLog(
            `使用 context.callService 调用真实服务: ${config.startRecordService.serviceName}`,
            "info",
          );
          context
            .callService(config.startRecordService.serviceName, req)
            .then((response: unknown) => {
              const responseObj = response as { code?: number; msg?: string };
              const code = typeof responseObj.code === "number" ? responseObj.code : -1;
              const msg =
                typeof responseObj.msg === "string" ? responseObj.msg : "Unknown response";
              if (code === 0) {
                setState((prev) => ({ ...prev, recordingState: "recording" }));
                setCurrentRecordingAction(actionName);
                addLog(msg, "success");
              } else {
                setState((prev) => ({ ...prev, recordingState: "idle" }));
                addLog(`录制失败: ${msg}`, "error");
              }
            })
            .catch((error: unknown) => {
              setState((prev) => ({ ...prev, recordingState: "idle" }));
              addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
            });
        } else {
          addLog("录制失败: context.callService 未定义，无法调用真实服务", "error");
          setIsStartLoading(false);
          return;
        }
        addLog("录制请求已发送，可以继续选择其他action进行录制", "info");
      } catch (error: unknown) {
        setState((prev) => ({ ...prev, recordingState: "idle" }));
        addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      } finally {
        setIsStartLoading(false);
      }
    },
    [
      state.preparationDuration,
      state.recordDuration,
      addLog,
      config.startRecordService.serviceName,
      config.startRecordService.serviceType,
      context,
    ],
  );

  // Stop record (async)
  const handleStopRecord = useCallback(
    async (actionName: string) => {
      if (!actionName) {
        addLog("请选择要停止的Action", "error");
        return;
      }

      setIsStopLoading(true);
      addLog(`停止录制 - Action: ${actionName}, Service: ${config.stopRecordService.serviceName}`);
      addLog(
        `实际调用服务: ${config.stopRecordService.serviceName} (类型: ${config.stopRecordService.serviceType})`,
        "info",
      );

      try {
        const req: StopRecordReq = {
          action_name: actionName,
        };
        addLog(`发送停止请求参数: ${JSON.stringify(req)}`, "info");

        // Fire-and-forget service call - ONLY REAL SERVICE
        if (context.callService) {
          addLog(
            `使用 context.callService 调用真实停止服务: ${config.stopRecordService.serviceName}`,
            "info",
          );
          context
            .callService(config.stopRecordService.serviceName, req)
            .then((response: unknown) => {
              const responseObj = response as { code?: number; msg?: string };
              const code = typeof responseObj.code === "number" ? responseObj.code : -1;
              const msg =
                typeof responseObj.msg === "string" ? responseObj.msg : "Unknown response";
              if (code === 0) {
                setState((prev) => ({ ...prev, recordingState: "idle" }));
                setCurrentRecordingAction("");
                addLog(msg, "success");
              } else {
                addLog(`停止失败: ${msg}`, "error");
              }
            })
            .catch((error: unknown) => {
              addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
            });
        } else {
          addLog("停止失败: context.callService 未定义，无法调用真实服务", "error");
          setIsStopLoading(false);
          return;
        }
        addLog("停止录制请求已发送", "info");
      } catch (error: unknown) {
        addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      } finally {
        setIsStopLoading(false);
      }
    },
    [addLog, config.stopRecordService.serviceName, config.stopRecordService.serviceType, context],
  );

  // Handle showing action detail modal
  const handleShowActionDetail = useCallback(
    async (actionName: string) => {
      if (!actionName) {
        return;
      }

      setIsLoadingActionDetail(true);
      addLog(`获取Action详情: ${actionName}`, "info");

      try {
        const actionDetail = await getActionDetail(
          actionName,
          context,
          config.actionListService.serviceName,
        );
        if (actionDetail) {
          setSelectedActionDetail(actionDetail);
          setShowActionDetail(true);
          addLog(`成功获取Action详情: ${actionName}`, "success");
        } else {
          addLog(`未找到Action详情: ${actionName}`, "error");
        }
      } catch (error: unknown) {
        addLog(
          `获取Action详情失败: ${error instanceof Error ? error.message : "未知错误"}`,
          "error",
        );
      } finally {
        setIsLoadingActionDetail(false);
      }
    },
    [addLog, context, config.actionListService.serviceName],
  );

  const isRecording = state.recordingState === "recording";

  return (
    <div
      style={{
        padding: 16,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflow: "auto",
        position: "relative", // Enable absolute positioning for modal
      }}
    >
      {/* Control section */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          backgroundColor: "#f9fafb",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>录制控制</h3>
          <RecordButton
            onClick={() => {
              addLog("用户点击手动刷新按钮", "info");
              void loadAvailableActions();
            }}
            disabled={isLoadingActions}
            loading={isLoadingActions}
            variant="secondary"
          >
            {isLoadingActions ? "刷新中..." : "手动刷新"}
          </RecordButton>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <DurationInput
            value={state.preparationDuration}
            onChange={(newValue) => {
              addLog(`用户修改触发前时长: ${state.preparationDuration}s -> ${newValue}s`, "info");
              setState((prev) => ({ ...prev, preparationDuration: newValue }));
            }}
            label="触发前数据时长(秒)"
            min={0}
            allowEmpty
            disabled
          />

          <DurationInput
            value={state.recordDuration}
            onChange={(newValue) => {
              addLog(`用户修改录制时长: ${state.recordDuration}s -> ${newValue}s`, "info");
              setState((prev) => ({ ...prev, recordDuration: newValue }));
            }}
            label="触发后数据时长(秒)"
            min={0}
            allowEmpty
            disabled
          />
        </div>
      </div>

      {/* Actions list */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          backgroundColor: "#ffffff",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>
          可用Actions ({availableActions.length} 个)
        </h3>

        {isLoadingActions ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 40,
              color: "#6b7280",
            }}
          >
            加载中...
          </div>
        ) : availableActions.length === 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 40,
              color: "#6b7280",
              textAlign: "center",
            }}
          >
            暂无可用的Actions
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              maxHeight: 400,
            }}
          >
            {availableActions.map((action) => (
              <ActionItem
                key={action.action_name}
                action={action}
                isRecording={isRecording && currentRecordingAction === action.action_name}
                isStartLoading={isStartLoading && currentRecordingAction === action.action_name}
                isStopLoading={isStopLoading && currentRecordingAction === action.action_name}
                onStartRecord={handleStartRecord}
                onStopRecord={handleStopRecord}
                onShowDetail={handleShowActionDetail}
              />
            ))}
          </div>
        )}
      </div>

      {/* Operation log */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          backgroundColor: "#ffffff",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600 }}>操作日志</h3>
        <div
          ref={logContainerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: 8,
            backgroundColor: "#f9fafb",
            fontSize: 12,
            minHeight: 200,
            maxHeight: 400,
          }}
        >
          {state.logs.length === 0 ? (
            <div style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>暂无日志</div>
          ) : (
            state.logs.map((log, index) => (
              <div
                key={index}
                style={{
                  marginBottom: 4,
                  color: getLogColor(log.level),
                  display: "flex",
                  gap: 8,
                }}
              >
                <span style={{ color: "#6b7280" }}>[{log.ts}]</span>
                <span>{log.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Action Detail Modal */}
      <ActionDetailModal
        isOpen={showActionDetail}
        onClose={() => {
          setShowActionDetail(false);
          setSelectedActionDetail(undefined);
        }}
        actionInfo={selectedActionDetail}
      />
    </div>
  );
}

function getLogColor(type: "info" | "success" | "error" | "warn"): string {
  switch (type) {
    case "info":
      return "#374151";
    case "success":
      return "#059669";
    case "error":
      return "#dc2626";
    case "warn":
      return "#f59e0b";
    default:
      return "#374151";
  }
}
