// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useMemo } from "react";

import { useShallowMemo } from "@foxglove/hooks";
import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";

import { Config } from "./types";

export const defaultConfig: Config = {
  buttons: {
    startCollection: {
      requestPayload: "{}",
      showRequest: false,
      color: "#155dfc",
    },
    endCollection: {
      requestPayload: "{}",
      showRequest: false,
      color: "#155dfc",
    },
    cancelCollection: {
      requestPayload: "{}",
      showRequest: false,
      color: "#000000",
    },
  },
  displayCollectionLog: true,
};

function serviceError(serviceName?: string) {
  if (!serviceName) {
    return "Service cannot be empty";
  }
  return undefined;
}

export function settingsActionReducer(prevConfig: Config, action: SettingsTreeAction): Config {
  const ret = produce(prevConfig, (draft) => {
    if (action.action === "update") {
      const { path, value } = action.payload;
      if (path[0] === "general") {
        _.set(draft, path.slice(1), value);
      } else {
        _.set(draft, path, value);
      }
    }
  });

  return ret;
}

export function useSettingsTree(config: Config): SettingsTreeNodes {
  // const { t } = useTranslation();
  const options = [
    { label: "label1", value: "label1" },
    { label: "label2", value: "label2" },
    { label: "label3", value: "label3" },
  ];
  const settings = useMemo(
    (): SettingsTreeNodes => ({
      general: {
        fields: {
          projectName: {
            label: "Project name",
            input: "string",
            value: config.projectName ?? "",
          },
          recordLabels: {
            label: "Record labels",
            input: "select",
            options,
            value: config.recordLabels ?? defaultConfig.recordLabels,
          },
          serviceName: {
            label: "Service name",
            input: "string",
            error: serviceError(config.serviceName),
            value: config.serviceName ?? "",
          },
        },
      },
      buttons: {
        label: "Buttons",
        children: {
          startCollection: {
            label: "Start collection",
            fields: {
              showRequest: {
                label: "Show request",
                input: "boolean",
                value: config.buttons.startCollection.showRequest,
              },
              color: {
                label: "Color",
                input: "rgb",
                value: config.buttons.startCollection.color,
              },
            },
          },
          endCollection: {
            label: "Stop collection",
            fields: {
              showRequest: {
                label: "Show request",
                input: "boolean",
                value: config.buttons.endCollection.showRequest,
              },
              color: {
                label: "Color",
                input: "rgb",
                value: config.buttons.endCollection.color,
              },
            },
          },
          cancelCollection: {
            label: "Cancel collection",
            fields: {
              showRequest: {
                label: "Show request",
                input: "boolean",
                value: config.buttons.cancelCollection.showRequest,
              },
              color: {
                label: "Color",
                input: "rgb",
                value: config.buttons.cancelCollection.color,
              },
            },
          },
        },
      },
    }),
    [config],
  );
  return useShallowMemo(settings);
}
