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

export const defaultConfig: Config = {
  requestPayload: "{}",
  layout: "vertical",
};

function serviceError(message: string, serviceName?: string) {
  if (!serviceName) {
    return message;
  }
  return undefined;
}

export function settingsActionReducer(prevConfig: Config, action: SettingsTreeAction): Config {
  return produce(prevConfig, (draft) => {
    if (action.action === "update") {
      const { path, value } = action.payload;
      _.set(draft, path.slice(1), value);
    }
  });
}

export function useSettingsTree(config: Config): SettingsTreeNodes {
  const { t } = useTranslation("callService");
  const settings = useMemo(
    (): SettingsTreeNodes => ({
      general: {
        fields: {
          serviceName: {
            label: t("serviceName"),
            input: "string",
            error: serviceError(t("serviceCannotBeEmpty"), config.serviceName),
            value: config.serviceName ?? "",
          },
          layout: {
            label: t("layout"),
            input: "toggle",
            options: [
              { label: t("vertical"), value: "vertical" },
              { label: t("horizontal"), value: "horizontal" },
            ],
            value: config.layout ?? defaultConfig.layout,
          },
        },
      },
      button: {
        label: t("button"),
        fields: {
          buttonText: {
            label: t("title"),
            input: "string",
            value: config.buttonText,
            placeholder: t("callServicePlaceholder", { serviceName: config.serviceName ?? "" }),
          },
          buttonTooltip: { label: t("tooltip"), input: "string", value: config.buttonTooltip },
          buttonColor: { label: t("color"), input: "rgb", value: config.buttonColor },
        },
      },
    }),
    [config, t],
  );
  return useShallowMemo(settings);
}
