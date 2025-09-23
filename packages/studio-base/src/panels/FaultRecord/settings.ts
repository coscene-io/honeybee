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
import type { PanelState } from "./types";

// Service config interface
export interface ServiceConfig {
  serviceName: string;
  serviceType: string;
}

export interface FaultRecordConfig {
  [key: string]: unknown;
  startRecordService: ServiceConfig;
  stopRecordService: ServiceConfig;
  actionListService: { serviceName: string };
  // Persisted UI state for this panel instance
  panelState?: PanelState;
}

export const defaultConfig: FaultRecordConfig = {
  startRecordService: {
    serviceName: "/RecordPlayback/StartRecord",
    serviceType: "fault_record/StartRecord",
  },
  stopRecordService: {
    serviceName: "/RecordPlayback/StopRecord",
    serviceType: "fault_record/StopRecord",
  },
  actionListService: {
    serviceName: "/RecordPlayback/GetActionList",
  },
};

// Build settings tree (no action name configuration here)
function buildSettingsTree(config: FaultRecordConfig): SettingsTreeNodes {
  return {
    serviceConfig: {
      label: "Service Configuration",
      fields: {
        startServiceName: {
          label: "Start record service name",
          input: "string",
          value: config.startRecordService.serviceName,
        },
        // Hide service type fields from UI; keep defaults in config
        stopServiceName: {
          label: "Stop record service name",
          input: "string",
          value: config.stopRecordService.serviceName,
        },
        actionListServiceName: {
          label: "Action List Service Name",
          input: "string",
          value: config.actionListService.serviceName,
        },
      },
    },
  };
}

// Panel settings hook
export function useFaultRecordPanelSettings(
  config: FaultRecordConfig,
  saveConfig: (updater: (config: FaultRecordConfig) => FaultRecordConfig) => void,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }

      const { path, value } = action.payload;

      saveConfig((prevConfig) => {
        return produce(prevConfig, (draft) => {
          // Map serviceConfig paths to config properties
          const pathMapping: Record<string, string> = {
            "serviceConfig.startServiceName": "startRecordService.serviceName",
            "serviceConfig.stopServiceName": "stopRecordService.serviceName",
            "serviceConfig.actionListServiceName": "actionListService.serviceName",
          };

          const pathStr = path.join(".");
          const configPath = pathMapping[pathStr];

          if (configPath) {
            _.set(draft, configPath, value);
            return;
          }
        });
      });
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config),
    });
  }, [actionHandler, config, updatePanelSettingsTree]);
}
