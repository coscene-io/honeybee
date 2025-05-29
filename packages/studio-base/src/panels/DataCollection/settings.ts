// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { useShallowMemo } from "@foxglove/hooks";
import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";
import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";

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
  recordLabels: [],
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

const MAX_PROJECTS_PAGE_SIZE = 999;

export function useSettingsTree(
  config: Config,
  userInfo: User,
  consoleApi: ConsoleApi,
  settingsActionHandler: (action: SettingsTreeAction) => void,
): SettingsTreeNodes {
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([]);
  const [recordLabels, setRecordLabels] = useState<{ label: string; value: string }[]>([]);
  const { t } = useTranslation("dataCollection");

  const [, syncProjects] = useAsyncFn(async () => {
    const userId = userInfo.userId;

    if (userId) {
      try {
        return await consoleApi.listUserProjects({
          userId,
          pageSize: MAX_PROJECTS_PAGE_SIZE,
          currentPage: 0,
        });
      } catch (error) {
        console.error("error", error);
      }
    }

    return undefined;
  }, [consoleApi, userInfo.userId]);

  const [, syncRecordLabels] = useAsyncFn(async () => {
    if (config.projectName) {
      try {
        const listLabelsResponse = await consoleApi.listLabels({
          warehouseId: config.projectName.split("warehouses/")[1]?.split("/")[0] ?? "",
          projectId: config.projectName.split("/").pop() ?? "",
          pageSize: MAX_PROJECTS_PAGE_SIZE,
        });
        const labels = listLabelsResponse.labels;
        const options = labels.map((label) => ({
          label: label.displayName,
          value: label.displayName,
        }));
        setRecordLabels(options);
        return listLabelsResponse;
      } catch (error) {
        console.error("error", error);
      }
    }

    return undefined;
  }, [consoleApi, config.projectName]);

  useEffect(() => {
    void syncProjects().then((listUserProjectsResponse) => {
      if (listUserProjectsResponse) {
        const userProjects = listUserProjectsResponse.userProjects;
        const options = userProjects.map((project) => ({
          label: project.displayName,
          value: project.name,
        }));
        const targetProject = options.find((option) => option.value === config.projectName);
        if (targetProject == undefined) {
          settingsActionHandler({
            action: "update",
            payload: {
              path: ["general", "projectName"],
              input: "select",
              value: undefined,
            },
          });
        }
        setProjectOptions(options);
      }
    });
  }, [syncProjects, settingsActionHandler]);

  useEffect(() => {
    void syncRecordLabels();
  }, [syncRecordLabels]);

  const settings = useMemo(
    (): SettingsTreeNodes => ({
      general: {
        fields: {
          projectName: {
            label: t("projectName"),
            input: "select",
            value: config.projectName ?? "",
            options: projectOptions,
          },
          recordLabels: {
            label: t("recordLabels"),
            input: "multipleSelect",
            options: recordLabels,
            value: config.recordLabels ?? defaultConfig.recordLabels,
          },
        },
      },
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
    [config, projectOptions, recordLabels],
  );
  return useShallowMemo(settings);
}
