// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import {
  LabelSchema,
  Label,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/label_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import {
  TaskSchema,
  UploadTaskDetailSchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/resources/task_pb";

import CoSceneConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { CosQuery } from "@foxglove/studio-base/util/coscene/cosel";

import type { CoSceneClient, FileCandidate, UploadConfig } from "../types";
import { delay } from "../utils/format";

/** Mock 版本：项目/标签查询 + 模拟上传进度 */
export class MockCoSceneClient implements CoSceneClient {
  public async listProjects(): Promise<{ id: string; name: string }[]> {
    await delay(100);
    return [
      { id: "proj-1", name: "Warehouse Nav Benchmark" },
      { id: "proj-2", name: "CleaningBot Field Test" },
      { id: "proj-3", name: "Demo – Shenzhen" },
    ];
  }

  public async listTags(projectId: string): Promise<Label[]> {
    await delay(80);
    const map: Record<string, string[]> = {
      "proj-1": ["slam", "localization", "regression", "night-run"],
      "proj-2": ["navigation", "failpoint", "sensor", "charging"],
      "proj-3": ["demo", "warehouse", "dc-fast", "qa"],
    };
    const tagNames = map[projectId] ?? [];
    // Convert string[] to Label[] for mock data
    return tagNames.map((name) => create(LabelSchema, { name, displayName: name }));
  }

  public async upload(
    _files: FileCandidate[],
    _cfg: Partial<UploadConfig> & { projectId: string | undefined },
    onProgress?: (p: number) => void,
  ): Promise<{ taskName?: string; recordName?: string; success: boolean }> {
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await delay(80);
      onProgress?.(Math.round((i / steps) * 100));
    }
    return { success: true };
  }
}

/**
 * Real API版本：使用CoSceneConsoleApi进行真实的API调用
 */
export class RealCoSceneClient implements CoSceneClient {
  #api: CoSceneConsoleApi;

  public constructor(api: CoSceneConsoleApi) {
    this.#api = api;
  }

  public async listProjects(): Promise<{ id: string; name: string }[]> {
    try {
      // Get current user to use their ID for listing projects
      const currentUser = await this.#api.getUser("users/current");
      const userId = currentUser.name.split("/")[1] ?? "current";

      const response = await this.#api.listUserProjects({
        userId,
        pageSize: 100,
        currentPage: 0,
      });

      return response.userProjects.map((project) => ({
        id: project.name,
        name: project.displayName || project.name.split("/").pop()!,
      }));
    } catch (error) {
      console.error("Failed to list projects:", error);
      throw error;
    }
  }

  public async listTags(projectId: string): Promise<Label[]> {
    try {
      // Extract warehouse ID and project ID from the full project name
      // Expected format: "warehouses/{warehouseId}/projects/{projectId}"
      let warehouseId: string;
      let actualProjectId: string;

      if (projectId.includes("/")) {
        const match = projectId.match(/warehouses\/([^/]+)\/projects\/([^/]+)/);
        if (match) {
          warehouseId = match[1]!;
          actualProjectId = match[2]!;
        } else {
          // Fallback: assume it's just the project ID
          warehouseId = "default";
          actualProjectId = projectId.split("/").pop() ?? projectId;
        }
      } else {
        warehouseId = "default";
        actualProjectId = projectId;
      }

      const response = await this.#api.listLabels({
        pageSize: 100,
        warehouseId,
        projectId: actualProjectId,
      });

      return response.labels;
    } catch (error) {
      console.error("Failed to list tags:", error);
      throw error;
    }
  }

  public async upload(
    files: FileCandidate[],
    cfg: Partial<UploadConfig> & { projectId: string | undefined },
    onProgress?: (p: number) => void,
  ): Promise<{ taskName?: string; recordName?: string; success: boolean }> {
    try {
      if (!cfg.projectId) {
        throw new Error("Project ID is required for upload");
      }

      onProgress?.(5);

      // 准备任务创建信息
      let taskTitle = "";
      let deviceName = "";

      const currentUser = await this.#api.getUser("users/current");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      taskTitle = `file-upload-${timestamp}`;

      onProgress?.(15);

      // 注意：我们不需要实际上传文件内容
      // 文件/文件夹路径会通过 additionalFiles 参数传递给CoScene平台
      // CoScene平台会自己扫描和处理这些路径
      onProgress?.(80);

      // 创建任务（不创建记录）
      let createdTaskName: string | undefined;
      if (cfg.projectId) {
        try {
          // Extract warehouse and project IDs for device lookup
          const warehouseId = cfg.projectId.split("/")[1]!;
          const projectId = cfg.projectId.split("/")[3]!; // Extract only the project ID part

          // Extract device name from config - handle both string and object formats
          // const deviceInfo = cfg.device; // Unused variable

          if (cfg.device != undefined) {
            if (typeof cfg.device === "object" && "name" in cfg.device && cfg.device.name) {
              // If device.name is a full path like "warehouses/xxx/projects/xxx/devices/device-id"
              deviceName = `devices/${cfg.device.name.split("/").pop()}`;
            } else if (typeof cfg.device === "string") {
              // If device is just a string ID
              const deviceStr = cfg.device;
              deviceName = deviceStr.startsWith("devices/") ? deviceStr : `devices/${deviceStr}`;
            }
          } else {
            // Try to get first device from project as fallback
            try {
              const projectDevicesResponse = await this.#api.listProjectDevices({
                warehouseId,
                projectId,
                filter: CosQuery.Companion.empty(),
                pageSize: 1,
                currentPage: 0,
              });

              if (projectDevicesResponse.projectDevices.length > 0) {
                const firstDevice = projectDevicesResponse.projectDevices[0]!;
                deviceName = firstDevice.name;
              } else {
                deviceName = "";
              }
            } catch {
              deviceName = "";
            }
          }

          // Only create task if we have device information
          if (deviceName) {
            // Convert tags to string[] for task creation
            const labelStrings = (cfg.tags ?? []).map((tag) =>
              typeof tag === "string" ? tag : tag.displayName || tag.name,
            );

            // 准备要上传的文件路径列表
            const filePaths = files.map((file) => {
              const fileWithPath = file as FileCandidate & { originalPath?: string };
              return fileWithPath.originalPath ?? file.name;
            });

            const newTask = create(TaskSchema, {
              assigner: `users/${currentUser.name.split("/").pop()}`,
              category: TaskCategoryEnum_TaskCategory.UPLOAD,
              description: `Files uploaded containing ${files.length} file(s)`,
              detail: {
                case: "uploadTaskDetail",
                value: create(UploadTaskDetailSchema, {
                  device: deviceName,
                  additionalFiles: filePaths, // 使用additionalFiles传递文件路径
                  labels: labelStrings,
                }),
              },
              title: taskTitle,
            });

            const createdTask = await this.#api.createTask_v2({
              parent: cfg.projectId,
              task: newTask,
            });

            // Store the actual created task name (this is the real task ID)
            createdTaskName = createdTask.name;
          }
        } catch (taskError) {
          console.warn("Failed to create task for upload:", taskError);
          // Don't fail the entire upload if task creation fails
        }
      }

      onProgress?.(100);

      // Return success with task information if created
      return {
        success: true,
        taskName: createdTaskName ?? undefined,
        recordName: undefined, // 不创建记录
      };
    } catch (error) {
      console.error("[CoScene上传] 上传失败:", error);
      throw error;
    }
  }
}
