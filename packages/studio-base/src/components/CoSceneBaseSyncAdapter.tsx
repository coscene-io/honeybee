// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useAsync } from "react-use";

import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { Configuration, DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectRecord = (store: CoSceneBaseStore) => store.record;
const selectProject = (store: CoSceneBaseStore) => store.project;
const selectCoordinatorConfig = (state: CoSceneBaseStore) => state.coordinatorConfig;
const selectOrganization = (state: CoSceneBaseStore) => state.organization;
const selectReloadProjectTrigger = (state: CoSceneBaseStore) => state.reloadProjectTrigger;
const selectReloadRecordTrigger = (state: CoSceneBaseStore) => state.reloadRecordTrigger;

const selectSetProjects = (state: CoSceneBaseStore) => state.setProject;
const selectSetRecord = (state: CoSceneBaseStore) => state.setRecord;
const selectSetCoordinatorConfig = (state: CoSceneBaseStore) => state.setCoordinatorConfig;
const selectSetColinkApi = (state: CoSceneBaseStore) => state.setColinkApi;
const selectSetRecordCustomFieldSchema = (state: CoSceneBaseStore) =>
  state.setRecordCustomFieldSchema;
const selectSetDeviceCustomFieldSchema = (state: CoSceneBaseStore) =>
  state.setDeviceCustomFieldSchema;
const selectSetOrganization = (state: CoSceneBaseStore) => state.setOrganization;

const selectLoginStatus = (state: UserStore) => state.loginStatus;
export function BaseSyncAdapter(): ReactNull {
  const baseInfo = useBaseInfo(selectBaseInfo);
  const record = useBaseInfo(selectRecord);
  const project = useBaseInfo(selectProject);
  const coordinatorConfig = useBaseInfo(selectCoordinatorConfig);
  const organization = useBaseInfo(selectOrganization);
  const reloadProjectTrigger = useBaseInfo(selectReloadProjectTrigger);
  const reloadRecordTrigger = useBaseInfo(selectReloadRecordTrigger);

  const setProject = useBaseInfo(selectSetProjects);
  const setRecord = useBaseInfo(selectSetRecord);
  const setRecordCustomFieldSchema = useBaseInfo(selectSetRecordCustomFieldSchema);
  const setDeviceCustomFieldSchema = useBaseInfo(selectSetDeviceCustomFieldSchema);
  const setCoordinatorConfig = useBaseInfo(selectSetCoordinatorConfig);
  const setColinkApi = useBaseInfo(selectSetColinkApi);
  const setOrganization = useBaseInfo(selectSetOrganization);

  const loginStatus = useCurrentUser(selectLoginStatus);

  const consoleApi = useConsoleApi();

  useAsync(async () => {
    if (loginStatus === "alreadyLogin") {
      const organization = await consoleApi.getOrg("organizations/current");
      setOrganization({ loading: false, value: organization });
    }
  }, [loginStatus, consoleApi, setOrganization]);

  useAsync(async () => {
    if (baseInfo == undefined || project.loading) {
      return;
    }

    const projectName = `warehouses/${baseInfo.warehouseId}/projects/${baseInfo.projectId}`;
    const targetProject = await consoleApi.getProject({ projectName });

    setProject({ loading: false, value: targetProject });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseInfo, project.loading, consoleApi, setProject, reloadProjectTrigger]);

  useAsync(async () => {
    if (baseInfo == undefined || record.loading) {
      return;
    }

    if (baseInfo.recordId) {
      const targetRecord = await consoleApi.getRecord({
        recordName: `warehouses/${baseInfo.warehouseId}/projects/${baseInfo.projectId}/records/${baseInfo.recordId}`,
      });
      setRecord({ loading: false, value: targetRecord });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseInfo, record.loading, consoleApi, setRecord, reloadRecordTrigger]);

  useAsync(async () => {
    if (baseInfo == undefined || record.loading) {
      return;
    }

    const customFieldSchema = await consoleApi.getRecordCustomFieldSchema(
      `warehouses/${baseInfo.warehouseId}/projects/${baseInfo.projectId}`,
    );
    setRecordCustomFieldSchema(customFieldSchema);
  }, [baseInfo, record.loading, consoleApi, setRecordCustomFieldSchema]);

  useAsync(async () => {
    if (loginStatus === "alreadyLogin" && organization.value?.name) {
      const coordinatorConfig = await consoleApi.getCoordinatorConfig({
        currentOrganizationId: organization.value.name.split("/").pop() ?? "",
        coordinatorUrl: APP_CONFIG.COORDINATOR_URL,
      });

      setCoordinatorConfig(coordinatorConfig);
    }
  }, [loginStatus, organization.value?.name, consoleApi, setCoordinatorConfig]);

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

  return ReactNull;
}
