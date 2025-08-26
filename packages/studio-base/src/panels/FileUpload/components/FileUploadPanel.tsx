// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";

import { PanelExtensionContext } from "@foxglove/studio";
import { MockBagService } from "../services/mockBagService";
import { MockCoSceneClient, RealCoSceneClient } from "../services/coscene";
import { MockRosService, RealRosService } from "../services/ros";
import type { BagFile } from "../types";
import type { Config } from "../config/types";

interface LogLine {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
}

// 简单的Button组件
function Button({
  onClick,
  disabled,
  variant = "primary",
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  children: React.ReactNode;
}) {
  const baseStyles: React.CSSProperties = {
    borderRadius: '12px',
    fontWeight: 500,
    transition: 'all 0.2s ease',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: 'none',
    outline: 'none',
    padding: '6px 12px',
    fontSize: '14px',
    minHeight: '32px',
  };
  
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#ffffff',
      color: '#000000',
      border: '1px solid #d1d5db',
    },
    ghost: {
      backgroundColor: '#ffffff',
      color: '#374151',
      border: '1px solid #d1d5db',
    },
    danger: {
      backgroundColor: '#dc2626',
      color: '#ffffff',
    },
  };
  
  const combinedStyles = {
    ...baseStyles,
    ...variantStyles[variant],
  };
  
  return (
    <button 
      onClick={onClick} 
      disabled={disabled} 
      style={combinedStyles}
    >
      {children}
    </button>
  );
}

interface FileUploadPanelProps {
  config: Config;
  context: PanelExtensionContext;
  serviceSettings: { getBagListService: string; submitFilesService: string };
  refreshButtonServiceName: string;
}

// Service工厂函数
function createBagService(serviceType: string) {
  switch (serviceType) {
    case "mock":
      return new MockBagService();
    case "coscene-mock":
      return new MockCoSceneClient();
    case "coscene-real":
      return new RealCoSceneClient();
    case "ros-mock":
      return new MockRosService();
    case "ros-real":
      return new RealRosService();
    default:
      return new MockBagService();
  }
}

export function FileUploadPanel({ config, context, serviceSettings, refreshButtonServiceName }: FileUploadPanelProps) {
  const bagServiceRef = useRef<any>(createBagService(serviceSettings.getBagListService || "mock"));
  
  // 当service配置改变时，重新创建service实例
  useEffect(() => {
    bagServiceRef.current = createBagService(serviceSettings.getBagListService || "mock");
  }, [serviceSettings.getBagListService]);
  
  const [phase, setPhase] = useState<"idle" | "loading" | "loaded">("idle");
  const [bagFiles, setBagFiles] = useState<BagFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogLine[]>([]);
  

  
  // 过滤条件
  const [selectedMode, setSelectedMode] = useState<string>(""); // "" | "imd" | "signal"
  const [selectedActionName, setSelectedActionName] = useState<string>(""); // "" 或具体action名称
  
  // 获取所有可用的action_name选项
  const availableActionNames = useMemo(() => {
    return bagServiceRef.current.getUniqueActionNames();
  }, []);

  const log = useCallback((level: LogLine["level"], msg: string) => {
    setLogs((xs) => [...xs, { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), ts: new Date().toLocaleTimeString(), level, msg }]);
  }, []);

  // 获取文件列表
  const onGetBagList = useCallback(async () => {
    try {
      setPhase("loading");
      setSelectedPaths(new Set()); // 清空之前的选择状态
      log("info", `获取文件列表：mode=${selectedMode || '全部'}, action_name=${selectedActionName || '全部'}`);
      
      const result = await bagServiceRef.current.getBagList({
        mode: selectedMode,
        action_name: selectedActionName
      });
      
      if (result.code === 0) {
        setBagFiles(result.bags);
        setPhase("loaded");
        log("info", `获取到 ${result.bags.length} 个文件`);
      } else {
        setPhase("idle");
        log("error", `获取文件列表失败：${result.msg}`);
      }
    } catch (e: any) {
      setPhase("idle");
      log("error", `获取文件列表失败：${e?.message || e}`);
    }
  }, [selectedMode, selectedActionName, log]);

  // 切换文件选择状态
  const toggleFileSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // 上传选中的文件
  const onUploadFiles = useCallback(async () => {
    if (selectedPaths.size === 0) {
      log("error", "请选择要上传的文件");
      return;
    }

    try {
      const pathsArray = Array.from(selectedPaths);
      log("info", `开始上传 ${pathsArray.length} 个文件`);
      
      const result = await bagServiceRef.current.submitFiles({
        paths: pathsArray
      });
      
      if (result.code === 0) {
        log("info", "文件上传成功");
      } else {
        log("error", `文件上传失败：${result.msg}`);
      }
    } catch (e: any) {
      log("error", `文件上传失败：${e?.message || e}`);
    }
  }, [selectedPaths, log]);

  // 获取文件名（从路径中提取）
  const getFileName = useCallback((path: string) => {
    return path.split('/').pop() || path;
  }, []);

  return (
    <div style={{ 
      padding: 16, 
      fontFamily: 'system-ui, sans-serif',
      height: '100%',
      overflow: 'auto',
      maxHeight: '100vh'
    }}>
      <div style={{ 
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        minWidth: '600px'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 16
        }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Bag文件管理</div>
        </div>

        {/* 过滤条件 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>模式:</label>
              <select 
                value={selectedMode} 
                onChange={(e) => setSelectedMode(e.target.value)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 14
                }}
              >
                <option value="">全部数据</option>
                <option value="imd">imd (持续录制)</option>
                <option value="signal">signal (触发录制)</option>
              </select>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>Action Name:</label>
              <select 
                value={selectedActionName} 
                onChange={(e) => setSelectedActionName(e.target.value)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 14
                }}
              >
                <option value="">全部数据</option>
                {availableActionNames.map((name: string) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            
            <Button 
              variant="primary" 
              onClick={onGetBagList} 
              disabled={phase === "loading"}
            >
              {phase === "loading" ? "刷新中..." : "刷新"}
            </Button>
          </div>
        </div>

        {/* 文件列表表格 */}
        {phase === "loaded" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ 
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              overflow: 'auto',
              maxHeight: '400px'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: 14, fontWeight: 600, width: '40px' }}>✓</th>
                    <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: 14, fontWeight: 600, minWidth: '200px' }}>Path</th>
                    <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: 14, fontWeight: 600, width: '100px' }}>Mode</th>
                    <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: 14, fontWeight: 600, width: '150px' }}>Action Name</th>
                    <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: 14, fontWeight: 600, width: '200px' }}>名称</th>
                  </tr>
                </thead>
                <tbody>
                  {bagFiles.map((file, index) => (
                    <tr key={file.path} style={{ 
                      borderTop: index > 0 ? '1px solid #e5e7eb' : 'none',
                      backgroundColor: selectedPaths.has(file.path) ? '#eff6ff' : 'transparent'
                    }}>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedPaths.has(file.path)}
                          onChange={() => toggleFileSelection(file.path)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ 
                        padding: '12px 8px', 
                        fontSize: 13, 
                        fontFamily: 'monospace',
                        maxWidth: '300px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <span title={file.path}>{file.path}</span>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: 13 }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          backgroundColor: file.mode === 'imd' ? '#dbeafe' : '#fef3c7',
                          color: file.mode === 'imd' ? '#1e40af' : '#92400e'
                        }}>
                          {file.mode}
                        </span>
                      </td>
                      <td style={{ 
                        padding: '12px 8px', 
                        fontSize: 13,
                        maxWidth: '150px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <span title={file.action_name || '-'}>{file.action_name || '-'}</span>
                      </td>
                      <td style={{ 
                        padding: '12px 8px', 
                        fontSize: 13,
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <span title={getFileName(file.path)}>{getFileName(file.path)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {bagFiles.length === 0 && (
              <div style={{ 
                textAlign: 'center', 
                padding: 32, 
                color: '#6b7280',
                fontSize: 14
              }}>
                没有找到符合条件的文件
              </div>
            )}
          </div>
        )}

        {/* 上传按钮 */}
        {phase === "loaded" && bagFiles.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Button 
                variant="primary" 
                onClick={onUploadFiles}
                disabled={selectedPaths.size === 0}
              >
                上传选中文件 ({selectedPaths.size})
              </Button>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                请选择要上传的文件，然后点击上传按钮
              </div>
            </div>
          </div>
        )}

        {/* 日志区域 */}
        <div style={{ 
          backgroundColor: '#f9fafb', 
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 12
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>操作日志</div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {logs.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 12 }}>无日志</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} style={{ 
                  color: l.level === "error" ? "#b91c1c" : l.level === "warn" ? "#b45309" : "#111",
                  fontSize: 12,
                  marginBottom: 2
                }}>
                  [{l.ts}] {l.level.toUpperCase()} | {l.msg}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}