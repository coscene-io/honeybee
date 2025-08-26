// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SettingsTreeAction } from "@foxglove/studio";

import type { Config, ActionNameConfig, DurationConfig } from "../types";

// 默认的action_name列表
export const DEFAULT_ACTION_NAMES: ActionNameConfig[] = [
  { value: "default_action", label: "default_action" },
  { value: "interaction_action", label: "interaction_action" },
  { value: "perception_action", label: "perception_action" },
];

// 默认配置
export const defaultConfig: Config = {
  actionNames: DEFAULT_ACTION_NAMES,
  durations: {
    preparation_duration_s: 30,
    record_duration_s: 30,
  },
  startRecordService: "/start_record",
  stopRecordService: "/stop_record",
};

// 验证配置
export function validateConfig(config: Partial<Config>): Config {
  return {
    actionNames: config.actionNames && config.actionNames.length > 0 
      ? config.actionNames 
      : DEFAULT_ACTION_NAMES,
    durations: validateDurations(config.durations),
    startRecordService: config.startRecordService || "/start_record",
    stopRecordService: config.stopRecordService || "/stop_record",
  };
}

// 验证时长参数
export function validateDurations(durations?: Partial<DurationConfig>): DurationConfig {
  const prep = durations?.preparation_duration_s;
  const record = durations?.record_duration_s;
  
  return {
    preparation_duration_s: prep != null && prep > 0 ? prep : 30,
    record_duration_s: record != null && record >= 0 ? record : 30,
  };
}

// 处理设置树更新动作
export function settingsActionReducer(config: Config, action: SettingsTreeAction): Config {
  if (action.action === "update" && action.payload.path && action.payload.value !== undefined) {
    const newConfig = { ...config };
    const pathArray = Array.isArray(action.payload.path) ? action.payload.path : [action.payload.path];
    const pathStr = pathArray.join(".");
    const value = action.payload.value;
    
    // 处理添加action_name操作
    if (pathStr === "general.addActionAction" && value === "add-new-action") {
      return {
        ...config,
        actionNames: [
          ...config.actionNames,
          {
            value: "new_action",
            label: "new_action",
          },
        ],
      };
    }
    
    // 处理删除action_name操作
    const deleteMatch = pathStr.match(/^general\.action-(\d+)\.deleteAction$/);
    if (deleteMatch && value === "delete-action") {
      const index = parseInt(deleteMatch[1]!);
      if (config.actionNames.length > 1 && index >= 0 && index < config.actionNames.length) {
        return {
          ...config,
          actionNames: config.actionNames.filter((_, i) => i !== index),
        };
      }
    }
    
    // 处理action_name配置更新
    if (pathStr.startsWith("general.action-")) {
      const match = pathStr.match(/^general\.action-(\d+)\.(value|label)$/);
      if (match) {
        const index = parseInt(match[1]!);
        const field = match[2]! as keyof ActionNameConfig;
        
        newConfig.actionNames = [...config.actionNames];
        if (newConfig.actionNames[index]) {
          newConfig.actionNames[index] = {
            ...newConfig.actionNames[index],
            [field]: value,
          } as ActionNameConfig;
        }
      }
    }
    
    // 处理时长配置更新
    if (pathStr === "durations.preparation_duration_s") {
      const numValue = typeof value === "number" ? value : parseInt(value as string, 10);
      if (!isNaN(numValue) && numValue > 0) {
        newConfig.durations = {
          ...config.durations,
          preparation_duration_s: numValue,
        };
      }
    }
    
    if (pathStr === "durations.record_duration_s") {
      const numValue = typeof value === "number" ? value : parseInt(value as string, 10);
      if (!isNaN(numValue) && numValue >= 0) {
        newConfig.durations = {
          ...config.durations,
          record_duration_s: numValue,
        };
      }
    }
    
    // 处理服务名称更新
    if (pathStr === "services.startRecordService") {
      newConfig.startRecordService = value as string;
    }
    
    if (pathStr === "services.stopRecordService") {
      newConfig.stopRecordService = value as string;
    }
    
    return newConfig;
  }
  
  return config;
}

// 生成设置树节点
export function useSettingsNodes(config: Config, actionHandler?: (action: SettingsTreeAction) => void): Record<string, any> {
  const actionNodes: Record<string, any> = {};
  
  // 为每个action_name生成配置节点
  config.actionNames.forEach((action, index) => {
    actionNodes[`action-${index}`] = {
      label: `Action ${index + 1}: ${action.label}`,
      icon: "Settings",
      handler: actionHandler,
      fields: {
        value: {
          label: "Action值",
          input: "string",
          value: action.value,
          placeholder: "输入action_name值",
          help: "实际传递给服务的action_name参数值",
        },
        label: {
          label: "显示标签",
          input: "string",
          value: action.label,
          placeholder: "输入显示标签",
          help: "在下拉框中显示的标签文字",
        },
        // 只有多个action时才显示删除操作
        ...(config.actionNames.length > 1 ? {
          deleteAction: {
            label: "删除操作",
            input: "select",
            value: "",
            options: [
              { label: "选择操作...", value: "" },
              { label: "删除此Action", value: "delete-action" },
            ],
            help: "选择删除此Action配置",
          },
        } : {}),
      },
    };
  });
  
  return {
    general: {
      label: "Action Name 配置",
      icon: "Settings",
      handler: actionHandler,
      fields: {
        addActionAction: {
          label: "添加Action操作",
          input: "select",
          value: "",
          options: [
            { label: "选择操作...", value: "" },
            { label: "添加新Action", value: "add-new-action" },
          ],
          help: "选择添加新的Action配置",
        },
      },
      children: actionNodes,
    },
    durations: {
      label: "时长配置",
      icon: "Clock",
      handler: actionHandler,
      fields: {
        preparation_duration_s: {
          label: "触发前数据时长(秒)",
          input: "number",
          value: config.durations.preparation_duration_s,
          min: 1,
          placeholder: "30",
          help: "触发前数据时长，必须大于0，默认30秒",
        },
        record_duration_s: {
          label: "触发后数据时长(秒)",
          input: "number",
          value: config.durations.record_duration_s,
          min: 0,
          placeholder: "30",
          help: "触发后数据时长，可以为0，默认30秒",
        },
      },
    },
    services: {
      label: "服务配置",
      icon: "Network",
      handler: actionHandler,
      fields: {
        startRecordService: {
          label: "开始录制服务名",
          input: "string",
          value: config.startRecordService,
          placeholder: "/start_record",
          help: "开始录制调用的ROS服务名称",
        },
        stopRecordService: {
          label: "停止录制服务名",
          input: "string",
          value: config.stopRecordService,
          placeholder: "/stop_record",
          help: "停止录制调用的ROS服务名称",
        },
      },
    },
  };
}