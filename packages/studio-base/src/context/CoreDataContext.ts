// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
// 外部传入的初始化配置数据
import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Device } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/device_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { CustomFieldSchema } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { JobRun } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/resources/job_run_pb";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";
import { CoordinatorConfig } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { ParamsFile } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";

export type ExternalInitConfig = {
  files?: Array<ParamsFile>;
  // must
  warehouseId: string;
  projectId: string;
  // recordId is avaliable when viz record
  recordId?: string;
  // jobRunsId is avaliable when shadow mode
  jobRunsId?: string;
  workflowRunId?: string;
  // deviceId is avaliable when realtime viz
  deviceId?: string;
  // taskId is avaliable when useing task as an entry point
  taskId?: string;
};

export type DataSource = {
  id: string;
  type: "connection" | "file" | "sample";
};

// project core data, all data depend
export type CoreDataStore = {
  externalInitConfig?: ExternalInitConfig;

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

  reloadRecordTrigger: number;
  reloadProjectTrigger: number;
  reloadDeviceTrigger: number;
  reloadJobRunTrigger: number;
  reloadRecordCustomFieldSchemaTrigger: number;
  reloadDeviceCustomFieldSchemaTrigger: number;
  reloadOrganizationTrigger: number;

  isConsoleApiInfoReady: "NOT_READY" | "READY";

  setExternalInitConfig: (externalInitConfig: ExternalInitConfig) => void;
  setDataSource: (dataSource: DataSource) => void;
  setRecord: (record: AsyncState<Record>) => void;
  setDevice: (device: AsyncState<Device>) => void;
  setJobRun: (jobRun: AsyncState<JobRun>) => void;
  setProject: (project: AsyncState<Project>) => void;
  setRecordCustomFieldSchema: (recordCustomFieldSchema: CustomFieldSchema) => void;
  setDeviceCustomFieldSchema: (deviceCustomFieldSchema: CustomFieldSchema) => void;
  setCoordinatorConfig: (coordinatorConfig: CoordinatorConfig) => void;
  setColinkApi: (colinkApi: ReturnType<typeof DevicesApiFactory>) => void;
  setOrganization: (organization: AsyncState<Organization>) => void;

  refreshProject: () => void;
  refreshDevice: () => void;
  refreshRecord: () => void;
  refreshJobRun: () => void;
  refreshRecordCustomFieldSchema: () => void;
  refreshDeviceCustomFieldSchema: () => void;
  refreshOrganization: () => void;

  setIsConsoleApiInfoReady: (isConsoleApiInfoReady: "NOT_READY" | "READY") => void;

  getEnableList: () => {
    event: "ENABLE" | "DISABLE";
    playlist: "ENABLE" | "DISABLE";
    task: "ENABLE" | "DISABLE";
    uploadLocalFile: "ENABLE" | "DISABLE";
    layoutSync: "ENABLE" | "DISABLE";
  };
};

export const CoreDataContext = createContext<undefined | StoreApi<CoreDataStore>>(undefined);

export function useCoreData<T>(selector: (store: CoreDataStore) => T): T {
  const context = useGuaranteedContext(CoreDataContext);
  return useStore(context, selector);
}
