// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useAsync, useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { Configuration, DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;
const selectOrganization = (state: CoreDataStore) => state.organization;
const selectCoordinatorConfig = (state: CoreDataStore) => state.coordinatorConfig;

const selectSetRecord = (state: CoreDataStore) => state.setRecord;
const selectSetDevice = (state: CoreDataStore) => state.setDevice;
const selectSetJobRun = (state: CoreDataStore) => state.setJobRun;
const selectSetProject = (state: CoreDataStore) => state.setProject;
const selectSetRecordCustomFieldSchema = (state: CoreDataStore) => state.setRecordCustomFieldSchema;
const selectSetDeviceCustomFieldSchema = (state: CoreDataStore) => state.setDeviceCustomFieldSchema;
const selectSetCoordinatorConfig = (state: CoreDataStore) => state.setCoordinatorConfig;
const selectSetColinkApi = (state: CoreDataStore) => state.setColinkApi;
const selectSetOrganization = (state: CoreDataStore) => state.setOrganization;

const selectReloadRecordTrigger = (state: CoreDataStore) => state.reloadRecordTrigger;
const selectReloadProjectTrigger = (state: CoreDataStore) => state.reloadProjectTrigger;
const selectReloadDeviceTrigger = (state: CoreDataStore) => state.reloadDeviceTrigger;
const selectReloadJobRunTrigger = (state: CoreDataStore) => state.reloadJobRunTrigger;
const selectReloadRecordCustomFieldSchemaTrigger = (state: CoreDataStore) =>
  state.reloadRecordCustomFieldSchemaTrigger;
const selectReloadDeviceCustomFieldSchemaTrigger = (state: CoreDataStore) =>
  state.reloadDeviceCustomFieldSchemaTrigger;
const selectReloadOrganizationTrigger = (state: CoreDataStore) => state.reloadOrganizationTrigger;

const selectLoginStatus = (state: UserStore) => state.loginStatus;

const log = Logger.getLogger(__filename);

export function CoreDataSyncAdapter(): ReactNull {
  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const organization = useCoreData(selectOrganization);
  const coordinatorConfig = useCoreData(selectCoordinatorConfig);

  const setOrganization = useCoreData(selectSetOrganization);
  const setRecord = useCoreData(selectSetRecord);
  const setDevice = useCoreData(selectSetDevice);
  const setProject = useCoreData(selectSetProject);
  const setJobRun = useCoreData(selectSetJobRun);
  const setRecordCustomFieldSchema = useCoreData(selectSetRecordCustomFieldSchema);
  const setDeviceCustomFieldSchema = useCoreData(selectSetDeviceCustomFieldSchema);
  const setCoordinatorConfig = useCoreData(selectSetCoordinatorConfig);
  const setColinkApi = useCoreData(selectSetColinkApi);

  const reloadRecordTrigger = useCoreData(selectReloadRecordTrigger);
  const reloadProjectTrigger = useCoreData(selectReloadProjectTrigger);
  const reloadDeviceTrigger = useCoreData(selectReloadDeviceTrigger);
  const reloadJobRunTrigger = useCoreData(selectReloadJobRunTrigger);
  const reloadRecordCustomFieldSchemaTrigger = useCoreData(
    selectReloadRecordCustomFieldSchemaTrigger,
  );
  const reloadDeviceCustomFieldSchemaTrigger = useCoreData(
    selectReloadDeviceCustomFieldSchemaTrigger,
  );
  const reloadOrganizationTrigger = useCoreData(selectReloadOrganizationTrigger);

  const loginStatus = useCurrentUser(selectLoginStatus);

  const consoleApi = useConsoleApi();

  const [, syncOrganization] = useAsyncFn(async () => {
    if (loginStatus === "alreadyLogin") {
      setOrganization({ loading: true, value: undefined });
      const organization = await consoleApi.getOrg("organizations/current");

      setOrganization({ loading: false, value: organization });
    }
  }, [loginStatus, consoleApi, setOrganization]);

  useEffect(() => {
    syncOrganization().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncOrganization, reloadOrganizationTrigger]);

  const [, syncProjects] = useAsyncFn(async () => {
    if (externalInitConfig == undefined) {
      return;
    }

    setProject({ loading: false, value: undefined });

    const projectName = `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`;
    const targetProject = await consoleApi.getProject({ projectName });

    setProject({ loading: false, value: targetProject });
  }, [externalInitConfig, setProject, consoleApi]);

  useEffect(() => {
    syncProjects().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncProjects, reloadProjectTrigger]);

  const [, syncRecord] = useAsyncFn(async () => {
    if (externalInitConfig?.recordId == undefined) {
      return;
    }

    if (
      externalInitConfig.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.recordId
    ) {
      setRecord({ loading: true, value: undefined });
      const recordName = `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}/records/${externalInitConfig.recordId}`;
      const targetRecord = await consoleApi.getRecord({ recordName });

      setRecord({ loading: false, value: targetRecord });
    }
  }, [externalInitConfig, setRecord, consoleApi]);

  useEffect(() => {
    syncRecord().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncRecord, reloadRecordTrigger]);

  const [, syncJobRuns] = useAsyncFn(async () => {
    if (
      externalInitConfig?.jobRunsId == undefined ||
      externalInitConfig.workflowRunId == undefined
    ) {
      return;
    }

    if (
      externalInitConfig.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.jobRunsId
    ) {
      setJobRun({ loading: true, value: undefined });
      const jobRunName = `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}/workflowRuns/${externalInitConfig.workflowRunId}/jobRuns/${externalInitConfig.jobRunsId}`;
      const targetJobRun = await consoleApi.getJobRun(jobRunName);

      setJobRun({ loading: false, value: targetJobRun });
    }
  }, [
    externalInitConfig?.jobRunsId,
    externalInitConfig?.workflowRunId,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    setJobRun,
    consoleApi,
  ]);

  useEffect(() => {
    syncJobRuns().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncJobRuns, reloadJobRunTrigger]);

  const [, syncDevice] = useAsyncFn(async () => {
    if (externalInitConfig?.deviceId == undefined) {
      return;
    }

    if (
      externalInitConfig.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.deviceId
    ) {
      setDevice({ loading: true, value: undefined });
      const deviceName = `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}/devices/${externalInitConfig.deviceId}`;
      const targetDevice = await consoleApi.getDevice({ deviceName });

      setDevice({ loading: false, value: targetDevice });
    }
  }, [externalInitConfig, setDevice, consoleApi]);

  useEffect(() => {
    syncDevice().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncDevice, reloadDeviceTrigger]);

  const [, syncRecordCustomFieldSchema] = useAsyncFn(async () => {
    if (externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      const customFieldSchema = await consoleApi.getRecordCustomFieldSchema(
        `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`,
      );
      setRecordCustomFieldSchema(customFieldSchema);
    }
  }, [
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    consoleApi,
    setRecordCustomFieldSchema,
  ]);

  useEffect(() => {
    syncRecordCustomFieldSchema().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncRecordCustomFieldSchema, reloadRecordCustomFieldSchemaTrigger]);

  const [, syncDevideCustomFieldSchema] = useAsyncFn(async () => {
    if (externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      const customFieldSchema = await consoleApi.getDeviceCustomFieldSchema();
      setDeviceCustomFieldSchema(customFieldSchema);
    }
  }, [
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    consoleApi,
    setDeviceCustomFieldSchema,
  ]);

  useEffect(() => {
    syncDevideCustomFieldSchema().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncDevideCustomFieldSchema, reloadDeviceCustomFieldSchemaTrigger]);

  useAsync(async () => {
    if (organization.value != undefined) {
      const coordinatorConfig = await consoleApi.getCoordinatorConfig({
        currentOrganizationId: organization.value.name.split("/").pop() ?? "",
        coordinatorUrl: APP_CONFIG.COORDINATOR_URL,
      });

      setCoordinatorConfig(coordinatorConfig);
    }
  }, [organization.value, consoleApi, setCoordinatorConfig]);

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

  return ReactNull;
}
