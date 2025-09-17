// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import {
  Task,
  UploadTaskDetail,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { LinkTaskWrapper } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/task_pb";

import CoSceneConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { CosQuery } from "@foxglove/studio-base/util/coscene/cosel";

import type { CoSceneClient, FileCandidate, UploadConfig } from "../types";
import { delay } from "../utils/format";

/** Mock 版本：项目/标签查询 + 模拟上传进度 */
export class MockCoSceneClient implements CoSceneClient {
  async listProjects(): Promise<{ id: string; name: string }[]> {
    await delay(100);
    return [
      { id: "proj-1", name: "Warehouse Nav Benchmark" },
      { id: "proj-2", name: "CleaningBot Field Test" },
      { id: "proj-3", name: "Demo – Shenzhen" },
    ];
  }

  async listTags(projectId: string): Promise<Label[]> {
    await delay(80);
    const map: Record<string, string[]> = {
      "proj-1": ["slam", "localization", "regression", "night-run"],
      "proj-2": ["navigation", "failpoint", "sensor", "charging"],
      "proj-3": ["demo", "warehouse", "dc-fast", "qa"],
    };
    const tagNames = map[projectId] || [];
    // Convert string[] to Label[] for mock data
    return tagNames.map((name) => new Label({ name, displayName: name }));
  }

  async upload(
    _files: FileCandidate[],
    _cfg: Partial<UploadConfig> & { projectId: string | null },
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
  private api: CoSceneConsoleApi;

  constructor(api: CoSceneConsoleApi) {
    this.api = api;
  }

  async listProjects(): Promise<{ id: string; name: string }[]> {
    try {
      // Get current user to use their ID for listing projects
      const currentUser = await this.api.getUser("users/current");
      const userId = currentUser.name.split("/")[1] ?? "current";

      const response = await this.api.listUserProjects({
        userId,
        pageSize: 100,
        currentPage: 0,
      });

      return response.userProjects.map((project) => ({
        id: project.name,
        name: project.displayName || project.name.split("/").pop() || project.name,
      }));
    } catch (error) {
      console.error("Failed to list projects:", error);
      throw error;
    }
  }

  async listTags(projectId: string): Promise<Label[]> {
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

      console.log(
        `[标签获取] 解析项目路径: ${projectId} -> warehouseId: ${warehouseId}, projectId: ${actualProjectId}`,
      );

      const response = await this.api.listLabels({
        pageSize: 100,
        warehouseId,
        projectId: actualProjectId,
      });

      console.log(`[标签获取] 项目${projectId}获取到${response.labels.length}个标签`);
      return response.labels;
    } catch (error) {
      console.error("Failed to list tags:", error);
      throw error;
    }
  }

  async upload(
    files: FileCandidate[],
    cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void,
  ): Promise<{ taskName?: string; recordName?: string; success: boolean }> {
    try {
      if (!cfg.projectId) {
        throw new Error("Project ID is required for upload");
      }

      onProgress?.(5);

      // First, create a record for the uploaded files
      let recordName = "";
      let taskTitle = "";
      let deviceName = "";

      const currentUser = await this.api.getUser("users/current");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      taskTitle = `file-upload-${timestamp}`;

      // Create a record for the uploaded files
      const recordTitle = `Upload Record ${timestamp}`;
      const recordDescription = `Record created for file upload containing ${files.length} file(s)`;

      // Convert tags to Label[] for API compatibility
      const labelMessages = (cfg.tags ?? []).map((tag) => {
        if (typeof tag === "string") {
          return new Label({ name: tag, displayName: tag });
        }
        return tag;
      });

      console.log(`[记录创建] 创建记录: ${recordTitle}`);
      console.log(
        `[记录创建] 标签信息: [${labelMessages.map((l) => l.displayName || l.name).join(", ")}]`,
      );

      const createdRecord = await this.api.createRecord({
        parent: cfg.projectId,
        record: {
          title: recordTitle,
          description: recordDescription,
          labels: labelMessages, // Add labels to the record
        },
      });

      recordName = createdRecord.name;
      console.log(`[记录创建] 记录创建成功: ${recordName}`);

      onProgress?.(15);

      // 注意：我们不需要实际上传文件内容
      // 文件/文件夹路径会通过 additionalFiles 参数传递给CoScene平台
      // CoScene平台会自己扫描和处理这些路径
      console.log(`[文件处理] 跳过文件内容上传，文件路径将通过additionalFiles传递给CoScene平台`);
      console.log(
        `[文件处理] 文件路径列表: [${files
          .map((f) => (f as any).originalPath || f.name)
          .join(", ")}]`,
      );
      onProgress?.(80);

      // 文件路径已准备就绪，将通过任务传递给CoScene平台
      console.log(
        `[文件处理] ${files.length} 个文件路径已准备就绪，将通过任务传递给CoScene平台: ${recordName}`,
      );

      // Now create a task and link it to the record
      let createdTaskName: string | undefined;
      if (cfg.projectId) {
        try {
          // Extract warehouse and project IDs for device lookup
          const warehouseId = cfg.projectId.split("/")[1]!;
          const projectId = cfg.projectId.split("/")[3]!; // Extract only the project ID part

          // Extract device name from config - handle both string and object formats
          const deviceInfo = cfg.device;

          if (cfg.device) {
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
            console.warn("[任务创建] 设备信息不可用，尝试从项目获取第一个设备");
            try {
              const projectDevicesResponse = await this.api.listProjectDevices({
                warehouseId,
                projectId,
                filter: CosQuery.Companion.empty(),
                pageSize: 1,
                currentPage: 0,
              });

              if (projectDevicesResponse.projectDevices.length > 0) {
                const firstDevice = projectDevicesResponse.projectDevices[0]!;
                deviceName = firstDevice.name;
                console.log("[任务创建] 使用项目中的第一个设备:", deviceName);
              } else {
                console.warn("[任务创建] 项目中没有找到设备，跳过任务创建");
                deviceName = "";
              }
            } catch (error) {
              console.error("[任务创建] 获取项目设备失败:", error);
              deviceName = "";
            }
          }

          // Only create task if we have device information
          if (deviceName) {
            console.log("[任务创建] 设备信息:", deviceInfo);
            console.log("[任务创建] 提取的设备名称:", deviceName);
            // Convert tags to string[] for task creation
            const labelStrings = (cfg.tags ?? []).map((tag) =>
              typeof tag === "string" ? tag : tag.displayName || tag.name,
            );
            console.log(`[任务创建] 标签信息: [${labelStrings.join(", ")}]`);

            console.log(`[任务创建] 任务标题: ${taskTitle}`);
            console.log(`[任务创建] 使用项目名称: ${cfg.projectId}`);
            console.log(`[任务创建] 关联记录: ${recordName}`);

            // 准备要上传的文件路径列表
            const filePaths = files.map((file) => {
              const fileWithPath = file as FileCandidate & { originalPath?: string };
              return fileWithPath.originalPath ?? file.name;
            });
            console.log(`[任务创建] 文件路径列表: [${filePaths.join(", ")}]`);

            const newTask = new Task({
              assigner: `users/${currentUser.name.split("/").pop()}`,
              category: TaskCategoryEnum_TaskCategory.UPLOAD,
              description: recordName ? `Files uploaded to record: ${recordName}` : "",
              detail: {
                case: "uploadTaskDetail",
                value: new UploadTaskDetail({
                  device: deviceName,
                  additionalFiles: filePaths, // 使用additionalFiles传递文件路径
                  labels: labelStrings,
                }),
              },
              title: taskTitle,
              // Set tags to include recordName for proper linking
              tags: recordName ? { recordName } : {},
            });

            // 打印任务创建前的详细信息
            console.log("=== 任务创建详细信息 ===");
            console.log(`[任务信息] 任务标题: ${taskTitle}`);
            console.log(`[任务信息] 分配者: users/${currentUser.name.split("/").pop()}`);
            console.log(`[任务信息] 任务类别: UPLOAD`);
            console.log(
              `[任务信息] 任务描述: ${recordName ? `Files uploaded to record: ${recordName}` : ""}`,
            );
            console.log(`[任务信息] 父级项目: ${cfg.projectId}`);
            console.log(`[任务信息] 设备信息: ${deviceName}`);
            console.log(`[任务信息] 文件路径列表 (${filePaths.length}个):`);
            filePaths.forEach((path, index) => {
              console.log(`  ${index + 1}. ${path}`);
            });
            console.log(
              `[任务信息] 标签列表 (${labelStrings.length}个): [${labelStrings.join(", ")}]`,
            );
            console.log(`[任务信息] 记录关联: ${recordName ? recordName : "无"}`);
            console.log("========================");

            const createdTask = await this.api.createTask_v2({
              parent: cfg.projectId,
              task: newTask,
            });

            // Store the actual created task name (this is the real task ID)
            createdTaskName = createdTask.name;
            console.log(`[任务创建] 任务创建成功，任务ID: ${createdTaskName}`);

            // 打印任务创建成功后的详细信息
            console.log("=== 任务创建成功详情 ===");
            console.log(`[任务结果] 任务ID: ${createdTaskName}`);
            console.log(`[任务结果] 任务名称: ${createdTask.title || "未设置"}`);
            console.log(`[任务结果] 任务状态: ${createdTask.state || "未设置"}`);
            console.log(
              `[任务结果] 创建时间: ${
                createdTask.createTime
                  ? new Date(Number(createdTask.createTime.seconds) * 1000).toISOString()
                  : "未设置"
              }`,
            );
            console.log(`[任务结果] 分配者: ${createdTask.assigner || "未设置"}`);
            console.log(`[任务结果] 任务类别: ${createdTask.category || "未设置"}`);
            if (createdTask.detail.case === "uploadTaskDetail") {
              const uploadDetail = createdTask.detail.value;
              console.log(`[任务结果] 设备: ${uploadDetail.device || "未设置"}`);
              console.log(
                `[任务结果] 附加文件数量: ${uploadDetail.additionalFiles.length > 0 || 0}`,
              );
              if (uploadDetail.additionalFiles && uploadDetail.additionalFiles.length > 0) {
                console.log(`[任务结果] 附加文件列表:`);
                uploadDetail.additionalFiles.forEach((file, index) => {
                  console.log(`  ${index + 1}. ${file}`);
                });
              }
              console.log(`[任务结果] 标签: [${uploadDetail.labels.join(", ") || "无"}]`);
            }
            console.log("========================");

            // Link the task to the record if both exist
            if (recordName && createdTask.name) {
              try {
                console.log(`[任务关联] 将任务 ${createdTask.name} 关联到记录 ${recordName}`);
                await this.api.linkTasks({
                  project: cfg.projectId,
                  linkTasks: [
                    new LinkTaskWrapper({
                      task: createdTask.name,
                      target: { value: recordName, case: "record" },
                    }),
                  ],
                });
                console.log("[任务关联] 任务与记录关联成功");
              } catch (linkError) {
                console.warn("[任务关联] 任务与记录关联失败:", linkError);
              }
            }
          } else {
            console.log("[任务创建] 跳过任务创建，设备信息不可用");
          }
        } catch (taskError) {
          console.warn("Failed to create task for upload:", taskError);
          // Don't fail the entire upload if task creation fails
        }
      }

      onProgress?.(100);

      // Return success with task and record information if created
      // Use the actual created task name instead of constructed taskName
      return {
        success: true,
        taskName: createdTaskName || undefined,
        recordName: recordName || undefined,
      };
    } catch (error) {
      console.error("File upload failed:", error);
      throw new Error(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
