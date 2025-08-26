// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect } from "react";
import _ from "lodash";
import { produce } from "immer";

import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";
import type { Config } from "./types";

// Config interface imported from types.ts
export type { Config } from "./types";
export const settingsActionTypes = {
  UPDATE: "update" as const,
};

export function settingsReducer(config: Config, action: SettingsTreeAction): Config {
  if (action.action !== "update") {
    return config;
  }
  
  const { path, value } = action.payload;
  
  return produce(config, (draft) => {
    _.set(draft, path.slice(1), value);
  });
}

export const defaultConfig = {
  refreshButtonService: { serviceName: "/api/test/end_and_get_candidates" },
  rosServiceUrl: "http://localhost:11311",
  coSceneApiUrl: "https://api.coscene.cn",
} as const satisfies Config;

// 处理设置树更新动作
export function settingsActionReducer(config: Config, action: SettingsTreeAction): Config {
  // 处理重置操作 - 当用户点击"重置默认值"时
  if (action.action === "perform-node-action" && action.payload.id === "reset") {
    return { ...defaultConfig };
  }
  
  // 处理字段更新
  if (action.action === "update" && action.payload.path && action.payload.value !== undefined) {
    const newConfig = { ...config };
    const pathArray = Array.isArray(action.payload.path) ? action.payload.path : [action.payload.path];
    const pathStr = pathArray.join(".");
    const value = action.payload.value;
    
    // 处理刷新按钮服务配置更新
    if (pathStr === "general.refreshButtonService.serviceName") {
      newConfig.refreshButtonService = {
        ...config.refreshButtonService,
        serviceName: String(value),
      };
    }
    
    return newConfig;
  }
  
  return config;
}

// 构建设置树
export function buildSettingsTree(config: Config): SettingsTreeNodes {
  const actionHandler = undefined; // 将在usePanelSettingsTreeUpdate中设置
  return useSettingsNodes(config, actionHandler);
}

// 生成设置树节点
export function useSettingsNodes(config: Config, actionHandler?: (action: SettingsTreeAction) => void): Record<string, any> {
  return {
    general: {
      label: "刷新按钮配置",
      icon: "Settings",
      handler: actionHandler,
      children: {
        refreshButtonService: {
          label: "刷新按钮",
          icon: "Refresh",
          handler: actionHandler,
          fields: {
            serviceName: {
              label: "服务名称",
              input: "string",
              value: config.refreshButtonService.serviceName,
              placeholder: "输入刷新按钮调用的服务名称",
              help: "刷新按钮点击时调用的ROS服务名称",
            },
          },
        },
      },
      actions: [
        {
          type: "action",
          id: "reset",
          label: "重置默认值",
          icon: "Reset",
        },
      ],
    },
  };
}

// 面板设置钩子
export function useFileUploadPanelSettings(
  config: Config,
  saveConfig: (config: Config) => void,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      const newConfig = settingsActionReducer(config, action);
      if (newConfig !== config) {
        saveConfig(newConfig);
      }
    },
    [config, saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: useSettingsNodes(config, actionHandler),
    });
  }, [actionHandler, config, updatePanelSettingsTree]);
}