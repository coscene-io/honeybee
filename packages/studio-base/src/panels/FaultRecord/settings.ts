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
  defaultPreparationDuration: number;
  defaultRecordDuration: number;
  startRecordService: ServiceConfig;
  stopRecordService: ServiceConfig;
  // Persisted UI state for this panel instance
  panelState?: PanelState;
}

export const defaultConfig: FaultRecordConfig = {
  defaultPreparationDuration: 30,
  defaultRecordDuration: 30,
  startRecordService: {
    serviceName: "/start_record",
    serviceType: "fault_record/StartRecord",
  },
  stopRecordService: {
    serviceName: "/stop_record",
    serviceType: "fault_record/StopRecord",
  },
};

// Build settings tree (no action name configuration here)
function buildSettingsTree(config: FaultRecordConfig): SettingsTreeNodes {
  return {
    defaults: {
      label: "Default Durations",
      fields: {
        defaultPreparationDuration: {
          label: "Pre-trigger duration (s)",
          input: "number",
          value: config.defaultPreparationDuration,
          min: 0,
          step: 1,
        },
        defaultRecordDuration: {
          label: "Post-trigger duration (s)",
          input: "number",
          value: config.defaultRecordDuration,
          min: 0,
          step: 1,
        },
      },
    },
    serviceConfig: {
      label: "Service Configuration",
      fields: {
        startServiceName: {
          label: "Start record service name",
          input: "string",
          value: config.startRecordService.serviceName,
        },
        startServiceType: {
          label: "Start record service type",
          input: "string",
          value: config.startRecordService.serviceType,
        },
        stopServiceName: {
          label: "Stop record service name",
          input: "string",
          value: config.stopRecordService.serviceName,
        },
        stopServiceType: {
          label: "Stop record service type",
          input: "string",
          value: config.stopRecordService.serviceType,
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
            "serviceConfig.startServiceType": "startRecordService.serviceType",
            "serviceConfig.stopServiceName": "stopRecordService.serviceName",
            "serviceConfig.stopServiceType": "stopRecordService.serviceType",
          };

          const pathStr = path.join(".");
          const configPath = pathMapping[pathStr];

          if (configPath) {
            _.set(draft, configPath, value);
            return;
          }

          // Update defaults
          if (path[0] === "defaults") {
            const key = path[1];
            if (
              key === "defaultPreparationDuration" ||
              key === "defaultRecordDuration"
            ) {
              _.set(draft, key, value);
            }
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