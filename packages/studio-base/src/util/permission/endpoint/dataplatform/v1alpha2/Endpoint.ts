// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

enum Endpoint {
  AuthorizeDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.AuthorizeDevice",
  BatchAuthorizeDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.BatchAuthorizeDevicesRequest",
  BatchStatDevices = "coscene.dataplatform.v1alpha2.services.DeviceService.BatchStatDevices",
  BatchStatDeviceUsage = "coscene.dataplatform.v1alpha2.services.DeviceService.BatchStatDeviceUsage",
  BatchStatOnlineDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.BatchStatOnlineDevice",
  CreateDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.CreateDevice",
  DeleteDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.DeleteDevice",
  GetDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.GetDevice",
  GetDeviceCustomFieldSchema = "coscene.dataplatform.v1alpha2.services.DeviceService.GetDeviceCustomFieldSchema",
  ListDevices = "coscene.dataplatform.v1alpha2.services.DeviceService.ListDevices",
  RevokeDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.RevokeDevice",
  StatOnlineDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.StatOnlineDevice",
  UpdateDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.UpdateDevice",
  UpsertDeviceCustomFieldSchema = "coscene.dataplatform.v1alpha2.services.DeviceService.UpsertDeviceCustomFieldSchema",

  AddProjectDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.AddProjectDevice",
  CreateProjectDevice = "coscene.dataplatform.v1alpha2.services.DeviceService.CreateProjectDevice",
  ListProjectDevices = "coscene.dataplatform.v1alpha2.services.DeviceService.ListProjectDevices",
  ListProjectExcludedDevices = "coscene.dataplatform.v1alpha2.services.DeviceService.ListProjectExcludedDevices",
  RemoveProjectDevices = "coscene.dataplatform.v1alpha2.services.DeviceService.RemoveProjectDevices",

  BatchDeleteFiles = "coscene.dataplatform.v1alpha2.services.FileService.BatchDeleteFiles",
  BatchGenerateFileMediaDownloadUrls = "coscene.dataplatform.v1alpha2.services.FileService.BatchGenerateFileMediaDownloadUrls",
  BatchGenerateFileMediaUploadUrls = "coscene.dataplatform.v1alpha2.services.FileService.BatchGenerateFileMediaUploadUrls",
  CopyFiles = "coscene.dataplatform.v1alpha2.services.FileService.CopyFiles",
  CreateFile = "coscene.dataplatform.v1alpha2.services.FileService.CreateFile",
  DeleteFile = "coscene.dataplatform.v1alpha2.services.FileService.DeleteFile",
  GenerateFileDownloadUrl = "coscene.dataplatform.v1alpha2.services.FileService.GenerateFileDownloadUrl",
  GenerateUploadUrls = "coscene.dataplatform.v1alpha2.services.FileService.GenerateUploadUrls",
  GetFile = "coscene.dataplatform.v1alpha2.services.FileService.GetFile",
  ListFiles = "coscene.dataplatform.v1alpha2.services.FileService.ListFiles",
  RefreshFileMedia = "coscene.dataplatform.v1alpha2.services.FileService.RefreshFileMedia",
  StatFiles = "coscene.dataplatform.v1alpha2.services.FileService.StatFiles",
  UpdateFile = "coscene.dataplatform.v1alpha2.services.FileService.UpdateFile",

  BatchArchiveRecords = "coscene.dataplatform.v1alpha2.services.RecordService.BatchArchiveRecords",
  BatchDeleteRecords = "coscene.dataplatform.v1alpha2.services.RecordService.BatchDeleteRecords",
  BatchGetRecords = "coscene.dataplatform.v1alpha2.services.RecordService.BatchGetRecords",
  BatchUnarchiveRecords = "coscene.dataplatform.v1alpha2.services.RecordService.BatchUnarchiveRecords",
  CopyRecords = "coscene.dataplatform.v1alpha2.services.RecordService.CopyRecords",
  CreateRecord = "coscene.dataplatform.v1alpha2.services.RecordService.CreateRecord",
  DeleteRecord = "coscene.dataplatform.v1alpha2.services.RecordService.DeleteRecord",
  GenerateRecordThumbnailUploadUrl = "coscene.dataplatform.v1alpha2.services.RecordService.GenerateRecordThumbnailUploadUrl",
  GetRecord = "coscene.dataplatform.v1alpha2.services.RecordService.GetRecord",
  ListRecords = "coscene.dataplatform.v1alpha2.services.RecordService.ListRecords",
  MergeRecords = "coscene.dataplatform.v1alpha2.services.RecordService.MergeRecords",
  MoveRecords = "coscene.dataplatform.v1alpha2.services.RecordService.MoveRecords",
  StatRecords = "coscene.dataplatform.v1alpha2.services.RecordService.StatRecords",
  UpdateRecord = "coscene.dataplatform.v1alpha2.services.RecordService.UpdateRecord",
  BatchUpdateRecord = "coscene.dataplatform.v1alpha2.services.RecordService.BatchUpdateRecord",
  GetRecordCustomFieldSchema = "coscene.dataplatform.v1alpha2.services.RecordService.GetRecordCustomFieldSchema",
  UpsertRecordCustomFieldSchema = "coscene.dataplatform.v1alpha2.services.RecordService.UpsertRecordCustomFieldSchema",

  ListComments = "coscene.dataplatform.v1alpha2.services.CommentService.ListComments",
  CreateComment = "coscene.dataplatform.v1alpha2.services.CommentService.CreateComment",
  DeleteComment = "coscene.dataplatform.v1alpha2.services.CommentService.DeleteComment",
  UpdateComment = "coscene.dataplatform.v1alpha2.services.CommentService.UpdateComment",

  ListAuditLogs = "coscene.dataplatform.v1alpha2.services.AuditLogService.ListAuditLogs",
  CreateAuditLog = "coscene.dataplatform.v1alpha2.services.AuditLogService.CreateAuditLog",

  // Layout endpoints
  CreateUserLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.CreateUserLayout",
  CreateProjectLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.CreateProjectLayout",
  GetUserLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.GetUserLayout",
  GetProjectLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.GetProjectLayout",
  ListUserLayouts = "coscene.dataplatform.v1alpha2.services.LayoutService.ListUserLayouts",
  ListProjectLayouts = "coscene.dataplatform.v1alpha2.services.LayoutService.ListProjectLayouts",
  UpdateUserLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.UpdateUserLayout",
  UpdateProjectLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.UpdateProjectLayout",
  DeleteUserLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.DeleteUserLayout",
  DeleteProjectLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.DeleteProjectLayout",
  // Keep old endpoints for compatibility during transition
  DeleteLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.DeleteLayout",
  GetLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.GetLayout",
  ListLayouts = "coscene.dataplatform.v1alpha2.services.LayoutService.ListLayouts",
  UpdateLayout = "coscene.dataplatform.v1alpha2.services.LayoutService.UpdateLayout",
}

export default Endpoint;
