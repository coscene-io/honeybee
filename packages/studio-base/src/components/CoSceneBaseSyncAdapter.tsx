// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const log = Logger.getLogger(__filename);

const selectSetProjects = (state: CoSceneBaseStore) => state.setProject;
const selectSetRecord = (state: CoSceneBaseStore) => state.setRecord;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectRecord = (store: CoSceneBaseStore) => store.record;
const selectProject = (store: CoSceneBaseStore) => store.project;
const selectSetRecordCustomFieldSchema = (state: CoSceneBaseStore) =>
  state.setRecordCustomFieldSchema;

export function BaseSyncAdapter(): ReactNull {
  const baseInfo = useBaseInfo(selectBaseInfo);
  const setProject = useBaseInfo(selectSetProjects);
  const setRecord = useBaseInfo(selectSetRecord);
  const record = useBaseInfo(selectRecord);
  const project = useBaseInfo(selectProject);
  const setRecordCustomFieldSchema = useBaseInfo(selectSetRecordCustomFieldSchema);

  const consoleApi = useConsoleApi();

  const [_projects, syncProjects] = useAsyncFn(async () => {
    if (baseInfo.value?.warehouseId && baseInfo.value.projectId && project.loading) {
      const projectName = `warehouses/${baseInfo.value.warehouseId}/projects/${baseInfo.value.projectId}`;
      const targetProject = await consoleApi.getProject({ projectName });

      setProject({ loading: false, value: targetProject });
    }
  }, [
    consoleApi,
    setProject,
    baseInfo.value?.warehouseId,
    baseInfo.value?.projectId,
    project.loading,
  ]);

  const [_record, syncRecord] = useAsyncFn(async () => {
    if (
      baseInfo.value?.recordId &&
      baseInfo.value.warehouseId &&
      baseInfo.value.projectId &&
      record.loading
    ) {
      const targetRecord = await consoleApi.getRecord({
        recordName: `warehouses/${baseInfo.value.warehouseId}/projects/${baseInfo.value.projectId}/records/${baseInfo.value.recordId}`,
      });
      setRecord({ loading: false, value: targetRecord });
    }
  }, [
    consoleApi,
    setRecord,
    baseInfo.value?.recordId,
    baseInfo.value?.warehouseId,
    baseInfo.value?.projectId,
    record.loading,
  ]);

  const [_customFieldSchema, syncCustomFieldSchema] = useAsyncFn(async () => {
    if (
      baseInfo.value?.recordId &&
      baseInfo.value.warehouseId &&
      baseInfo.value.projectId &&
      record.loading
    ) {
      const customFieldSchema = await consoleApi.getRecordCustomFieldSchema(
        `warehouses/${baseInfo.value.warehouseId}/projects/${baseInfo.value.projectId}`,
      );
      setRecordCustomFieldSchema(customFieldSchema);
    }
  }, [
    baseInfo.value?.recordId,
    baseInfo.value?.warehouseId,
    baseInfo.value?.projectId,
    record.loading,
    consoleApi,
    setRecordCustomFieldSchema,
  ]);

  useEffect(() => {
    syncProjects().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncProjects]);

  useEffect(() => {
    syncRecord().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncRecord]);

  useEffect(() => {
    syncCustomFieldSchema().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncCustomFieldSchema]);

  return ReactNull;
}
