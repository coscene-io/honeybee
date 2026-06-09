// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
// 外部传入的初始化配置数据
import { Organization } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Device } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/device_pb";
import { Record } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { CustomFieldSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { JobRun } from "@coscene-io/cosceneapis-es-v2/coscene/matrix/v1alpha1/resources/job_run_pb";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";
import { ParamsFile } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";

export type ExternalInitConfig = {
  files?: Array<ParamsFile>;
  // must
  warehouseId?: string;
  projectId?: string;
  // recordId is avaliable when viz record
  recordId?: string;
  // jobRunsId is avaliable when shadow mode
  jobRunsId?: string;
  workflowRunsId?: string;
  // deviceId is avaliable when realtime viz
  deviceId?: string;
  // taskId is avaliable when useing task as an entry point
  taskId?: string;
  // if has targetFileName, set seek to the target file
  targetFileName?: string;
  // Current organization slug, if the data is from a public project,
  // this is the data publisher's organization slug
  organizationSlug?: string;
};

export type DataSource = {
  id: string;
  type: "connection" | "persistent-cache" | "file" | "sample";
  // sessionId is avaliable when useing persistent cache, use same sessionId to get same cache data
  sessionId?: string;
  previousRecentId?: string;
  recentId?: string;
};

export type CoordinatorConfig = {
  org_id: string;
  enabled: boolean;
  target_server: string;
  proxy_server: string;
  public_ip: string;
};

// project core data, all data depend
export type CoreDataStore = {
  showtUrlKey?: string;

  /**
   * @description
   * all request about dataplatform is effect and use externalInitConfig
   * if externalInitConfig is set, all request will be enabled
   * so we need be careful when set externalInitConfig
   * 1. make sure user is logged
   * 2. set related data to consoleApi - setApiBaseInfo, this function will init user permission List
   * 3. then you can safely set externalInitConfig
   *
   * useSetExternalInitConfig in CoreDataSyncAdapter is package for this logic
   * so use useSetExternalInitConfig to set externalInitConfig
   */
  externalInitConfig?: ExternalInitConfig;

  isReadyForSyncLayout?: boolean;

  dataSource?: DataSource;

  organization: AsyncState<Organization>;
  project: AsyncState<Project>;
  device: AsyncState<Device>;
  record: AsyncState<Record>;
  jobRun: AsyncState<JobRun>;

  recordCustomFieldSchema?: CustomFieldSchema;
  deviceCustomFieldSchema?: CustomFieldSchema;

  // coLink config
  coordinatorConfig?: CoordinatorConfig;
  colinkApi?: ReturnType<typeof DevicesApiFactory>;

  // different project in different warehouse, need to dynamically adjust baseUrl according to the current project
  baseUrl?: string;

  reloadRecordTrigger: number;
  reloadProjectTrigger: number;
  reloadDeviceTrigger: number;
  reloadJobRunTrigger: number;
  reloadRecordCustomFieldSchemaTrigger: number;
  reloadDeviceCustomFieldSchemaTrigger: number;
  reloadOrganizationTrigger: number;

  // @deprecated don't use this function, use useSetShowtUrlKey in CoreDataSyncAdapter instead
  setShowtUrlKey: (showtUrlKey: string) => void;
  // @deprecated don't use this function, use useSetExternalInitConfig in CoreDataSyncAdapter instead
  setExternalInitConfig: (externalInitConfig: ExternalInitConfig) => void;

  setIsReadyForSyncLayout: (options: { isReadyForSyncLayout: boolean }) => void;
  setDataSource: (dataSource: DataSource | undefined) => void;
  setRecord: (record: AsyncState<Record>) => void;
  setDevice: (device: AsyncState<Device>) => void;
  setJobRun: (jobRun: AsyncState<JobRun>) => void;
  setProject: (project: AsyncState<Project>) => void;
  setRecordCustomFieldSchema: (recordCustomFieldSchema: CustomFieldSchema) => void;
  setDeviceCustomFieldSchema: (deviceCustomFieldSchema: CustomFieldSchema) => void;
  setCoordinatorConfig: (coordinatorConfig: CoordinatorConfig) => void;
  setColinkApi: (colinkApi: ReturnType<typeof DevicesApiFactory>) => void;
  setOrganization: (organization: AsyncState<Organization>) => void;

  setBaseUrl: (baseUrl: string) => void;

  refreshProject: () => void;
  refreshDevice: () => void;
  refreshRecord: () => void;
  refreshJobRun: () => void;
  refreshRecordCustomFieldSchema: () => void;
  refreshDeviceCustomFieldSchema: () => void;
  refreshOrganization: () => void;

  resetCoreDataStore: () => void;

  getEnableList: () => {
    event: "ENABLE" | "DISABLE";
    playlist: "ENABLE" | "DISABLE";
    task: "ENABLE" | "DISABLE";
    layoutSync: "ENABLE" | "DISABLE";
    recordInfo: "ENABLE" | "DISABLE";
  };
};

export const CoreDataContext = createContext<undefined | StoreApi<CoreDataStore>>(undefined);

export function useCoreData<T>(selector: (store: CoreDataStore) => T): T {
  const context = useGuaranteedContext(CoreDataContext);
  return useStore(context, selector);
}
