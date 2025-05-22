// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

enum Endpoint {
  BatchDeleteFiles = "coscene.dataplatform.v1alpha3.services.FileService.BatchDeleteFiles",
  CopyFiles = "coscene.dataplatform.v1alpha3.services.FileService.CopyFiles",
  MoveFiles = "coscene.dataplatform.v1alpha3.services.FileService.MoveFiles",
  CreateFile = "coscene.dataplatform.v1alpha3.services.FileService.CreateFile",
  DeleteFile = "coscene.dataplatform.v1alpha3.services.FileService.DeleteFile",
  DownloadFiles = "coscene.dataplatform.v1alpha3.services.FileService.DownloadFiles",
  GenerateFileDownloadUrl = "coscene.dataplatform.v1alpha3.services.FileService.GenerateFileDownloadUrl",
  GenerateFileUploadUrls = "coscene.dataplatform.v1alpha3.services.FileService.GenerateFileUploadUrls",
  GetFile = "coscene.dataplatform.v1alpha3.services.FileService.GetFile",
  ListFileRevisions = "coscene.dataplatform.v1alpha3.services.FileService.ListFileRevisions",
  ListFiles = "coscene.dataplatform.v1alpha3.services.FileService.ListFiles",
  RenameFile = "coscene.dataplatform.v1alpha3.services.FileService.RenameFile",
  RevertFileRevision = "coscene.dataplatform.v1alpha3.services.FileService.RevertFileRevision",
  UpdateFile = "coscene.dataplatform.v1alpha3.services.FileService.UpdateFile",

  AddTaskTags = "coscene.dataplatform.v1alpha3.services.TaskService.AddTaskTags",
  CreateTask = "coscene.dataplatform.v1alpha3.services.TaskService.CreateTask",
  DeleteAnnotationConfig = "coscene.dataplatform.v1alpha3.services.TaskService.DeleteAnnotationConfig",
  DeleteTask = "coscene.dataplatform.v1alpha3.services.TaskService.DeleteTask",
  GetAnnotationConfig = "coscene.dataplatform.v1alpha3.services.TaskService.GetAnnotationConfig",
  GetTask = "coscene.dataplatform.v1alpha3.services.TaskService.GetTask",
  ListDeviceTasks = "coscene.dataplatform.v1alpha3.services.TaskService.ListDeviceTasks",
  ListTasks = "coscene.dataplatform.v1alpha3.services.TaskService.ListTasks",
  SyncTask = "coscene.dataplatform.v1alpha3.services.TaskService.SyncTask",
  UpdateTask = "coscene.dataplatform.v1alpha3.services.TaskService.UpdateTask",
  UpsertAnnotationConfig = "coscene.dataplatform.v1alpha3.services.TaskService.UpsertAnnotationConfig",

  GetDiagnosisRuleSetsMetadata = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleSetService.GetDiagnosisRuleSetsMetadata",
  ListDiagnosisRuleSets = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleSetService.ListDiagnosisRuleSets",
  CreateDiagnosisRuleSet = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleSetService.CreateDiagnosisRuleSet",
  DeleteDiagnosisRuleSet = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleSetService.DeleteDiagnosisRuleSet",
  UpdateDiagnosisRuleSet = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleSetService.UpdateDiagnosisRuleSet",

  GetDiagnosisRule = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleService.GetDiagnosisRule",
  UpsertDiagnosisRule = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleService.UpsertDiagnosisRule",
  ValidateDiagnosisRule = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleService.ValidateDiagnosisRule",
  DeleteDiagnosisRule = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleService.DeleteDiagnosisRule",
  HitDiagnosisRule = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleService.HitDiagnosisRule",
  CountDiagnosisRuleHits = "coscene.dataplatform.v1alpha3.services.DiagnosisRuleService.CountDiagnosisRuleHits",

  GetFilesType = "coscene.dataplatform.v1alpha3.services.FileService.GetFilesType",
  SetFileType = "coscene.dataplatform.v1alpha3.services.FileService.SetFileType",

  AddCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.AddCustomFieldProperties",
  AddDeviceCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.AddDeviceCustomFieldProperties",
  AddMomentCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.AddMomentCustomFieldProperties",
  AddRecordCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.AddRecordCustomFieldProperties",
  AddTaskCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.AddTaskCustomFieldProperties",
  GetCustomFieldSchema = "coscene.dataplatform.v1alpha3.services.CustomFieldService.GetCustomFieldSchema",
  GetDeviceCustomFieldSchema = "coscene.dataplatform.v1alpha3.services.CustomFieldService.GetDeviceCustomFieldSchema",
  GetMomentCustomFieldSchema = "coscene.dataplatform.v1alpha3.services.CustomFieldService.GetMomentCustomFieldSchema",
  GetRecordCustomFieldSchema = "coscene.dataplatform.v1alpha3.services.CustomFieldService.GetRecordCustomFieldSchema",
  GetTaskCustomFieldSchema = "coscene.dataplatform.v1alpha3.services.CustomFieldService.GetTaskCustomFieldSchema",
  RemoveCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.RemoveCustomFieldProperties",
  RemoveDeviceCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.RemoveDeviceCustomFieldProperties",
  RemoveMomentCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.RemoveMomentCustomFieldProperties",
  RemoveRecordCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.RemoveRecordCustomFieldProperties",
  RemoveTaskCustomFieldProperties = "coscene.dataplatform.v1alpha3.services.CustomFieldService.RemoveTaskCustomFieldProperties",
}

export default Endpoint;
