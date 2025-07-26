// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useShallowMemo } from "@foxglove/hooks";
import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";

import { Config } from "./types";

export const defaultStartCollectionRequest = `{
  "record_opt": "-a"
}`;

export const defaultEndCollectionRequest = `{}`;

export const defaultCancelCollectionRequest = `{
  "auto_remove": true
}`;

export const defaultConfig: Config = {
  buttons: {
    startCollection: {
      requestPayload: defaultStartCollectionRequest,
      showRequest: false,
      color: "#155dfc",
    },
    endCollection: {
      requestPayload: defaultEndCollectionRequest,
      showRequest: false,
      color: "#155dfc",
    },
    cancelCollection: {
      requestPayload: defaultCancelCollectionRequest,
      showRequest: false,
      color: "#e7000b",
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
  const { t } = useTranslation("dataCollection");

  const settings = useMemo(
    (): SettingsTreeNodes => ({
      buttons: {
        label: t("buttons"),
        children: {
          startCollection: {
            label: t("startCollection"),
            fields: {
              showRequest: {
                label: t("showRequest"),
                input: "boolean",
                value: config.buttons.startCollection.showRequest,
              },
              color: {
                label: t("color"),
                input: "rgb",
                value: config.buttons.startCollection.color,
              },
              serviceName: {
                label: t("serviceName"),
                input: "string",
                error: serviceError(config.buttons.startCollection.serviceName),
                value: config.buttons.startCollection.serviceName ?? "",
              },
            },
          },
          endCollection: {
            label: t("endCollection"),
            fields: {
              showRequest: {
                label: t("showRequest"),
                input: "boolean",
                value: config.buttons.endCollection.showRequest,
              },
              color: {
                label: t("color"),
                input: "rgb",
                value: config.buttons.endCollection.color,
              },
              serviceName: {
                label: t("serviceName"),
                input: "string",
                error: serviceError(config.buttons.endCollection.serviceName),
                value: config.buttons.endCollection.serviceName ?? "",
              },
            },
          },
          cancelCollection: {
            label: t("cancelCollection"),
            fields: {
              showRequest: {
                label: t("showRequest"),
                input: "boolean",
                value: config.buttons.cancelCollection.showRequest,
              },
              color: {
                label: t("color"),
                input: "rgb",
                value: config.buttons.cancelCollection.color,
              },
              serviceName: {
                label: t("serviceName"),
                input: "string",
                error: serviceError(config.buttons.cancelCollection.serviceName),
                value: config.buttons.cancelCollection.serviceName ?? "",
              },
            },
          },
        },
      },
    }),
    [config, t],
  );
  return useShallowMemo(settings);
}
