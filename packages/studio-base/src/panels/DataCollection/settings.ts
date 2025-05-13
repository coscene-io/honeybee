// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useEffect, useMemo, useState } from "react";
import { useAsyncFn } from "react-use";

import { useShallowMemo } from "@foxglove/hooks";
import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";
import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { ConsoleApi } from "@foxglove/studio-base/index";

import { Config } from "./types";

export const defaultStartCollectionRequest = `{
  record_opt: "-o cos -a",
}`;

export const defaultEndCollectionRequest = `{}`;

export const defaultCancelCollectionRequest = `{
  auto_remove: true,
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

const MAX_PROJECTS_PAGE_SIZE = 999;

export function useSettingsTree(
  config: Config,
  userInfo: User,
  consoleApi: ConsoleApi,
): SettingsTreeNodes {
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([]);
  const [recordLabels, setRecordLabels] = useState<{ label: string; value: string }[]>([]);

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

  useEffect(() => {
    void syncProjects().then((listUserProjectsResponse) => {
      if (listUserProjectsResponse) {
        const userProjects = listUserProjectsResponse.userProjects;
        const options = userProjects.map((project) => ({
          label: project.displayName,
          value: project.name,
        }));
        setProjectOptions(options);
      }
    });
  }, [syncProjects]);

  // useEffect(() => {
  //   void syncProjects().then((listUserProjectsResponse) => {
  //     if (listUserProjectsResponse) {
  //       const userProjects = listUserProjectsResponse.userProjects;
  //       const options = userProjects.map((project) => ({
  //         label: project.displayName,
  //         value: project.name,
  //       }));
  //       setProjectOptions(options);
  //     }
  //   });
  // }, [syncProjects]);

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
            options: projectOptions,
            value: config.recordLabels ?? defaultConfig.recordLabels,
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
              serviceName: {
                label: "Service name",
                input: "string",
                error: serviceError(config.buttons.startCollection.serviceName),
                value: config.buttons.startCollection.serviceName ?? "",
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
              serviceName: {
                label: "Service name",
                input: "string",
                error: serviceError(config.buttons.endCollection.serviceName),
                value: config.buttons.endCollection.serviceName ?? "",
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
              serviceName: {
                label: "Service name",
                input: "string",
                error: serviceError(config.buttons.cancelCollection.serviceName),
                value: config.buttons.cancelCollection.serviceName ?? "",
              },
            },
          },
        },
      },
    }),
    [config, projectOptions],
  );
  return useShallowMemo(settings);
}
