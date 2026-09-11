// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";
import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { VariableSliderConfig } from "./types";

function buildSettingsTree(
  config: VariableSliderConfig,
  t: ReturnType<typeof useTranslation<"variable">>["t"],
): SettingsTreeNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        min: {
          label: t("min"),
          input: "number",
          placeholder: t("min"),
          value: config.sliderProps.min,
        },
        max: {
          label: t("max"),
          input: "number",
          placeholder: t("max"),
          value: config.sliderProps.max,
        },
        step: {
          label: t("step"),
          input: "number",
          placeholder: t("step"),
          value: config.sliderProps.step,
        },
        globalVariableName: {
          label: t("variableName"),
          input: "string",
          value: config.globalVariableName,
        },
      },
    },
  };
}

export function useVariableSliderSettings(
  config: VariableSliderConfig,
  saveConfig: SaveConfig<VariableSliderConfig>,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("variable");

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }

      saveConfig(
        produce<VariableSliderConfig>((draft) => {
          const path = action.payload.path.slice(1);
          if (["min", "max"].includes(path[0] ?? "")) {
            _.set(draft, ["sliderProps", ...path], action.payload.value);
          } else if (path[0] === "step" && action.payload.input === "number") {
            draft.sliderProps.step = action.payload.value;
          } else {
            _.set(draft, path, action.payload.value);
          }
        }),
      );
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config, t),
    });
  }, [actionHandler, config, t, updatePanelSettingsTree]);
}
