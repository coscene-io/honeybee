// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

enum Endpoint {
  CreateAction = "coscene.matrix.v1alpha2.services.ActionService.CreateAction",
  DeleteAction = "coscene.matrix.v1alpha2.services.ActionService.DeleteAction",
  GetAction = "coscene.matrix.v1alpha2.services.ActionService.GetAction",
  ListActions = "coscene.matrix.v1alpha2.services.ActionService.ListActions",
  UpdateAction = "coscene.matrix.v1alpha2.services.ActionService.UpdateAction",

  CreateActionRun = "coscene.matrix.v1alpha2.services.ActionRunService.CreateActionRun",
  BatchCreateActionRuns = "coscene.matrix.v1alpha2.services.ActionRunService.BatchCreateActionRuns",
  GetActionRun = "coscene.matrix.v1alpha2.services.ActionRunService.GetActionRun",
  ListActionRuns = "coscene.matrix.v1alpha2.services.ActionRunService.ListActionRuns",
  PreviewActionRunInputs = "coscene.matrix.v1alpha2.services.ActionRunService.PreviewActionRunInputs",
  TerminateActionRun = "coscene.matrix.v1alpha2.services.ActionRunService.TerminateActionRun",
  WatchActionRun = "coscene.matrix.v1alpha2.services.ActionRunService.WatchActionRun",
  BatchGetRecordLatestActionRuns = "coscene.matrix.v1alpha2.services.ActionRunService.BatchGetRecordLatestActionRuns",

  CountJobRunLog = "coscene.matrix.v1alpha2.services.JobRunService.CountJobRunLog",
  GenerateJobRunLogDownloadUrl = "coscene.matrix.v1alpha2.services.JobRunService.GenerateJobRunLogDownloadUrl",
  GenerateJobRunOutputDownloadUrl = "coscene.matrix.v1alpha2.services.JobRunService.GenerateJobRunOutputDownloadUrl",
  GetJobRun = "coscene.matrix.v1alpha2.services.JobRunService.GetJobRun",
  GetJobRunDag = "coscene.matrix.v1alpha2.services.JobRunService.GetJobRunDag",
  GetJobRunInputs = "coscene.matrix.v1alpha2.services.JobRunService.GetJobRunInputs",
  GetJobRunOutputs = "coscene.matrix.v1alpha2.services.JobRunService.GetJobRunOutputs",
  ListJobRuns = "coscene.matrix.v1alpha2.services.JobRunService.ListJobRuns",
  SaveJobRunOutputs = "coscene.matrix.v1alpha2.services.JobRunService.SaveJobRunOutputs",
  WatchJobRunDag = "coscene.matrix.v1alpha2.services.JobRunService.WatchJobRunDag",

  ListLabels = "coscene.matrix.v1alpha2.services.LabelService.ListLabels",
  CreateLabel = "coscene.matrix.v1alpha2.services.LabelService.CreateLabel",
  UpdateLabel = "coscene.matrix.v1alpha2.services.LabelService.UpdateLabel",
  DeleteLabel = "coscene.matrix.v1alpha2.services.LabelService.DeleteLabel",

  ListTriggers = "coscene.matrix.v1alpha2.services.TriggerService.ListTriggers",
  CreateTrigger = "coscene.matrix.v1alpha2.services.TriggerService.CreateTrigger",
  GetTrigger = "coscene.matrix.v1alpha2.services.TriggerService.GetTrigger",
  UpdateTrigger = "coscene.matrix.v1alpha2.services.TriggerService.UpdateTrigger",
  DeleteTrigger = "coscene.matrix.v1alpha2.services.TriggerService.DeleteTrigger",
}

export default Endpoint;
