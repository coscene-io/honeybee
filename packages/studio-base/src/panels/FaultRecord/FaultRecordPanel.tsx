// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PanelExtensionContext } from "@foxglove/studio";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { ActionNameSelector, DurationInput, RecordButton } from "./components/ui";
import ActionDetailModal from "./components/ActionDetailModal";
import { defaultConfig } from "./settings";
import { fetchAvailableActions, getActionDetail } from "./services";
import type { PanelState, RecordingState, StartRecordReq, StopRecordReq, ActionNameConfig, ActionInfo } from "./types";
import type { FaultRecordConfig } from "./settings";

import { isEqual } from "lodash";

interface FaultRecordPanelProps {
  context: PanelExtensionContext;
}

export default function FaultRecordPanel({ context }: FaultRecordPanelProps) {
  console.log('[FaultRecordPanel] Component initialized with context:', context);
  
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<FaultRecordConfig>(defaultConfig);
  const [state, setState] = useState<PanelState>({
    recordingState: "idle",
    selectedActionName: "",
    preparationDuration: 30,
    recordDuration: 30,
    logs: [],
  });
  
  console.log('[FaultRecordPanel] Current config state:', JSON.stringify(config, null, 2));
  console.log('[FaultRecordPanel] Current panel state:', JSON.stringify(state, null, 2));
  
  // Add initial log entry
  const [initialLogAdded, setInitialLogAdded] = useState(false);
  const [availableActions, setAvailableActions] = useState<ActionNameConfig[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [isStartLoading, setIsStartLoading] = useState(false);
  const [isStopLoading, setIsStopLoading] = useState(false);
  const [showActionDetail, setShowActionDetail] = useState(false);
  const [selectedActionDetail, setSelectedActionDetail] = useState<ActionInfo | null>(null);
  const [isLoadingActionDetail, setIsLoadingActionDetail] = useState(false);
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
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
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
      addLog(`初始服务配置 - 开始: ${config.startRecordService.serviceName}, 停止: ${config.stopRecordService.serviceName}`, "info");
      addLog(`初始时长配置 - 触发前: ${state.preparationDuration}s, 录制: ${state.recordDuration}s`, "info");
      setInitialLogAdded(true);
    }
  }, [initialLogAdded, addLog, config.startRecordService.serviceName, config.stopRecordService.serviceName, state.preparationDuration, state.recordDuration]);

  // Load available actions
  const loadAvailableActions = useCallback(async () => {
    setIsLoadingActions(true);
    try {
      const actions = await fetchAvailableActions(context);
      setAvailableActions(actions);
      
      // Validate current selection; clear if not available
      setState((prev) => {
        const prevName = prev.selectedActionName;
        if (prevName && !actions.some((action) => action.value === prevName)) {
          addLog(`当前选择的action "${prevName}" 不再可用，已清空选择`, "error");
          return { ...prev, selectedActionName: "" };
        }
        return prev;
      });
      
      // Silent refresh
    } catch (error) {
      addLog(`加载action列表失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsLoadingActions(false);
    }
  }, [addLog, context]);

  // Fetch on mount and every 60s
  useEffect(() => {
    loadAvailableActions();
    const interval = setInterval(() => {
      loadAvailableActions();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadAvailableActions]);

  // Wire onRender to hydrate config and state from renderState
  useEffect(() => {
    console.log('[FaultRecordPanel] Setting up onRender function');
    
    // CRITICAL: Watch extensionData to ensure onRender is called when external config changes
    context.watch("extensionData");
    console.log('[FaultRecordPanel] Watching extensionData for configuration changes');
    
    context.onRender = (renderState: any, done?: () => void) => {
      try {
        console.log('[FaultRecordPanel] onRender called with renderState:', {
          extensionData: renderState?.extensionData,
          config: renderState?.config
        });
        
        const panelConfig = renderState?.extensionData?.panelConfig as FaultRecordConfig | undefined;
        const savedState = renderState?.config as Partial<PanelState> | undefined;
        
        console.log('[FaultRecordPanel] Extracted from renderState:', {
          panelConfig: panelConfig ? JSON.stringify(panelConfig, null, 2) : 'undefined',
          savedState: savedState ? JSON.stringify(savedState, null, 2) : 'undefined'
        });

        // Update the separate config state if needed.
        if (panelConfig) {
          console.log('[FaultRecordPanel] Updating config from panelConfig:', JSON.stringify(panelConfig, null, 2));
          
          // Check for service configuration changes
          const oldStartService = config.startRecordService?.serviceName;
          const newStartService = panelConfig.startRecordService?.serviceName;
          const oldStopService = config.stopRecordService?.serviceName;
          const newStopService = panelConfig.stopRecordService?.serviceName;
          const oldPreparationDuration = config.defaultPreparationDuration;
          const newPreparationDuration = panelConfig.defaultPreparationDuration;
          const oldRecordDuration = config.defaultRecordDuration;
          const newRecordDuration = panelConfig.defaultRecordDuration;
          
          let hasServiceChanges = false;
          let hasDurationChanges = false;
          
          if (oldStartService !== newStartService) {
            addLog(`外部配置更新开始录制服务: "${oldStartService}" -> "${newStartService}"`, "info");
            hasServiceChanges = true;
          }
          if (oldStopService !== newStopService) {
            addLog(`外部配置更新停止录制服务: "${oldStopService}" -> "${newStopService}"`, "info");
            hasServiceChanges = true;
          }
          if (oldPreparationDuration !== newPreparationDuration || oldRecordDuration !== newRecordDuration) {
            hasDurationChanges = true;
          }
          
          // Only log summary if there are actual changes
          if (hasServiceChanges) {
            addLog(`配置更新完成 - 开始录制服务: ${newStartService || 'undefined'}, 停止录制服务: ${newStopService || 'undefined'}`, "info");
          }
          if (hasDurationChanges) {
            addLog(`配置更新完成 - 默认触发前时长: ${newPreparationDuration}s, 默认录制时长: ${newRecordDuration}s`, "info");
          }
          
          setConfig(panelConfig);
        }

        // We can merge all state updates into one call to setState.
        if (panelConfig || (savedState && Object.keys(savedState).length > 0)) {
          hydratingRef.current = true;
          console.log('[FaultRecordPanel] Starting state update process');
          
          setState((prev) => {
            console.log('[FaultRecordPanel] setState callback - previous state:', JSON.stringify(prev, null, 2));
            
            // Start with the previous state.
            let nextState = { ...prev };

            // Apply savedState first.
            if (savedState) {
              console.log('[FaultRecordPanel] Applying savedState:', JSON.stringify(savedState, null, 2));
              nextState = { ...nextState, ...savedState };
            }

            // Apply data from the host, overwriting what was in savedState.
            if (panelConfig) {
              console.log('[FaultRecordPanel] Applying panelConfig to state');
              // Update the durations with type checking (without duplicate logging)
              if (typeof (panelConfig as any).defaultPreparationDuration === "number") {
                const newValue = (panelConfig as any).defaultPreparationDuration;
                console.log('[FaultRecordPanel] Updating preparationDuration to', newValue);
                nextState.preparationDuration = newValue;
              }
              if (typeof (panelConfig as any).defaultRecordDuration === "number") {
                const newValue = (panelConfig as any).defaultRecordDuration;
                console.log('[FaultRecordPanel] Updating recordDuration to', newValue);
                nextState.recordDuration = newValue;
              }
            }
            
            console.log('[FaultRecordPanel] Final nextState:', JSON.stringify(nextState, null, 2));
            return nextState;
          });
        }
        
        // CRITICAL: Call done() to notify PanelExtensionAdapter that rendering is complete
        if (done) {
          console.log('[FaultRecordPanel] Calling done() to complete render cycle');
          done();
        }
      } catch (error) {
        console.error('[FaultRecordPanel] Error in onRender:', error);
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
  }, [context, setState, setConfig]);

  // Persist panel state into layout via saveState; avoid saving during hydration
  useEffect(() => {
    const save = (context as any)?.saveState as undefined | ((s: PanelState) => void);
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
  const handleStartRecord = useCallback(async () => {
    if (state.preparationDuration < 0) {
      addLog("触发前数据时长不能小于0", "error");
      return;
    }

    if (!state.selectedActionName) {
      addLog("请选择要录制的Action", "error");
      return;
    }

    setIsStartLoading(true);
    addLog(`开始录制 - Action: ${state.selectedActionName}, Service: ${config.startRecordService.serviceName}`);
    addLog(`开始录制参数 - 触发前时长: ${state.preparationDuration}s, 录制时长: ${state.recordDuration}s`, "info");
    addLog(`实际调用服务: ${config.startRecordService.serviceName} (类型: ${config.startRecordService.serviceType})`, "info");

    try {
      const req: StartRecordReq = {
        action_name: state.selectedActionName,
        preparation_duration_s: state.preparationDuration,
        record_duration_s: state.recordDuration,
      };
      addLog(`发送请求参数: ${JSON.stringify(req)}`, "info");

      // Fire-and-forget service call - ONLY REAL SERVICE
      if (context?.callService) {
        addLog(`使用 context.callService 调用真实服务: ${config.startRecordService.serviceName}`, "info");
        context
          .callService(config.startRecordService.serviceName, req)
          .then((response: any) => {
            const code = typeof response?.code === "number" ? response.code : -1;
            const msg = typeof response?.msg === "string" ? response.msg : "Unknown response";
            if (code === 0) {
              setState((prev) => ({ ...prev, recordingState: "recording" }));
              addLog(msg, "success");
            } else {
              setState((prev) => ({ ...prev, recordingState: "idle" }));
              addLog(`录制失败: ${msg}`, "error");
            }
          })
          .catch((error: any) => {
            setState((prev) => ({ ...prev, recordingState: "idle" }));
            addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
          });
      } else {
        addLog("录制失败: context.callService 未定义，无法调用真实服务", "error");
        setIsStartLoading(false);
        return;
      }
      // MOCK SERVICE CALLS COMMENTED OUT FOR REAL SERVICE TESTING
      // } else if ((context as any).mockService?.startRecord) {
      //   addLog(`使用 mockService.startRecord 调用模拟服务`, "info");
      //   (context as any).mockService.startRecord(req)
      //     .then((response: any) => {
      //       const code = typeof response?.code === "number" ? response.code : -1;
      //       const msg = typeof response?.msg === "string" ? response.msg : "Unknown response";
      //       if (code === 0) {
      //         setState((prev) => ({ ...prev, recordingState: "recording" }));
      //         addLog(msg, "success");
      //       } else {
      //         setState((prev) => ({ ...prev, recordingState: "idle" }));
      //         addLog(`录制失败: ${msg}`, "error");
      //       }
      //     })
      //     .catch((error: any) => {
      //       setState((prev) => ({ ...prev, recordingState: "idle" }));
      //       addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      //     });
      // } else {
      //   addLog("录制失败: context.callService 和 mockService.startRecord 均未定义", "error");
      //   setIsStartLoading(false);
      //   return;
      // }
      addLog("录制请求已发送，可以继续选择其他action进行录制", "info");
      
    } catch (error) {
      setState((prev) => ({ ...prev, recordingState: "idle" }));
      addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsStartLoading(false);
    }
  }, [state.selectedActionName, state.preparationDuration, state.recordDuration, addLog, config.startRecordService.serviceName, context]);

  // Stop record (async)
  const handleStopRecord = useCallback(async () => {
    if (!state.selectedActionName) {
      addLog("请选择要停止的Action", "error");
      return;
    }

    setIsStopLoading(true);
    addLog(`停止录制 - Action: ${state.selectedActionName}, Service: ${config.stopRecordService.serviceName}`);
    addLog(`实际调用服务: ${config.stopRecordService.serviceName} (类型: ${config.stopRecordService.serviceType})`, "info");

    try {
      const req: StopRecordReq = {
        action_name: state.selectedActionName,
      };
      addLog(`发送停止请求参数: ${JSON.stringify(req)}`, "info");

      // Fire-and-forget service call - ONLY REAL SERVICE
      if (context?.callService) {
        addLog(`使用 context.callService 调用真实停止服务: ${config.stopRecordService.serviceName}`, "info");
        context
          .callService(config.stopRecordService.serviceName, req)
          .then((response: any) => {
            const code = typeof response?.code === "number" ? response.code : -1;
            const msg = typeof response?.msg === "string" ? response.msg : "Unknown response";
            if (code === 0) {
              setState((prev) => ({ ...prev, recordingState: "idle" }));
              addLog(msg, "success");
            } else {
              addLog(`停止失败: ${msg}`, "error");
            }
          })
          .catch((error: any) => {
            addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
          });
      } else {
        addLog("停止失败: context.callService 未定义，无法调用真实服务", "error");
        setIsStopLoading(false);
        return;
      }
      // MOCK SERVICE CALLS COMMENTED OUT FOR REAL SERVICE TESTING
      // } else if ((context as any).mockService?.stopRecord) {
      //   addLog(`使用 mockService.stopRecord 调用模拟停止服务`, "info");
      //   (context as any).mockService.stopRecord(req)
      //     .then((response: any) => {
      //       const code = typeof response?.code === "number" ? response.code : -1;
      //       const msg = typeof response?.msg === "string" ? response.msg : "Unknown response";
      //       if (code === 0) {
      //         setState((prev) => ({ ...prev, recordingState: "idle" }));
      //         addLog(msg, "success");
      //       } else {
      //         addLog(`停止失败: ${msg}`, "error");
      //       }
      //     })
      //     .catch((error: any) => {
      //       addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      //     });
      // } else {
      //   addLog("停止失败: context.callService 和 mockService.stopRecord 均未定义", "error");
      //   setIsStopLoading(false);
      //   return;
      // }
      addLog("停止录制请求已发送", "info");
      
    } catch (error) {
      addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsStopLoading(false);
    }
  }, [state.selectedActionName, addLog, config.stopRecordService.serviceName, context]);

  // Handle showing action detail modal
  const handleShowActionDetail = useCallback(async (actionName: string) => {
    if (!actionName) return;
    
    setIsLoadingActionDetail(true);
    addLog(`获取Action详情: ${actionName}`, "info");
    
    try {
      const actionDetail = await getActionDetail(actionName, context);
      if (actionDetail) {
        setSelectedActionDetail(actionDetail);
        setShowActionDetail(true);
        addLog(`成功获取Action详情: ${actionName}`, "success");
      } else {
        addLog(`未找到Action详情: ${actionName}`, "error");
      }
    } catch (error) {
      addLog(`获取Action详情失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsLoadingActionDetail(false);
    }
  }, [addLog, context]);

  const isRecording = state.recordingState === "recording";
  const canStart = !isStartLoading && availableActions.length > 0;
  const canStop = !isStopLoading && availableActions.length > 0;

  return (
    <div style={{ 
      padding: 16, 
      height: "100%", 
      display: "flex", 
      flexDirection: "column", 
      gap: 16, 
      overflow: "auto",
      position: "relative" // Enable absolute positioning for modal
    }}>
      {/* Control section */}
      <div style={{ 
        border: "1px solid #e5e7eb", 
        borderRadius: 8, 
        padding: 16, 
        backgroundColor: isRecording ? "#fef2f2" : "#f9fafb" 
      }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600 }}>录制控制</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Action Name ({availableActions.length} 个可用)
            </label>
            <ActionNameSelector
              value={state.selectedActionName}
              onChange={(v) => {
                addLog(`用户选择Action: "${v}" (之前选择: "${state.selectedActionName}")`, "info");
                setState((prev) => ({ ...prev, selectedActionName: v }));
                // Auto show action detail when user selects an action
                if (v && v !== state.selectedActionName) {
                  handleShowActionDetail(v);
                }
              }}
              options={availableActions}
              disabled={isLoadingActions || isLoadingActionDetail}
            />
          </div>
          
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
        
        <div style={{ display: "flex", gap: 12 }}>
          <RecordButton
            onClick={() => {
              addLog(`用户点击开始录制按钮 - 当前选择Action: "${state.selectedActionName}"`, "info");
              addLog(`按钮状态检查 - canStart: ${canStart}, isStartLoading: ${isStartLoading}`, "info");
              handleStartRecord();
            }}
            disabled={!canStart}
            loading={isStartLoading}
            variant="primary"
          >
            {isStartLoading ? "启动中..." : "开始录制"}
          </RecordButton>
          
          <RecordButton
            onClick={() => {
              addLog(`用户点击停止录制按钮 - 当前选择Action: "${state.selectedActionName}"`, "info");
              addLog(`按钮状态检查 - canStop: ${canStop}, isStopLoading: ${isStopLoading}`, "info");
              handleStopRecord();
            }}
            disabled={!canStop}
            loading={isStopLoading}
            variant="danger"
          >
            {isStopLoading ? "停止中..." : "停止录制"}
          </RecordButton>
        </div>
      </div>

      {/* Operation log */}
      <div style={{ 
        border: "1px solid #e5e7eb", 
        borderRadius: 8, 
        padding: 16, 
        backgroundColor: "#ffffff",
        flex: 1,
        display: "flex",
        flexDirection: "column"
      }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600 }}>操作日志</h3>
        <div ref={logContainerRef} style={{ 
          flex: 1, 
          overflowY: "auto", 
          overflowX: "auto",
          border: "1px solid #e5e7eb", 
          borderRadius: 6, 
          padding: 8,
          backgroundColor: "#f9fafb",
          fontSize: 12,
          minHeight: 200,
          maxHeight: 400
        }}>
          {state.logs.length === 0 ? (
            <div style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>
              暂无日志
            </div>
          ) : (
            state.logs.map((log, index) => (
              <div key={index} style={{
                marginBottom: 4,
                color: getLogColor(log.level),
                display: "flex",
                gap: 8
              }}>
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
          setSelectedActionDetail(null);
        }}
        actionInfo={selectedActionDetail}
      />
    </div>
  );
}

function getStatusColor(status: RecordingState): string {
  switch (status) {
    case "idle":
      return "#6b7280";
    case "starting":
      return "#f59e0b";
    case "recording":
      return "#ef4444";
    case "stopping":
      return "#f59e0b";
    default:
      return "#6b7280";
  }
}

function getStatusText(status: RecordingState): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "starting":
      return "启动中";
    case "recording":
      return "录制中";
    case "stopping":
      return "停止中";
    default:
      return "未知状态";
  }
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