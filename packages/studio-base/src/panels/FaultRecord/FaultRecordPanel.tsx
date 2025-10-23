// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React, { useCallback, useEffect, useRef, useState } from "react";

import { PanelExtensionContext } from "@foxglove/studio";

import ActionDetailModal from "./components/ActionDetailModal";
import { ActionItem, RecordButton } from "./components/ui";
import { fetchAvailableActionsWithInfo, getActionDetail } from "./services";
import { defaultConfig, type FaultRecordConfig } from "./settings";
import type {
  ActionInfo,
  ActionDurationConfig,
  PanelState,
  StartRecordReq,
  StopRecordReq,
} from "./types";

interface FaultRecordPanelProps {
  context: PanelExtensionContext;
}

export default function FaultRecordPanel({ context }: FaultRecordPanelProps): React.JSX.Element {
  const logContainerRef = useRef<HTMLDivElement>(null); // eslint-disable-line no-restricted-syntax
  const [config, setConfig] = useState<FaultRecordConfig>(defaultConfig);
  const [state, setState] = useState<PanelState>({
    recordingState: "idle",
    selectedActionName: "",
    actionDurations: {}, // Action特定的duration配置
    logs: [],
    recordingTimers: {}, // 录制定时器，用于录制结束提醒
    actionRecordingStates: {}, // 每个Action的录制状态
  });

  // Add initial log entry
  const [initialLogAdded, setInitialLogAdded] = useState(false);
  const [availableActions, setAvailableActions] = useState<ActionInfo[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [showActionDetail, setShowActionDetail] = useState(false);
  const [selectedActionDetail, setSelectedActionDetail] = useState<ActionInfo | undefined>(
    undefined,
  );
  const [_isLoadingActionDetail, setIsLoadingActionDetail] = useState(false);
  const hydratingRef = useRef(false);
  const stateRef = useRef(state);

  // 同步 stateRef
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 获取action特定的duration配置
  const getActionDurations = useCallback(
    (actionName: string) => {
      const actionConfig = state.actionDurations[actionName];
      if (!actionConfig) {
        // 如果没有配置，返回默认值（这种情况不应该发生，因为我们在加载时初始化了所有Action）
        return {
          preparationDuration: 30,
          recordDuration: 30,
        };
      }
      return {
        preparationDuration: actionConfig.preparationDuration,
        recordDuration: actionConfig.recordDuration,
      };
    },
    [state.actionDurations],
  );

  // 更新action特定的duration配置
  const updateActionDurations = useCallback(
    (actionName: string, durations: ActionDurationConfig) => {
      setState((prev) => ({
        ...prev,
        actionDurations: {
          ...prev.actionDurations,
          [actionName]: durations,
        },
      }));
    },
    [],
  );

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
      addLog("FaultRecord面板已初始化", "info");
      setInitialLogAdded(true);
    }
  }, [initialLogAdded, addLog]);

  // Load available actions
  const loadAvailableActions = useCallback(async () => {
    setIsLoadingActions(true);
    try {
      const actions = await fetchAvailableActionsWithInfo(
        context,
        config.actionListService.serviceName,
      );
      setAvailableActions(actions);

      // Initialize action durations with backend default values and validate current selection
      setState((prev) => {
        const newActionDurations: Record<string, ActionDurationConfig> = {
          ...prev.actionDurations,
        };

        // For each action, set default durations from backend if not already configured
        actions.forEach((action: ActionInfo) => {
          if (!newActionDurations[action.action_name]) {
            newActionDurations[action.action_name] = {
              preparationDuration: action.preparation_duration_s,
              recordDuration: action.record_duration_s,
            };
          }
        });

        // Validate current selection; clear if not available
        const prevName = prev.selectedActionName;
        if (prevName && !actions.some((action: ActionInfo) => action.action_name === prevName)) {
          addLog(`Action "${prevName}" 不再可用，已清空选择`, "error");
          return { ...prev, selectedActionName: "", actionDurations: newActionDurations };
        }

        return { ...prev, actionDurations: newActionDurations };
      });

      addLog(`成功加载 ${actions.length} 个可用Action`, "success");
    } catch (error: unknown) {
      addLog(`加载action列表失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      setAvailableActions([]);
    } finally {
      setIsLoadingActions(false);
    }
  }, [addLog, context, config.actionListService.serviceName]);

  // Fetch on mount only - 使用 useRef 确保只在组件挂载时调用一次
  const hasLoadedActions = useRef(false);
  useEffect(() => {
    if (!hasLoadedActions.current) {
      hasLoadedActions.current = true;
      void loadAvailableActions();
    }
  }, [loadAvailableActions]); // 添加 loadAvailableActions 依赖

  // 组件卸载时清理所有定时器
  useEffect(() => {
    // 仅在组件卸载时清理所有存活的定时器
    return () => {
      const timers = Object.values(stateRef.current.recordingTimers ?? {});
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
    };
  }, []); // 不要加依赖

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
          // Service configuration changes are handled silently

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
              // No default duration configuration needed anymore
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
  const handleStartRecord = async (actionName: string) => {
    if (!actionName) {
      addLog("请选择要录制的Action", "error");
      return;
    }

    // 检查该Action是否已经在录制中
    if (stateRef.current.actionRecordingStates[actionName] === true) {
      addLog(`Action: ${actionName} 录制已在进行中，请先停止录制`, "error");
      console.debug(
        `[DEBUG] Action ${actionName} 录制状态:`,
        stateRef.current.actionRecordingStates[actionName],
      );
      console.debug(`[DEBUG] 当前所有录制状态:`, stateRef.current.actionRecordingStates);
      return;
    }

    // 获取action特定的duration配置
    const durations = getActionDurations(actionName);

    if (durations.preparationDuration < 0) {
      addLog("触发前数据时长不能小于0", "error");
      return;
    }

    addLog(`开始录制 - Action: ${actionName}`);

    try {
      const req: StartRecordReq = {
        action_name: actionName,
        preparation_duration_s: durations.preparationDuration,
        record_duration_s: durations.recordDuration,
      };
      // Fire-and-forget service call - ONLY REAL SERVICE
      if (context.callService) {
        context
          .callService(config.startRecordService.serviceName, req)
          .then((response: unknown) => {
            const responseObj = response as { code?: number; msg?: string };
            const code = typeof responseObj.code === "number" ? responseObj.code : -1;
            const msg = typeof responseObj.msg === "string" ? responseObj.msg : "Unknown response";
            if (code === 0) {
              addLog(`录制开始成功: ${msg}`, "success");

              // 启动录制结束定时器，用于提醒用户录制已完成
              console.log(
                `[DEBUG] 创建定时器 - Action: ${actionName}, 时长: ${durations.recordDuration}秒`,
              );

              // 立即捕获所有需要的变量和函数，避免闭包问题
              const currentActionName = actionName;
              const currentRecordDuration = durations.recordDuration;
              const currentAddLog = addLog;
              const currentSetState = setState;

              console.log(
                `[DEBUG] 准备创建定时器 - Action: ${currentActionName}, 时长: ${currentRecordDuration}秒`,
              );

              const timerId = setTimeout(() => {
                console.log(`[DEBUG] 定时器到期 - Action: ${currentActionName}`);

                currentAddLog(
                  `🔴 录制已结束 - Action: ${currentActionName}，录制时长: ${currentRecordDuration}秒，请检查数据`,
                  "error",
                );

                // 录制结束，更新状态
                currentSetState((prev) => {
                  console.log(
                    `[DEBUG] 更新状态 - Action: ${currentActionName}, 当前状态:`,
                    prev.actionRecordingStates[currentActionName],
                  );
                  const newTimers = { ...prev.recordingTimers };
                  delete newTimers[currentActionName];
                  return {
                    ...prev,
                    actionRecordingStates: {
                      ...prev.actionRecordingStates,
                      [currentActionName]: false,
                    },
                    recordingTimers: newTimers,
                  };
                });
              }, currentRecordDuration * 1000);

              console.log(
                `[DEBUG] 定时器已创建 - Action: ${currentActionName}, TimerID: ${timerId}`,
              );

              // 立即保存定时器ID和录制状态，避免异步覆盖
              setState((prev) => {
                console.log(
                  `[DEBUG] 保存定时器 - Action: ${currentActionName}, 当前定时器:`,
                  Object.keys(prev.recordingTimers),
                );
                const newTimers = { ...prev.recordingTimers };
                newTimers[currentActionName] = timerId;
                return {
                  ...prev,
                  recordingTimers: newTimers,
                  actionRecordingStates: {
                    ...prev.actionRecordingStates,
                    [currentActionName]: true,
                  },
                };
              });
            } else {
              addLog(`录制开始失败: ${msg}`, "error");
            }
          })
          .catch((error: unknown) => {
            addLog(`录制开始异常: ${error instanceof Error ? error.message : "未知错误"}`, "error");
          });
      } else {
        addLog("录制失败: 服务不可用", "error");
        return;
      }
    } catch (error: unknown) {
      addLog(`录制开始异常: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    }
  };

  // Stop record (async)
  const handleStopRecord = useCallback(
    async (actionName: string) => {
      if (!actionName) {
        addLog("请选择要停止的Action", "error");
        return;
      }

      addLog(`停止录制 - Action: ${actionName}`);

      // 检查该Action是否在录制中
      const isRecording = stateRef.current.actionRecordingStates[actionName];

      // 清理该Action的录制结束定时器
      const existingTimer = stateRef.current.recordingTimers[actionName];
      if (existingTimer) {
        clearTimeout(existingTimer);
        setState((prev) => {
          const newTimers = { ...prev.recordingTimers };
          delete newTimers[actionName];
          return {
            ...prev,
            recordingTimers: newTimers,
            actionRecordingStates: {
              ...prev.actionRecordingStates,
              [actionName]: false,
            },
          };
        });
      }

      try {
        const req: StopRecordReq = {
          action_name: actionName,
        };
        // Fire-and-forget service call - ONLY REAL SERVICE
        if (context.callService) {
          context
            .callService(config.stopRecordService.serviceName, req)
            .then((response: unknown) => {
              const responseObj = response as { code?: number; msg?: string };
              const code = typeof responseObj.code === "number" ? responseObj.code : -1;
              const msg =
                typeof responseObj.msg === "string" ? responseObj.msg : "Unknown response";
              if (code === 0) {
                if (isRecording === true) {
                  addLog(`停止录制成功: ${msg}`, "success");
                } else {
                  addLog(`Action: ${actionName} 并未在录制中，请继续操作`, "error");
                }
              } else {
                addLog(`停止录制失败: ${msg}`, "error");
              }
            })
            .catch((error: unknown) => {
              addLog(
                `停止录制异常: ${error instanceof Error ? error.message : "未知错误"}`,
                "error",
              );
            });
        } else {
          addLog("停止失败: 服务不可用", "error");
          return;
        }
      } catch (error: unknown) {
        addLog(`停止录制异常: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      }
    },
    [addLog, config.stopRecordService.serviceName, context],
  );

  // Handle showing action detail modal
  const handleShowActionDetail = useCallback(
    async (actionName: string) => {
      if (!actionName) {
        return;
      }

      setIsLoadingActionDetail(true);

      try {
        const actionDetail = await getActionDetail(
          actionName,
          context,
          config.actionListService.serviceName,
        );
        if (actionDetail) {
          setSelectedActionDetail(actionDetail);
          setShowActionDetail(true);
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
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>录制控制</h3>
          <RecordButton
            onClick={() => {
              void loadAvailableActions();
            }}
            disabled={isLoadingActions}
            loading={isLoadingActions}
            variant="secondary"
          >
            {isLoadingActions ? "刷新中..." : "手动刷新"}
          </RecordButton>
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
                isRecording={false}
                isStartLoading={false}
                isStopLoading={false}
                durations={getActionDurations(action.action_name)}
                onStartRecord={handleStartRecord}
                onStopRecord={handleStopRecord}
                onShowDetail={handleShowActionDetail}
                onUpdateDurations={updateActionDurations}
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
