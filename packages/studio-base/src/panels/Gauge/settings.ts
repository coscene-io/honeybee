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
import { SettingsTreeAction, SettingsTreeNode, SettingsTreeNodes } from "@foxglove/studio";

import type { Config } from "./types";

export function settingsActionReducer(prevConfig: Config, action: SettingsTreeAction): Config {
  return produce(prevConfig, (draft) => {
    switch (action.action) {
      case "perform-node-action":
        throw new Error(`Unhandled node action: ${action.payload.id}`);
      case "update":
        switch (action.payload.path[0]) {
          case "general":
            _.set(draft, [action.payload.path[1]!], action.payload.value);
            break;
          default:
            throw new Error(`Unexpected payload.path[0]: ${action.payload.path[0]}`);
        }
        break;
    }
  });
}

const supportedDataTypes = [
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "float32",
  "float64",
  "string",
];

export function useSettingsTree(
  config: Config,
  pathParseError: string | undefined,
  error: string | undefined,
): SettingsTreeNodes {
  const { t } = useTranslation("gauge");
  const generalSettings = useMemo(
    (): SettingsTreeNode => ({
      error,
      fields: {
        path: {
          label: t("messagePath"),
          input: "messagepath",
          value: config.path,
          error: pathParseError,
          validTypes: supportedDataTypes,
        },
        minValue: {
          label: t("min"),
          input: "number",
          value: config.minValue,
        },
        maxValue: {
          label: t("max"),
          input: "number",
          value: config.maxValue,
        },
        colorMode: {
          label: t("colorMode"),
          input: "select",
          value: config.colorMode,
          options: [
            { label: t("colorMap"), value: "colormap" },
            { label: t("gradient"), value: "gradient" },
          ],
        },
        ...(config.colorMode === "colormap" && {
          colorMap: {
            label: t("colorMap"),
            input: "select",
            value: config.colorMap,
            options: [
              { label: t("redToGreen"), value: "red-yellow-green" },
              { label: t("rainbow"), value: "rainbow" },
              { label: t("turbo"), value: "turbo" },
            ],
          },
        }),
        ...(config.colorMode === "gradient" && {
          gradient: {
            label: t("gradient"),
            input: "gradient",
            value: config.gradient,
          },
        }),
        reverse: {
          label: t("reverse"),
          input: "boolean",
          value: config.reverse,
        },
      },
    }),
    [error, config, pathParseError, t],
  );
  return useShallowMemo({
    general: generalSettings,
  });
}
