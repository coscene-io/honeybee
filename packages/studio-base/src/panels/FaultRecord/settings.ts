// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect } from "react";
import _ from "lodash";
import { produce } from "immer";

import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import type { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";

// FaultRecord面板的设置配置
import type { ActionNameConfig } from "./types";

// Service配置接口
export interface ServiceConfig {
  serviceName: string;
  serviceType: string;
}

export interface FaultRecordConfig {
  [key: string]: unknown;
  actionNames: ActionNameConfig[];
  defaultPreparationDuration: number;
  defaultRecordDuration: number;
  startRecordService: ServiceConfig;
  stopRecordService: ServiceConfig;
}

export const defaultConfig: FaultRecordConfig = {
  actionNames: [
    { value: "default_action", label: "Default Action" },
    { value: "interaction_action", label: "Interaction Action" },
    { value: "perception_action", label: "Perception Action" }
  ],
  defaultPreparationDuration: 30,
  defaultRecordDuration: 30,
  startRecordService: {
    serviceName: "/start_record",
    serviceType: "fault_record/StartRecord"
  },
  stopRecordService: {
    serviceName: "/stop_record",
    serviceType: "fault_record/StopRecord"
  },
};

export const settingsActionTypes = {
  ADD_ACTION_NAME: "ADD_ACTION_NAME",
  REMOVE_ACTION_NAME: "REMOVE_ACTION_NAME",
  UPDATE_PREPARATION_DURATION: "UPDATE_PREPARATION_DURATION",
  UPDATE_RECORD_DURATION: "UPDATE_RECORD_DURATION",
  UPDATE_START_SERVICE_NAME: "UPDATE_START_SERVICE_NAME",
  UPDATE_START_SERVICE_TYPE: "UPDATE_START_SERVICE_TYPE",
  UPDATE_STOP_SERVICE_NAME: "UPDATE_STOP_SERVICE_NAME",
  UPDATE_STOP_SERVICE_TYPE: "UPDATE_STOP_SERVICE_TYPE",
} as const;

export type SettingsAction =
  | { type: "ADD_ACTION_NAME"; payload: ActionNameConfig }
  | { type: "REMOVE_ACTION_NAME"; payload: string }
  | { type: "UPDATE_PREPARATION_DURATION"; payload: number }
  | { type: "UPDATE_RECORD_DURATION"; payload: number }
  | { type: "UPDATE_START_SERVICE_NAME"; payload: string }
  | { type: "UPDATE_START_SERVICE_TYPE"; payload: string }
  | { type: "UPDATE_STOP_SERVICE_NAME"; payload: string }
  | { type: "UPDATE_STOP_SERVICE_TYPE"; payload: string };

export function settingsReducer(
  state: FaultRecordConfig,
  action: SettingsAction,
): FaultRecordConfig {
  switch (action.type) {
    case "ADD_ACTION_NAME":
      return {
        ...state,
        actionNames: [...state.actionNames, action.payload],
      };
    case "REMOVE_ACTION_NAME":
      return {
        ...state,
        actionNames: state.actionNames.filter((name) => name.value !== action.payload),
      };
    case "UPDATE_PREPARATION_DURATION":
      return {
        ...state,
        defaultPreparationDuration: action.payload,
      };
    case "UPDATE_RECORD_DURATION":
      return {
        ...state,
        defaultRecordDuration: action.payload,
      };
    case "UPDATE_START_SERVICE_NAME":
      return {
        ...state,
        startRecordService: {
          ...state.startRecordService,
          serviceName: action.payload,
        },
      };
    case "UPDATE_START_SERVICE_TYPE":
      return {
        ...state,
        startRecordService: {
          ...state.startRecordService,
          serviceType: action.payload,
        },
      };
    case "UPDATE_STOP_SERVICE_NAME":
      return {
        ...state,
        stopRecordService: {
          ...state.stopRecordService,
          serviceName: action.payload,
        },
      };
    case "UPDATE_STOP_SERVICE_TYPE":
      return {
        ...state,
        stopRecordService: {
          ...state.stopRecordService,
          serviceType: action.payload,
        },
      };
    default:
      return state;
  }
}

// 构建设置树
function buildSettingsTree(config: FaultRecordConfig): SettingsTreeNodes {
  return {
    serviceConfig: {
      label: "Service Configuration",
      fields: {
        startServiceName: {
          label: "开始录制服务名称",
          input: "string",
          value: config.startRecordService.serviceName,
        },
        startServiceType: {
          label: "开始录制服务类型",
          input: "string",
          value: config.startRecordService.serviceType,
        },
        stopServiceName: {
          label: "停止录制服务名称",
          input: "string",
          value: config.stopRecordService.serviceName,
        },
        stopServiceType: {
          label: "停止录制服务类型",
          input: "string",
          value: config.stopRecordService.serviceType,
        },
      },
    },
  };
}

// 面板设置钩子
export function useFaultRecordPanelSettings(
  config: FaultRecordConfig,
  saveConfig: (config: FaultRecordConfig) => void,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value } = action.payload;
      
      // 映射设置路径到配置属性
      const pathMapping: Record<string, string> = {
        "serviceConfig.startServiceName": "startRecordService.serviceName",
        "serviceConfig.startServiceType": "startRecordService.serviceType",
        "serviceConfig.stopServiceName": "stopRecordService.serviceName",
        "serviceConfig.stopServiceType": "stopRecordService.serviceType",
      };
      
      const pathStr = path.join(".");
      const configPath = pathMapping[pathStr];
      
      if (configPath) {
        saveConfig(
          produce(config, (draft) => {
            _.set(draft, configPath, value);
          }),
        );
      }
    },
    [config, saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config),
    });
  }, [actionHandler, config, updatePanelSettingsTree]);
}