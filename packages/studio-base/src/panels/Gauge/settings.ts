// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useMemo } from "react";

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
  const generalSettings = useMemo(
    (): SettingsTreeNode => ({
      error,
      fields: {
        path: {
          label: "Message path",
          input: "messagepath",
          value: config.path,
          error: pathParseError,
          validTypes: supportedDataTypes,
        },
        minValue: {
          label: "Min",
          input: "number",
          value: config.minValue,
        },
        maxValue: {
          label: "Max",
          input: "number",
          value: config.maxValue,
        },
        colorMode: {
          label: "colorMode",
          input: "select",
          value: config.colorMode,
          options: [
            { label: "Color map", value: "colormap" },
            { label: "gradient", value: "gradient" },
          ],
        },
        ...(config.colorMode === "colormap" && {
          colorMap: {
            label: "colorMap",
            input: "select",
            value: config.colorMap,
            options: [
              { label: "Red to green", value: "red-yellow-green" },
              { label: "Rainbow", value: "rainbow" },
              { label: "Turbo", value: "turbo" },
            ],
          },
        }),
        ...(config.colorMode === "gradient" && {
          gradient: {
            label: "gradient",
            input: "gradient",
            value: config.gradient,
          },
        }),
        reverse: {
          label: "reverse",
          input: "boolean",
          value: config.reverse,
        },
      },
    }),
    [error, config, pathParseError],
  );
  return useShallowMemo({
    general: generalSettings,
  });
}
