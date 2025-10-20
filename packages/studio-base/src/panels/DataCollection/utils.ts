// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import dayjs from "dayjs";
import { TFunction } from "i18next";

import { PanelExtensionContext } from "@foxglove/studio";
import { ConsoleApi } from "@foxglove/studio-base/index";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";

import { LOG_TIMESTAMP_FORMAT } from "./constants";
import {
  Config,
  StartCollectionResponse,
  EndCollectionResponse,
  CancelCollectionResponse,
  ButtonType,
  CollectionStage,
  CreateDataCollectionTaskParams,
  ProjectState,
} from "./types";

// 工具函数：生成进度文本
export function generateProgressText(uploadedFiles: number, totalFiles: number): string {
  return !Number.isNaN(uploadedFiles) && !Number.isNaN(totalFiles) && totalFiles > 0
    ? ` ${uploadedFiles}/${totalFiles}`
    : "";
}

// 工具函数：处理记录链接
export async function handleRecordLink({
  task,
  showRecordLink,
  addLog,
  t,
  targetOrg,
  targetProject,
  focusedTask,
  consoleApi,
}: {
  task: Task;
  showRecordLink: boolean;
  addLog: (log: string) => void;
  t: TFunction<"dataCollection">;
  targetOrg: Organization;
  targetProject: Project;
  focusedTask?: Task;
  consoleApi: ConsoleApi;
}): Promise<boolean> {
  const domainConfig = getDomainConfig();

  if (task.tags.recordName != undefined && showRecordLink) {
    addLog(
      `[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("saveToRecord")}：https://${
        domainConfig.webDomain
      }/${targetOrg.slug}/${targetProject.slug}/records/${task.tags.recordName.split("/").pop()}`,
    );

    if (focusedTask?.name) {
      try {
        await consoleApi.linkTasks({
          project: targetProject.name,
          linkTasks: [
            {
              task: focusedTask.name,
              target: {
                value: `${targetProject.name}/records/${task.tags.recordName.split("/").pop()}`,
                case: "record",
              },
            },
          ],
        });
      } catch (linkError) {
        // 如果链接任务失败，记录错误但不阻止整个流程
        console.error("Failed to link record:", linkError);
        addLog(
          `[WARNING] ${t("recordLinkFailed")}: ${
            linkError instanceof Error ? linkError.message : String(linkError)
          }`,
        );
      }
    }

    return false; // 不再需要显示记录链接
  }
  return showRecordLink;
}

// 工具函数：处理任务状态
export function handleTaskState({
  task,
  uploadedFiles,
  totalFiles,
  progressText,
  addLog,
  t,
  consoleApi,
  taskName,
  timeout,
  showRecordLink,
  targetOrg,
  targetProject,
  focusedTask,
}: {
  task: Task;
  uploadedFiles: number;
  totalFiles: number;
  progressText: string;
  addLog: (log: string) => void;
  t: TFunction<"dataCollection">;
  consoleApi: ConsoleApi;
  taskName: string;
  timeout: number;
  showRecordLink: boolean;
  targetOrg: Organization;
  targetProject: Project;
  focusedTask?: Task;
}): void {
  switch (task.state) {
    case TaskStateEnum_TaskState.FAILED:
    case TaskStateEnum_TaskState.SUCCEEDED:
      if (totalFiles === 0) {
        addLog(`[ERROR] ${t("errorNoFilesMatched")}`);
      } else if (uploadedFiles < totalFiles) {
        addLog(`[ERROR] ${t("checkFileDeleted")}`);
      } else {
        addLog("+++++++++++++++++++++++++++");
        addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("fileUploaded")} ${progressText}`);
        addLog("+++++++++++++++++++++++++++");
      }
      break;

    case TaskStateEnum_TaskState.PENDING:
      addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("taskStatePending")}`);
      setTimeout(() => {
        void handleTaskProgress({
          consoleApi,
          taskName,
          timeout,
          addLog,
          t,
          showRecordLink,
          targetOrg,
          targetProject,
          focusedTask,
        });
      }, timeout);
      break;

    case TaskStateEnum_TaskState.PROCESSING:
      addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("processing")} ${progressText}`);
      setTimeout(() => {
        void handleTaskProgress({
          consoleApi,
          taskName,
          timeout,
          addLog,
          t,
          showRecordLink,
          targetOrg,
          targetProject,
          focusedTask,
        });
      }, timeout);
      break;

    case TaskStateEnum_TaskState.CANCELLING:
    case TaskStateEnum_TaskState.CANCELLED:
      addLog(`[ERROR] ${t("cancelled")}`);
      break;
  }
}

// 主要的任务进度处理函数
export async function handleTaskProgress({
  consoleApi,
  taskName,
  timeout,
  addLog,
  t,
  showRecordLink = true,
  targetOrg,
  targetProject,
  focusedTask,
}: {
  consoleApi: ConsoleApi;
  taskName: string;
  timeout: number;
  addLog: (log: string) => void;
  t: TFunction<"dataCollection">;
  showRecordLink: boolean;
  targetOrg: Organization;
  targetProject: Project;
  focusedTask?: Task;
}): Promise<void> {
  const task = await consoleApi.getTask({ taskName });

  const uploadedFiles = Number(task.tags.uploadedFiles ?? 0);
  const totalFiles = Number(task.tags.totalFiles);
  const progressText = generateProgressText(uploadedFiles, totalFiles);

  const needShowRecordLink = await handleRecordLink({
    task,
    showRecordLink,
    addLog,
    t,
    targetOrg,
    targetProject,
    focusedTask,
    consoleApi,
  });

  handleTaskState({
    task,
    uploadedFiles,
    totalFiles,
    progressText,
    addLog,
    t,
    consoleApi,
    taskName,
    timeout,
    showRecordLink: needShowRecordLink,
    targetOrg,
    targetProject,
    focusedTask,
  });
}

// 服务调用相关工具函数
export function validateServiceCall(
  context: PanelExtensionContext,
  config: Config,
  addLog: (log: string) => void,
  t: TFunction<"dataCollection">,
): string | undefined {
  if (!context.callService) {
    return "The data source does not allow calling services";
  }

  if (Object.entries(config.buttons).some(([, button]) => !button.serviceName)) {
    addLog("[ERROR] " + t("configureService"));
    return "Service not configured";
  }

  return undefined;
}

export async function handleStartCollectionPreLogic(
  buttonType: ButtonType,
  projectName: string,
  addLog: (log: string) => void,
  t: TFunction<"dataCollection">,
  consoleApi: ConsoleApi,
  setCurrentCollectionStage: (stage: CollectionStage) => void,
  setCollectionStartTime: (startTime: string) => void,
): Promise<void> {
  switch (buttonType) {
    case "startCollection": {
      if (!projectName) {
        addLog("[ERROR] " + t("projectNameNotSet"));
        throw new Error("Project name not set");
      }
      addLog("+++++++++++++++++++++++++++");
      addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("startCollection")}`);
      addLog("+++++++++++++++++++++++++++");

      const project = await consoleApi.getProject({ projectName });

      await consoleApi.setApiBaseInfo({
        projectId: project.name.split("/").pop(),
        warehouseId: project.name.split("warehouses/")[1]?.split("/")[0],
      });

      if (!consoleApi.createTask_v2.permission()) {
        addLog("[ERROR] " + t("noPermissionToCreateTask"));
        throw new Error("No permission to create task");
      }
      setCurrentCollectionStage("collecting");
      setCollectionStartTime(dayjs().format(LOG_TIMESTAMP_FORMAT));
      break;
    }

    case "endCollection":
      addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("endingCollection")}`);
      break;

    case "cancelCollection":
      addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("cancellingCollection")}`);
      break;

    default:
      addLog(`[ERROR] ${t("unknownButtonType")}: ${buttonType}`);
      throw new Error(`Unknown button type: ${buttonType}`);
  }
}

export function handleServiceResponse(
  buttonType: ButtonType,
  response: StartCollectionResponse | EndCollectionResponse | CancelCollectionResponse,
  addLog: (log: string) => void,
  t: TFunction<"dataCollection">,
  startTimer: () => void,
  stopTimer: () => void,
  setCurrentCollectionStage: (stage: CollectionStage) => void,
  createDataCollectionTask: (params: CreateDataCollectionTaskParams) => void,
  projectState: ProjectState,
): void {
  switch (buttonType) {
    case "startCollection":
      if (response.success) {
        addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("startCollectionSuccess")}`);
        startTimer();
      } else {
        addLog(`[ERROR] ${t("startCollectionFail")}: ${response.message}`);
        setCurrentCollectionStage("ready");
        stopTimer();
      }
      break;

    case "endCollection":
      if (response.success) {
        addLog("+++++++++++++++++++++++++++");
        addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("endCollectionSuccess")}`);
        addLog("+++++++++++++++++++++++++++");

        // createDataCollectionTask 前保存 projectName, recordLabels, currentFocusedTask 的快照
        // currentCollectionStage 为 ready 时，将可以修改这些参数
        const { projectName, recordLabels, currentFocusedTask } = projectState;
        setCurrentCollectionStage("ready");
        stopTimer();
        if ("type" in response && response.type === "SKIP_CAPTURE") {
          return;
        }
        createDataCollectionTask({
          endCollectionResponse: response as EndCollectionResponse,
          projectName,
          recordLabels,
          focusedTask: currentFocusedTask,
        });
      } else {
        addLog(`[ERROR] ${t("endCollectionFail")}: ${response.message}`);
      }
      break;

    case "cancelCollection":
      if (response.success) {
        addLog("+++++++++++++++++++++++++++");
        addLog(`[${dayjs().format(LOG_TIMESTAMP_FORMAT)}] ${t("cancelCollectionSuccess")}`);
        addLog("+++++++++++++++++++++++++++");
        setCurrentCollectionStage("ready");
        stopTimer();
      } else {
        addLog(`[ERROR] ${t("cancelCollectionFail")}: ${response.message}`);
      }
      break;

    default:
      addLog(`[ERROR] ${t("unknownButtonType")}: ${buttonType}`);
      return;
  }
}
