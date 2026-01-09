// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useAsync, useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  CoreDataStore,
  ExternalInitConfig,
  useCoreData,
  CoordinatorConfig,
} from "@foxglove/studio-base/context/CoreDataContext";
import {
  SubscriptionEntitlementStore,
  useSubscriptionEntitlement,
} from "@foxglove/studio-base/context/SubscriptionEntitlementContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import { Configuration, DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";

const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;
const selectOrganization = (state: CoreDataStore) => state.organization;
const selectCoordinatorConfig = (state: CoreDataStore) => state.coordinatorConfig;

const selectSetExternalInitConfig = (state: CoreDataStore) => state.setExternalInitConfig;
const selectSetIsReadyForSyncLayout = (state: CoreDataStore) => state.setIsReadyForSyncLayout;
const selectSetShowtUrlKey = (state: CoreDataStore) => state.setShowtUrlKey;
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
const selectSetFocusedTask = (state: TaskStore) => state.setFocusedTask;
const selectPaid = (store: SubscriptionEntitlementStore) => store.paid;

const log = Logger.getLogger(__filename);

export function useSetExternalInitConfig(): (
  externalInitConfig: ExternalInitConfig,
) => Promise<void> {
  const consoleApi = useConsoleApi();
  const setExternalInitConfig = useCoreData(selectSetExternalInitConfig);
  const setIsReadyForSyncLayout = useCoreData(selectSetIsReadyForSyncLayout);
  const setFocusedTask = useTasks(selectSetFocusedTask);
  const [, setLastExternalInitConfig] = useAppConfigurationValue<string>(
    AppSetting.LAST_EXTERNAL_INIT_CONFIG,
  );

  return async (externalInitConfig: ExternalInitConfig) => {
    void setLastExternalInitConfig(JSON.stringify(externalInitConfig));

    // set base info and init user permission List
    await consoleApi.setApiBaseInfo({
      projectId: externalInitConfig.projectId,
      warehouseId: externalInitConfig.warehouseId,
      recordId: externalInitConfig.recordId,
    });

    setExternalInitConfig(externalInitConfig);

    // 设置 isReadyForSyncLayout 标志，表示可以开始同步 layout
    setIsReadyForSyncLayout({ isReadyForSyncLayout: true });

    const taskName =
      externalInitConfig.warehouseId && externalInitConfig.projectId && externalInitConfig.taskId
        ? `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}/tasks/${externalInitConfig.taskId}`
        : undefined;
    if (taskName) {
      const task = await consoleApi.getTask({ taskName });
      setFocusedTask(task);
    }
  };
}

export function useSetShowtUrlKey(): (showtUrlKey: string) => Promise<void> {
  const consoleApi = useConsoleApi();
  const setShowtUrlKey = useCoreData(selectSetShowtUrlKey);
  const setExternalInitConfig = useSetExternalInitConfig();

  return async (showtUrlKey: string) => {
    const externalInitConfig = await consoleApi.getExternalInitConfig(showtUrlKey);

    await setExternalInitConfig(externalInitConfig);

    setShowtUrlKey(showtUrlKey);
  };
}

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

  const paid = useSubscriptionEntitlement(selectPaid);

  const consoleApi = useConsoleApi();

  const [, syncOrganization] = useAsyncFn(async () => {
    setOrganization({ loading: true, value: undefined });
    const organization = await consoleApi.getOrg("organizations/current");

    setOrganization({ loading: false, value: organization });
  }, [consoleApi, setOrganization]);

  useEffect(() => {
    if (loginStatus === "alreadyLogin") {
      syncOrganization().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [syncOrganization, reloadOrganizationTrigger, loginStatus]);

  // Project
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
    if (externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      syncProjects().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [
    syncProjects,
    reloadProjectTrigger,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
  ]);

  // Record
  const [, syncRecord] = useAsyncFn(async () => {
    if (
      externalInitConfig?.warehouseId &&
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
    if (
      externalInitConfig?.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.recordId
    ) {
      syncRecord().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [
    syncRecord,
    reloadRecordTrigger,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    externalInitConfig?.recordId,
  ]);

  // JobRun
  const [, syncJobRuns] = useAsyncFn(async () => {
    if (
      externalInitConfig?.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.jobRunsId
    ) {
      setJobRun({ loading: true, value: undefined });
      const jobRunName = `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}/workflowRuns/${externalInitConfig.workflowRunsId}/jobRuns/${externalInitConfig.jobRunsId}`;
      const targetJobRun = await consoleApi.getJobRun(jobRunName);

      setJobRun({ loading: false, value: targetJobRun });
    }
  }, [
    externalInitConfig?.jobRunsId,
    externalInitConfig?.workflowRunsId,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    setJobRun,
    consoleApi,
  ]);

  useEffect(() => {
    if (
      externalInitConfig?.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.jobRunsId
    ) {
      syncJobRuns().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [
    syncJobRuns,
    reloadJobRunTrigger,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    externalInitConfig?.jobRunsId,
  ]);

  // Device
  const [, syncDevice] = useAsyncFn(async () => {
    if (
      paid &&
      externalInitConfig?.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.deviceId
    ) {
      setDevice({ loading: true, value: undefined });
      const deviceName = `devices/${externalInitConfig.deviceId}`;
      const targetDevice = await consoleApi.getDevice({ deviceName });
      setDevice({ loading: false, value: targetDevice });
    }
  }, [externalInitConfig, setDevice, consoleApi, paid]);

  useEffect(() => {
    if (
      paid &&
      externalInitConfig?.warehouseId &&
      externalInitConfig.projectId &&
      externalInitConfig.deviceId
    ) {
      syncDevice().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [
    syncDevice,
    reloadDeviceTrigger,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    externalInitConfig?.deviceId,
    paid,
  ]);

  // RecordCustomFieldSchema
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
    if (externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      syncRecordCustomFieldSchema().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [
    syncRecordCustomFieldSchema,
    reloadRecordCustomFieldSchemaTrigger,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
  ]);

  // DeviceCustomFieldSchema
  const [, syncDevideCustomFieldSchema] = useAsyncFn(async () => {
    if (paid && externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      const customFieldSchema = await consoleApi.getDeviceCustomFieldSchema();
      setDeviceCustomFieldSchema(customFieldSchema);
    }
  }, [
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    consoleApi,
    setDeviceCustomFieldSchema,
    paid,
  ]);

  useEffect(() => {
    if (paid && externalInitConfig?.warehouseId && externalInitConfig.projectId) {
      syncDevideCustomFieldSchema().catch((error: unknown) => {
        log.error(error);
      });
    }
  }, [
    syncDevideCustomFieldSchema,
    reloadDeviceCustomFieldSchemaTrigger,
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    paid,
  ]);

  // CoordinatorConfig
  useAsync(async () => {
    if (organization.value != undefined) {
      const appConfig = getAppConfig();

      const coordinatorConfig: CoordinatorConfig = await consoleApi.getCoordinatorConfig({
        currentOrganizationId: organization.value.name.split("/").pop() ?? "",
        coordinatorUrl: appConfig.COORDINATOR_URL ?? "",
      });

      setCoordinatorConfig(coordinatorConfig);
    }
  }, [organization.value, consoleApi, setCoordinatorConfig]);

  // ColinkApi
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
