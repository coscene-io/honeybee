// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PanelExtensionContext } from "@foxglove/studio";
import React, { useCallback, useEffect, useState } from "react";

import { ActionNameSelector, DurationInput, RecordButton } from "./components/ui";
import { mockService } from "./mockService";
import { defaultConfig } from "./settings";
import { fetchAvailableActions, refreshActionNames } from "./services";
import type { PanelState, RecordingState, StartRecordReq, StopRecordReq, ActionNameConfig } from "./types";
import type { FaultRecordConfig } from "./settings";

interface FaultRecordPanelProps {
  context: PanelExtensionContext;
}

export default function FaultRecordPanel({ context }: FaultRecordPanelProps) {
  const [config, setConfig] = useState<FaultRecordConfig>(defaultConfig);
  const [state, setState] = useState<PanelState>({
    recordingState: "idle",
    selectedActionName: "",
    preparationDuration: 30,
    recordDuration: 30,
    logs: [],
  });
  const [availableActions, setAvailableActions] = useState<ActionNameConfig[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [startActionName, setStartActionName] = useState<string>("");
  const [stopActionName, setStopActionName] = useState<string>("");
  const [preparationDuration, setPreparationDuration] = useState<number>(config.defaultPreparationDuration);
  const [recordDuration, setRecordDuration] = useState<number>(config.defaultRecordDuration);
  const [isStartLoading, setIsStartLoading] = useState(false);
  const [isStopLoading, setIsStopLoading] = useState(false);
  const [canSelectActions, setCanSelectActions] = useState(true);



  // 添加日志
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
      ].slice(-50), // 保留最近50条日志
    }));
  }, []);

  // 初始化加载可用的action列表
  const loadAvailableActions = useCallback(async () => {
    setIsLoadingActions(true);
    try {
      const actions = await fetchAvailableActions();
      setAvailableActions(actions);
      
      // 检查当前选择的action是否还在新列表中，如果不在则清空选择
      setStartActionName(prev => {
        if (prev && !actions.some(action => action.value === prev)) {
          addLog(`当前选择的开始action "${prev}" 不再可用，已清空选择`, "error");
          return "";
        }
        return prev;
      });
      
      setStopActionName(prev => {
        if (prev && !actions.some(action => action.value === prev)) {
          addLog(`当前选择的停止action "${prev}" 不再可用，已清空选择`, "error");
          return "";
        }
        return prev;
      });
      
      // 静默加载action列表，不打印日志
    } catch (error) {
      addLog(`加载action列表失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsLoadingActions(false);
    }
  }, [addLog]);

  // 组件初始化时加载action列表，并设置定时器每分钟查询一次
  useEffect(() => {
    // 初始加载
    loadAvailableActions();
    
    // 设置定时器，每分钟查询一次
    const interval = setInterval(() => {
      loadAvailableActions();
    }, 60000); // 60秒 = 60000毫秒
    
    // 清理定时器
    return () => {
      clearInterval(interval);
    };
  }, [loadAvailableActions]);

  // 监听配置变化
  useEffect(() => {
    const updateConfig = () => {
      const panelConfig = context.initialState as FaultRecordConfig;
      if (panelConfig && Object.keys(panelConfig).length > 0) {
        setConfig(panelConfig);
        // 更新默认时长值
        setPreparationDuration(panelConfig.defaultPreparationDuration);
        setRecordDuration(panelConfig.defaultRecordDuration);
      }
    };
    
    updateConfig();
    context.onRender = updateConfig;
    
    return () => {
      context.onRender = undefined;
    };
  }, [context]);

  // 开始录制 - 支持异步录制
  const handleStartRecord = useCallback(async () => {
    if (preparationDuration < 0) {
      addLog("触发前数据时长不能小于0", "error");
      return;
    }

    if (!startActionName) {
      addLog("请选择要录制的Action", "error");
      return;
    }

    setIsStartLoading(true);
    addLog(`开始录制 - Action: ${startActionName}, Service: ${config.startRecordService.serviceName}`);

    try {
      const req: StartRecordReq = {
        action_name: startActionName,
        preparation_duration_s: preparationDuration,
        record_duration_s: recordDuration,
      };

      // 异步执行录制，不阻塞UI
      mockService.startRecord(req).then((response) => {
        if (response.code === 0) {
          setState((prev) => ({ ...prev, recordingState: "recording" }));
          addLog(response.msg, "success");
          // 录制开始后，允许选择其他action进行新的录制
          setCanSelectActions(true);
        } else {
          setState((prev) => ({ ...prev, recordingState: "idle" }));
          addLog(`录制失败: ${response.msg}`, "error");
        }
      }).catch((error) => {
        setState((prev) => ({ ...prev, recordingState: "idle" }));
        addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      });

      // 立即设置为录制状态，允许继续操作
      setState((prev) => ({ ...prev, recordingState: "recording" }));
      addLog("录制请求已发送，可以继续选择其他action进行录制", "info");
      
    } catch (error) {
      setState((prev) => ({ ...prev, recordingState: "idle" }));
      addLog(`录制失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsStartLoading(false);
    }
  }, [startActionName, preparationDuration, recordDuration, addLog]);

  // 停止录制 - 支持异步处理
  const handleStopRecord = useCallback(async () => {
    if (!stopActionName) {
      addLog("请选择要停止的Action", "error");
      return;
    }

    setIsStopLoading(true);
    addLog(`停止录制 - Action: ${stopActionName}, Service: ${config.stopRecordService.serviceName}`);

    try {
      const req: StopRecordReq = {
        action_name: stopActionName,
      };

      // 异步执行停止录制
      mockService.stopRecord(req).then((response) => {
        if (response.code === 0) {
          addLog(response.msg, "success");
        } else {
          addLog(`停止失败: ${response.msg}`, "error");
        }
      }).catch((error) => {
        addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
      });

      addLog("停止录制请求已发送", "info");
      
    } catch (error) {
      addLog(`停止失败: ${error instanceof Error ? error.message : "未知错误"}`, "error");
    } finally {
      setIsStopLoading(false);
    }
  }, [stopActionName, addLog]);

  const isRecording = state.recordingState === "recording";
  const canStart = !isStartLoading && availableActions.length > 0;
  const canStop = !isStopLoading && availableActions.length > 0;

  return (
    <div style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
      {/* 开始录制区域 */}
      <div style={{ 
        border: "1px solid #e5e7eb", 
        borderRadius: 8, 
        padding: 16, 
        backgroundColor: "#f9fafb" 
      }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600 }}>开始录制</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Action Name ({availableActions.length} 个可用)
            </label>
            <ActionNameSelector
              value={startActionName}
              onChange={setStartActionName}
              options={availableActions}
              disabled={!canStart || isLoadingActions}
            />
          </div>
          
          <DurationInput
            value={preparationDuration}
            onChange={setPreparationDuration}
            label="触发前数据时长(秒)"
            min={0}
            allowEmpty
            disabled={!canStart}
          />
          
          <DurationInput
            value={recordDuration}
            onChange={setRecordDuration}
            label="触发后数据时长(秒)"
            min={0}
            allowEmpty
            disabled={!canStart}
          />
        </div>
        
        <RecordButton
          onClick={handleStartRecord}
          disabled={!canStart}
          loading={isStartLoading}
          variant="primary"
        >
          {isStartLoading ? "启动中..." : "开始录制"}
        </RecordButton>
      </div>

      {/* 停止录制区域 */}
      <div style={{ 
        border: "1px solid #e5e7eb", 
        borderRadius: 8, 
        padding: 16, 
        backgroundColor: isRecording ? "#fef2f2" : "#f9fafb" 
      }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600 }}>停止录制</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Action Name
            </label>
            <ActionNameSelector
              value={stopActionName}
              onChange={setStopActionName}
              options={availableActions}
              disabled={!canStop || isLoadingActions}
            />
          </div>
          
          <div style={{ display: "flex", alignItems: "end" }}>
            <RecordButton
              onClick={handleStopRecord}
              disabled={!canStop}
              loading={isStopLoading}
              variant="danger"
            >
              {isStopLoading ? "停止中..." : "停止录制"}
            </RecordButton>
          </div>
        </div>
      </div>

      {/* 操作日志 */}
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
        <div style={{ 
          flex: 1, 
          overflowY: "auto", 
          overflowX: "auto",
          border: "1px solid #e5e7eb", 
          borderRadius: 6, 
          padding: 8,
          backgroundColor: "#f9fafb",
          fontFamily: "monospace",
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