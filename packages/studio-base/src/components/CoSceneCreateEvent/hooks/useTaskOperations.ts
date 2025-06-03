// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import { useSnackbar } from "notistack";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

import { TaskFormData } from "../types";

interface UseTaskOperationsProps {
  onClose: () => void;
  projectName?: string;
  organizationSlug?: string;
  projectSlug?: string;
  syncTask: (name: string) => Promise<void>;
}

export function useTaskOperations({
  onClose,
  projectName,
  organizationSlug,
  projectSlug,
  syncTask,
}: UseTaskOperationsProps): {
  createdTask: ReturnType<typeof useAsyncFn>[0];
  createTask: (params: { targetEvent: Event; task: TaskFormData }) => Promise<void>;
} {
  const consoleApi = useConsoleApi();
  const { enqueueSnackbar } = useSnackbar();
  const { t } = useTranslation("cosEvent");

  const [createdTask, createTask] = useAsyncFn(
    async ({ targetEvent, task }: { targetEvent: Event; task: TaskFormData }) => {
      const parent = projectName;

      if (parent == undefined) {
        enqueueSnackbar(t("createTaskFailed"), { variant: "error" });
        return;
      }

      const description =
        JSON.stringify({
          root: {
            children: [
              {
                children: [
                  {
                    sourceName: targetEvent.name,
                    sourceType: "moment",
                    type: "source",
                    version: 1,
                  },
                ],
                direction: "ltr",
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
              },
              ...task.description.split("\n").map((text) => ({
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: "normal",
                    style: "",
                    text,
                    type: "text",
                    version: 1,
                  },
                ],
                direction: "ltr",
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
              })),
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "root",
            version: 1,
          },
        }) ?? task.description;

      try {
        const newTask = await consoleApi.createTask({
          parent,
          task: { ...task, description },
          event: targetEvent,
        });

        enqueueSnackbar(t("createTaskSuccess"), {
          variant: "success",
        });

        if (task.needSyncTask) {
          await syncTask(newTask.name);
        }
        onClose();
      } catch {
        enqueueSnackbar(t("createTaskFailed"), { variant: "error" });
      }
    },
    [consoleApi, enqueueSnackbar, onClose, organizationSlug, projectName, projectSlug, syncTask, t],
  );

  return {
    createdTask,
    createTask,
  };
}
