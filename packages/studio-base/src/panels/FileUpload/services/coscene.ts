// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { File as File_es } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { Task, UploadTaskDetail } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { LinkTaskWrapper } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/task_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { Timestamp } from "@bufbuild/protobuf";
import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";

import CoSceneConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { ListUserProjectsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_pb";
import { ListLabelsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/label_pb";
import { GenerateFileUploadUrlsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_pb";
import { generateFileName } from "@foxglove/studio-base/util/coscene/upload";
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
      { id: "proj-3", name: "Demo – Shenzhen" }
    ];
  }

  async listTags(projectId: string): Promise<Label[]> {
    await delay(80);
    const map: Record<string, string[]> = {
      "proj-1": ["slam", "localization", "regression", "night-run"],
      "proj-2": ["navigation", "failpoint", "sensor", "charging"],
      "proj-3": ["demo", "warehouse", "dc-fast", "qa"]
    };
    const tagNames = map[projectId] || [];
    // Convert string[] to Label[] for mock data
    return tagNames.map(name => new Label({ name, displayName: name }));
  }

  async upload(
    _files: FileCandidate[],
    _cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void
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
      // Fallback to mock data if API fails
      await delay(100);
      return [
        { id: "proj-1", name: "Warehouse Nav Benchmark" },
        { id: "proj-2", name: "CleaningBot Field Test" },
        { id: "proj-3", name: "Demo – Shenzhen" }
      ];
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
      
      console.log(`[标签获取] 解析项目路径: ${projectId} -> warehouseId: ${warehouseId}, projectId: ${actualProjectId}`);
      
      const response = await this.api.listLabels({
        pageSize: 100,
        warehouseId,
        projectId: actualProjectId,
      });
      
      console.log(`[标签获取] 项目${projectId}获取到${response.labels.length}个标签`);
      return response.labels;
    } catch (error) {
      console.error("Failed to list tags:", error);
      // Fallback to mock data if API fails
      await delay(80);
      const map: Record<string, string[]> = {
        "proj-1": ["slam", "localization", "regression", "night-run"],
        "proj-2": ["navigation", "failpoint", "sensor", "charging"],
        "proj-3": ["demo", "warehouse", "dc-fast", "qa"]
      };
      const tagNames = map[projectId] || [];
      // Convert string[] to Label[] for fallback data
      return tagNames.map(name => new Label({ name, displayName: name }));
    }
  }

  async upload(
    files: FileCandidate[],
    cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void
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
      const labelMessages = (cfg.tags ?? []).map(tag => {
        if (typeof tag === 'string') {
          return new Label({ name: tag, displayName: tag });
        }
        return tag;
      });
      
      console.log(`[记录创建] 创建记录: ${recordTitle}`);
      console.log(`[记录创建] 标签信息: [${labelMessages.map(l => l.displayName || l.name).join(', ')}]`);
      
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

      // Convert FileCandidate to File_es format for API with proper file naming using record name
      const fileRequests = files.map((fileCandidate) => {
        const properName = generateFileName({
          filename: fileCandidate.name,
          recordName: recordName, // Use record name instead of project ID
        });
        
        console.log(`[文件名生成] 原始: ${fileCandidate.name}, 生成: ${properName}`);
        
        return new File_es({
          filename: fileCandidate.name,
          name: properName,
          size: BigInt(fileCandidate.sizeBytes || 0),
        });
      });

      onProgress?.(25);

      // Generate upload URLs with record as parent (this will associate files with the record)
      const uploadResponse = await this.api.generateFileUploadUrls({
        files: fileRequests,
        parent: recordName, // Use record name as parent to associate files with record
      });

      onProgress?.(30);

      // Upload each file to its pre-signed URL
      const uploadPromises = files.map(async (fileCandidate, index) => {
        const fileRequest = fileRequests[index];
        const uploadUrl = fileRequest ? uploadResponse.preSignedUrls[fileRequest.name] : undefined;
        
        console.log(`[上传URL] 文件: ${fileCandidate.name}, URL存在: ${!!uploadUrl}`);
        
        if (!uploadUrl) {
          throw new Error(`No upload URL generated for file: ${fileCandidate.name}`);
        }

        // Create a mock file for demonstration (in real usage, this would be the actual file)
        const mockFile = new File([`Mock content for ${fileCandidate.name}`], fileCandidate.name, {
          type: "application/octet-stream",
        });

        const response = await fetch(uploadUrl, {
          method: "PUT",
          body: mockFile,
        });

        if (!response.ok) {
          throw new Error(`Failed to upload ${fileCandidate.name}: ${response.statusText}`);
        }
      });

      await Promise.all(uploadPromises);
      onProgress?.(80);

      // Files are now uploaded and associated with the record
      console.log(`[文件上传] ${files.length} 个文件已成功上传并关联到记录: ${recordName}`);
      
      // Now create a task and link it to the record
       if (cfg.projectId) {
         try {
          // Extract warehouse and project IDs for device lookup
          const warehouseId = cfg.projectId!.split('/')[1]!;
          const projectId = cfg.projectId!.split('/')[3]!; // Extract only the project ID part
          
          // Extract device name from config - handle both string and object formats
             let deviceInfo = cfg.device;
             
             if (cfg.device) {
               if (typeof cfg.device === 'object' && 'name' in cfg.device && cfg.device.name) {
                 // If device.name is a full path like "warehouses/xxx/projects/xxx/devices/device-id"
                 deviceName = `devices/${cfg.device.name.split("/").pop()}`;
               } else if (typeof cfg.device === 'string') {
                 // If device is just a string ID
                 const deviceStr = cfg.device as string;
                 deviceName = deviceStr.startsWith('devices/') ? deviceStr : `devices/${deviceStr}`;
               }
             } else {
                 // Try to get first device from project as fallback
                 console.warn("[任务创建] 设备信息不可用，尝试从项目获取第一个设备");
                 try {
                   const projectDevicesResponse = await this.api.listProjectDevices({
                      warehouseId: warehouseId,
                      projectId: projectId,
                      filter: CosQuery.Companion.empty(),
                      pageSize: 1,
                      currentPage: 0
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
              const labelStrings = (cfg.tags ?? []).map(tag => 
                typeof tag === 'string' ? tag : (tag.displayName || tag.name)
              );
              console.log(`[任务创建] 标签信息: [${labelStrings.join(', ')}]`);
              
              console.log(`[任务创建] 任务标题: ${taskTitle}`);
              console.log(`[任务创建] 使用项目名称: ${cfg.projectId}`);
              console.log(`[任务创建] 关联记录: ${recordName}`);
              
              const newTask = new Task({
                 assigner: `users/${currentUser.name.split("/").pop()}`,
                 category: TaskCategoryEnum_TaskCategory.UPLOAD,
                 description: recordName ? `Files uploaded to record: ${recordName}` : "",
                 detail: {
                   case: "uploadTaskDetail",
                   value: new UploadTaskDetail({
                     device: deviceName,
                     scanFolders: [], // TODO: set actual scan folders if needed  
                     endTime: Timestamp.fromDate(new Date()),
                     startTime: Timestamp.fromDate(new Date()),
                     labels: labelStrings,
                   }),
                 },
                 title: taskTitle,
                 // Set tags to include recordName for proper linking
                 tags: recordName ? { recordName } : {},
               });
              
              const createdTask = await this.api.createTask_v2({
                parent: cfg.projectId!,
                task: newTask,
              });
              
              // Link the task to the record if both exist
               if (recordName && createdTask.name) {
                 try {
                   console.log(`[任务关联] 将任务 ${createdTask.name} 关联到记录 ${recordName}`);
                   await this.api.linkTasks({
                     project: cfg.projectId,
                     linkTasks: [new LinkTaskWrapper({
                       task: createdTask.name,
                       target: { value: recordName, case: "record" },
                     })],
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
      if (cfg.projectId && deviceName) {
        return { 
          success: true, 
          taskName: `${cfg.projectId}/tasks/${taskTitle}`,
          recordName: recordName || undefined
        };
      }
      
      return { success: true, recordName: recordName || undefined };
    } catch (error) {
      console.error("File upload failed:", error);
      throw new Error(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}