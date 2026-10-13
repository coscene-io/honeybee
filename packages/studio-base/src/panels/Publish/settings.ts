// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Immutable, SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";
import buildSampleMessage from "@foxglove/studio-base/panels/Publish/buildSampleMessage";
import { Topic } from "@foxglove/studio-base/players/types";
import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { PublishConfig } from "./types";

export const defaultConfig: PublishConfig = {
  buttonText: "Publish",
  buttonTooltip: "",
  advancedView: true,
  value: "{}",
};

function datatypeError(
  schemaNames: string[],
  t: (key: "messageSchemaCannotBeEmpty" | "schemaNameNotFound") => string,
  datatype?: string,
) {
  if (!datatype) {
    return t("messageSchemaCannotBeEmpty");
  }
  if (!schemaNames.includes(datatype)) {
    return t("schemaNameNotFound");
  }
  return undefined;
}

function topicError(t: (key: "topicCannotBeEmpty") => string, topicName?: string) {
  if (!topicName) {
    return t("topicCannotBeEmpty");
  }
  return undefined;
}

const buildSettingsTree = (
  config: PublishConfig,
  schemaNames: string[],
  topics: readonly Topic[],
  t: ReturnType<typeof useTranslation<"publish">>["t"],
): SettingsTreeNodes => ({
  general: {
    fields: {
      topicName: {
        label: t("topic"),
        input: "autocomplete",
        error: topicError(t, config.topicName),
        value: config.topicName ?? "",
        items: topics.map((topic) => topic.name),
      },
      datatype: {
        label: t("messageSchema"),
        input: "autocomplete",
        error: datatypeError(schemaNames, t, config.datatype),
        items: schemaNames,
        value: config.datatype ?? "",
      },
      advancedView: {
        label: t("editingMode"),
        input: "boolean",
        value: config.advancedView,
      },
    },
  },
  button: {
    label: t("button"),
    fields: {
      buttonText: { label: t("title"), input: "string", value: config.buttonText },
      buttonTooltip: { label: t("tooltip"), input: "string", value: config.buttonTooltip },
      buttonColor: { label: t("color"), input: "rgb", value: config.buttonColor },
    },
  },
});

const getSampleMessage = (
  datatypes: Immutable<RosDatatypes>,
  datatype?: string,
): string | undefined => {
  if (datatype == undefined) {
    return undefined;
  }
  const sampleMessage = buildSampleMessage(datatypes, datatype);
  return sampleMessage != undefined ? JSON.stringify(sampleMessage, undefined, 2) : "{}";
};

export function usePublishPanelSettings(
  config: PublishConfig,
  saveConfig: SaveConfig<PublishConfig>,
  topics: readonly Topic[],
  datatypes: Immutable<RosDatatypes>,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("publish");
  const schemaNames = useMemo(() => Array.from(datatypes.keys()).sort(), [datatypes]);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value, input } = action.payload;

      saveConfig(
        produce<PublishConfig>((draft) => {
          if (input === "autocomplete") {
            if (_.isEqual(path, ["general", "topicName"])) {
              const topicSchemaName = topics.find((t) => t.name === value)?.schemaName;
              const sampleMessage = getSampleMessage(datatypes, topicSchemaName);

              draft.topicName = value;

              if (topicSchemaName) {
                draft.datatype = topicSchemaName;
              }
              if (sampleMessage) {
                draft.value = sampleMessage;
              }
            } else if (_.isEqual(path, ["general", "datatype"])) {
              const sampleMessage = getSampleMessage(datatypes, value);

              draft.datatype = value;

              if (sampleMessage) {
                draft.value = sampleMessage;
              }
            }
          } else {
            _.set(draft, path.slice(1), value);
          }
        }),
      );
    },
    [datatypes, saveConfig, topics],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config, schemaNames, topics, t),
    });
  }, [actionHandler, config, schemaNames, t, topics, updatePanelSettingsTree]);
}
