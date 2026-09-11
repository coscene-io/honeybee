// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import * as _ from "lodash-es";

import { filterMap } from "@foxglove/den/collection";
import { SettingsTreeFields, SettingsTreeNodes, Topic } from "@foxglove/studio";

// Persisted panel state
export type Config = {
  center?: { lat: number; lon: number };
  customTileUrl: string;
  disabledTopics: string[];
  followTopic: string;
  layer: string;
  topicColors: Record<string, string>;
  zoomLevel?: number;
  maxNativeZoom?: number;
};

export function validateCustomUrl(url: string): Error | undefined {
  const placeholders = url.match(/\{.+?\}/g) ?? [];
  const validPlaceholders = ["{x}", "{y}", "{z}"];
  for (const placeholder of placeholders) {
    if (!validPlaceholders.includes(placeholder)) {
      return new Error(t("map:invalidPlaceholder", { placeholder }));
    }
  }

  return undefined;
}

function isGeoJSONSchema(schemaName: string) {
  switch (schemaName) {
    case "foxglove_msgs/GeoJSON":
    case "foxglove_msgs/msg/GeoJSON":
    case "foxglove::GeoJSON":
    case "foxglove.GeoJSON":
      return true;
    default:
      return false;
  }
}

export function buildSettingsTree(
  config: Config,
  eligibleTopics: Omit<Topic, "datatype">[],
): SettingsTreeNodes {
  const topics: SettingsTreeNodes = _.transform(
    eligibleTopics,
    (result, topic) => {
      const coloring = config.topicColors[topic.name];
      result[topic.name] = {
        label: topic.name,
        fields: {
          enabled: {
            label: t("map:enabled"),
            input: "boolean",
            value: !config.disabledTopics.includes(topic.name),
          },
          coloring: {
            label: t("map:coloring"),
            input: "select",
            value: coloring ? "Custom" : "Automatic",
            options: [
              { label: t("map:automatic"), value: "Automatic" },
              { label: t("map:custom"), value: "Custom" },
            ],
          },
          color: coloring
            ? {
                label: t("map:color"),
                input: "rgb",
                value: coloring,
              }
            : undefined,
        },
      };
    },
    {} as SettingsTreeNodes,
  );

  const eligibleFollowTopicOptions = filterMap(eligibleTopics, (topic) =>
    config.disabledTopics.includes(topic.name) || isGeoJSONSchema(topic.schemaName)
      ? undefined
      : { label: topic.name, value: topic.name },
  );
  const followTopicOptions = [{ label: t("map:off"), value: "" }, ...eligibleFollowTopicOptions];
  const generalSettings: SettingsTreeFields = {
    layer: {
      label: t("map:tileLayer"),
      input: "select",
      value: config.layer,
      options: [
        { label: t("map:layerMap"), value: "map" },
        { label: t("map:satellite"), value: "satellite" },
        { label: t("map:custom"), value: "custom" },
      ],
    },
  };

  // Only show the custom url input when the user selects the custom layer
  if (config.layer === "custom") {
    let error: string | undefined;
    if (config.customTileUrl.length > 0) {
      error = validateCustomUrl(config.customTileUrl)?.message;
    }

    generalSettings.customTileUrl = {
      label: t("map:customMapTileUrl"),
      input: "string",
      value: config.customTileUrl,
      error,
    };

    generalSettings.maxNativeZoom = {
      label: t("map:maxTileLevel"),
      input: "select",
      value: config.maxNativeZoom,
      options: [18, 19, 20, 21, 22, 23, 24].map((num) => {
        return { label: String(num), value: num };
      }),
      help: t("map:maxTileLevelHelp"),
    };
  }

  generalSettings.followTopic = {
    label: t("map:followTopic"),
    input: "select",
    value: config.followTopic,
    options: followTopicOptions,
  };

  const settings: SettingsTreeNodes = {
    general: {
      label: t("map:general"),
      fields: generalSettings,
    },
    topics: {
      label: t("map:topics"),
      children: topics,
    },
  };

  return settings;
}
