// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";

import { PanelExtensionContext } from "@foxglove/studio";

import { ProjectAndTagPicker } from "./ProjectAndTagPicker";
import type { Config } from "../config/types";
import { MockCoSceneClient, RealCoSceneClient } from "../services/coscene";
import { MockBagService } from "../services/mockBagService";
import { MockRosService, RealRosService } from "../services/ros";
import type { BagFile, UploadConfig, CoSceneClient } from "../types";

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

// Service factory functions
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

// Create CoScene client for project and tag management
function createCoSceneClient(serviceType: string): CoSceneClient {
  switch (serviceType) {
    case "coscene-real":
      return new RealCoSceneClient();
    case "coscene-mock":
    default:
      return new MockCoSceneClient();
  }
}

export function FileUploadPanel({ config, context, serviceSettings, refreshButtonServiceName }: FileUploadPanelProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  
  const log = useCallback((level: LogLine["level"], msg: string) => {
    setLogs((xs) => [...xs, { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), ts: new Date().toLocaleTimeString(), level, msg }]);
  }, []);
  
  const bagServiceRef = useRef<any>(createBagService(serviceSettings.getBagListService || "mock"));
  
  // Create CoScene client for project and tag functionality
  const coSceneClient = useMemo(() => {
    const newServiceType = serviceSettings.submitFilesService || "coscene-mock";
    const client = createCoSceneClient(newServiceType);
    const newService = client?.constructor?.name || 'Unknown';
    log('info', `CoScene client service changed to: ${newService}`);
    return client;
  }, [serviceSettings.submitFilesService, log]);
  
  // When service configuration changes, recreate service instance
  useEffect(() => {
    const oldService = bagServiceRef.current?.constructor?.name || 'Unknown';
    const newServiceType = serviceSettings.getBagListService || "mock";
    bagServiceRef.current = createBagService(newServiceType);
    const newService = bagServiceRef.current?.constructor?.name || 'Unknown';
    log("info", `[配置变更] BagService: ${oldService} -> ${newService} (${newServiceType})`);
  }, [serviceSettings.getBagListService, log]);
  
  const [phase, setPhase] = useState<"idle" | "loading" | "loaded">("idle");
  const [bagFiles, setBagFiles] = useState<BagFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  
  // Add upload configuration state for project and tags
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>({
    projectId: null,
    addTags: false,
    tags: []
  });
  

  
  // 过滤条件
  const [selectedMode, setSelectedMode] = useState<string>(""); // "" | "imd" | "signal"
  const [selectedActionName, setSelectedActionName] = useState<string>(""); // "" 或具体action名称
  
  // 获取所有可用的action_name选项
  const availableActionNames = useMemo(() => {
    try {
      const actionNames = bagServiceRef.current.getUniqueActionNames();
      log("info", `[Action接口] 调用getUniqueActionNames(), 获取到${actionNames.length}个选项: [${actionNames.join(', ')}]`);
      return actionNames;
    } catch (error) {
      log("error", `[Action接口] getUniqueActionNames()调用失败: ${error}`);
      return [];
    }
  }, [log]);

  // 获取文件列表
  const onGetBagList = useCallback(async () => {
    try {
      setPhase("loading");
      setSelectedPaths(new Set()); // 清空之前的选择状态
      
      const serviceName = bagServiceRef.current?.constructor?.name || 'Unknown';
      const requestParams = { mode: selectedMode, action_name: selectedActionName };
      log("info", `[刷新按钮] 调用${serviceName}.getBagList(), 参数: ${JSON.stringify(requestParams)}`);
      
      const result = await bagServiceRef.current.getBagList(requestParams);
      
      if (result.code === 0) {
        setBagFiles(result.bags);
        setPhase("loaded");
        log("info", `[刷新按钮] 返回成功: 获取到${result.bags.length}个文件, 详情: ${JSON.stringify(result.bags.map((f: any) => ({ path: f.path, mode: f.mode, action_name: f.action_name })))}`);
      } else {
        setPhase("idle");
        log("error", `[刷新按钮] 返回失败: code=${result.code}, msg=${result.msg}`);
      }
    } catch (e: any) {
      setPhase("idle");
      log("error", `[刷新按钮] 接口调用异常: ${e?.message || e}`);
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

  // Modified upload function to include project and tag information
  const onUploadFiles = useCallback(async () => {
    if (selectedPaths.size === 0) {
      log("error", "请选择要上传的文件");
      return;
    }

    // Check if project is selected when tags are enabled
    if (uploadConfig.addTags && !uploadConfig.projectId) {
      log("error", "启用标签时必须选择项目");
      return;
    }

    try {
      const pathsArray = Array.from(selectedPaths);
      const uploadInfo = {
        files: pathsArray,
        projectId: uploadConfig.projectId,
        tags: uploadConfig.addTags ? uploadConfig.tags : [],
        serviceType: serviceSettings.submitFilesService
      };
      log("info", `[上传文件] 开始上传, 配置: ${JSON.stringify(uploadInfo)}`);
      
      // If using CoScene service and project/tags are configured, use CoScene upload
      if ((serviceSettings.submitFilesService === "coscene-real" || serviceSettings.submitFilesService === "coscene-mock") && uploadConfig.projectId) {
        // Convert paths to FileCandidate format for CoScene upload
        const filesCandidates = pathsArray.map((path, index) => ({
          id: `file-${index}`,
          name: path.split('/').pop() || path,
          sizeBytes: 0, // Size not available from bag service
          createdAt: new Date().toISOString(),
          kind: "recorded" as const
        }));
        
        const clientName = coSceneClient?.constructor?.name || 'Unknown';
        log("info", `[上传文件] 调用${clientName}.upload(), 文件数: ${filesCandidates.length}`);
        
        await coSceneClient.upload(filesCandidates, uploadConfig, (progress) => {
          log("info", `[上传进度] ${progress}%`);
        });
        
        log("info", `[上传完成] CoScene上传成功, 文件数: ${pathsArray.length}, 项目: ${uploadConfig.projectId}, 标签: [${uploadConfig.tags.join(', ')}]`);
      } else {
        // Use original bag service upload
        const serviceName = bagServiceRef.current?.constructor?.name || 'Unknown';
        log("info", `[上传文件] 调用${serviceName}.submitFiles(), 文件数: ${pathsArray.length}`);
        
        const result = await bagServiceRef.current.submitFiles({
          paths: pathsArray
        });
        
        if (result.code === 0) {
          log("info", `[上传完成] ${serviceName}上传成功, 返回: ${JSON.stringify(result)}`);
        } else {
          log("error", `[上传失败] ${serviceName}上传失败: code=${result.code}, msg=${result.msg}`);
        }
      }
    } catch (e: any) {
      log("error", `[上传异常] 上传过程中发生异常: ${e?.message || e}`);
    }
  }, [selectedPaths, uploadConfig, coSceneClient, serviceSettings.submitFilesService, log]);

  // 获取文件名（从路径中提取）
  const getFileName = useCallback((path: string) => {
    return path.split('/').pop() || path;
  }, []);

  return (
    <div style={{ 
      padding: 16, 
      height: "100%", 
      display: "flex", 
      flexDirection: "column", 
      gap: 16, 
      overflow: "auto",
      fontFamily: 'system-ui, sans-serif'
    }}>
      {/* Bag文件管理区域 */}
      <div style={{ 
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16
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
                onChange={(e) => { 
                  const oldMode = selectedMode || '全部';
                  const newMode = e.target.value || '全部';
                  setSelectedMode(e.target.value);
                  log("info", `[模式选择] ${oldMode} -> ${newMode}`);
                }}
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
                onChange={(e) => { 
                  const oldAction = selectedActionName || '全部';
                  const newAction = e.target.value || '全部';
                  setSelectedActionName(e.target.value);
                  log("info", `[Action选择] ${oldAction} -> ${newAction}`);
                }}
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
              maxHeight: '400px',
              minHeight: '200px'
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
                          onChange={() => { toggleFileSelection(file.path); }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ 
                        padding: '12px 8px', 
                        fontSize: 13, 
                        fontFamily: 'monospace',
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
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <span title={file.action_name || '-'}>{file.action_name || '-'}</span>
                      </td>
                      <td style={{ 
                        padding: '12px 8px', 
                        fontSize: 13,
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

        {/* Project and Tag Selection */}
        {phase === "loaded" && bagFiles.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <ProjectAndTagPicker
              client={coSceneClient}
              value={uploadConfig}
              onChange={setUploadConfig}
              log={log}
            />
          </div>
        )}

        {/* 上传按钮 */}
        {phase === "loaded" && bagFiles.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Button 
                variant="primary" 
                onClick={onUploadFiles}
                disabled={selectedPaths.size === 0 || (uploadConfig.addTags && !uploadConfig.projectId)}
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