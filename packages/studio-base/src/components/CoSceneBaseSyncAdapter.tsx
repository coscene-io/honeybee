// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useAsync, useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { Configuration, DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const log = Logger.getLogger(__filename);

const selectSetProjects = (state: CoSceneBaseStore) => state.setProject;
const selectSetRecord = (state: CoSceneBaseStore) => state.setRecord;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectRecord = (store: CoSceneBaseStore) => store.record;
const selectProject = (store: CoSceneBaseStore) => store.project;
const selectSetRecordCustomFieldSchema = (state: CoSceneBaseStore) =>
  state.setRecordCustomFieldSchema;
const selectSetDeviceCustomFieldSchema = (state: CoSceneBaseStore) =>
  state.setDeviceCustomFieldSchema;
const selectLoginStatus = (state: UserStore) => state.loginStatus;
const selectCoordinatorConfig = (state: CoSceneBaseStore) => state.coordinatorConfig;
const selectSetCoordinatorConfig = (state: CoSceneBaseStore) => state.setCoordinatorConfig;
const selectSetColinkApi = (state: CoSceneBaseStore) => state.setColinkApi;
const selectSetBaseInfo = (state: CoSceneBaseStore) => state.setBaseInfo;

export function BaseSyncAdapter(): ReactNull {
  const baseInfo = useBaseInfo(selectBaseInfo);
  const record = useBaseInfo(selectRecord);
  const project = useBaseInfo(selectProject);
  const coordinatorConfig = useBaseInfo(selectCoordinatorConfig);

  const loginStatus = useCurrentUser(selectLoginStatus);

  const setBaseInfo = useBaseInfo(selectSetBaseInfo);
  const setProject = useBaseInfo(selectSetProjects);
  const setRecord = useBaseInfo(selectSetRecord);
  const setRecordCustomFieldSchema = useBaseInfo(selectSetRecordCustomFieldSchema);
  const setDeviceCustomFieldSchema = useBaseInfo(selectSetDeviceCustomFieldSchema);
  const setCoordinatorConfig = useBaseInfo(selectSetCoordinatorConfig);
  const setColinkApi = useBaseInfo(selectSetColinkApi);

  const consoleApi = useConsoleApi();

  const [_projects, syncProjects] = useAsyncFn(async () => {
    if (baseInfo.value?.warehouseId && baseInfo.value.projectId && project.loading) {
      const projectName = `warehouses/${baseInfo.value.warehouseId}/projects/${baseInfo.value.projectId}`;
      const targetProject = await consoleApi.getProject({ projectName });

      setBaseInfo({
        loading: false,
        value: {
          ...baseInfo.value,
          projectDisplayName: targetProject.displayName,
          projectSlug: targetProject.slug,
        },
      });

      setProject({ loading: false, value: targetProject });
    }
  }, [baseInfo.value, project.loading, consoleApi, setBaseInfo, setProject]);

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
    if (baseInfo.value?.warehouseId && baseInfo.value.projectId) {
      const customFieldSchema = await consoleApi.getRecordCustomFieldSchema(
        `warehouses/${baseInfo.value.warehouseId}/projects/${baseInfo.value.projectId}`,
      );
      setRecordCustomFieldSchema(customFieldSchema);
    }
  }, [
    baseInfo.value?.warehouseId,
    baseInfo.value?.projectId,
    consoleApi,
    setRecordCustomFieldSchema,
  ]);

  useAsync(async () => {
    if (loginStatus === "alreadyLogin" && baseInfo.value?.organizationId) {
      const coordinatorConfig = await consoleApi.getCoordinatorConfig({
        currentOrganizationId: baseInfo.value.organizationId,
        coordinatorUrl: APP_CONFIG.COORDINATOR_URL,
      });

      setCoordinatorConfig(coordinatorConfig);
    }
  }, [consoleApi, setCoordinatorConfig, loginStatus, baseInfo.value?.organizationId]);

  useAsync(async () => {
    const orgJwt = localStorage.getItem("coScene_org_jwt");
    if (
      coordinatorConfig == undefined ||
      !coordinatorConfig.enabled ||
      coordinatorConfig.target_server === "" ||
      orgJwt == undefined
    ) {
      return;
    }

    const api = DevicesApiFactory(
      new Configuration({
        accessToken: () => {
          return orgJwt;
        },
        basePath: `${coordinatorConfig.target_server}/api`,
      }),
    );

    setColinkApi(api);
  }, [coordinatorConfig, setColinkApi]);

  useAsync(async () => {
    if (loginStatus === "alreadyLogin") {
      const customFieldSchema = await consoleApi.getDeviceCustomFieldSchema();
      setDeviceCustomFieldSchema(customFieldSchema);
    }
  }, [consoleApi, setDeviceCustomFieldSchema, loginStatus]);

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
