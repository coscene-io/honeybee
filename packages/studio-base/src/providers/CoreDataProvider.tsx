// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Subscription } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/subscription_pb";
import { Device } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/device_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { CustomFieldSchema } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { JobRun } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/resources/job_run_pb";
import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import {
  CoreDataContext,
  CoreDataStore,
  DataSource,
  ExternalInitConfig,
  CoordinatorConfig,
} from "@foxglove/studio-base/context/CoreDataContext";
import { DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";

const defaultCoreDataStore = {
  showtUrlKey: undefined,
  externalInitConfig: undefined,
  dataSource: undefined,

  organization: { loading: true, value: undefined },
  subscription: { loading: true, value: undefined },
  project: { loading: true, value: undefined },
  device: { loading: true, value: undefined },
  record: { loading: true, value: undefined },
  jobRun: { loading: true, value: undefined },

  recordCustomFieldSchema: undefined,
  deviceCustomFieldSchema: undefined,

  coordinatorConfig: undefined,
  colinkApi: undefined,

  reloadRecordTrigger: 0,
  reloadSubscriptionTrigger: 0,
  reloadProjectTrigger: 0,
  reloadDeviceTrigger: 0,
  reloadJobRunTrigger: 0,
  reloadRecordCustomFieldSchemaTrigger: 0,
  reloadDeviceCustomFieldSchemaTrigger: 0,
  reloadOrganizationTrigger: 0,
};

function CreateCoreDataStore() {
  return createStore<CoreDataStore>((set, get) => ({
    ...defaultCoreDataStore,

    setShowtUrlKey: (showtUrlKey: string) => {
      set({ showtUrlKey });
    },
    setExternalInitConfig: (externalInitConfig: ExternalInitConfig) => {
      set({ externalInitConfig });
    },
    setDataSource: (dataSource: DataSource | undefined) => {
      set({ dataSource });
    },
    setOrganization: (organization: AsyncState<Organization>) => {
      set({ organization });
    },
    setSubscription: (subscription: AsyncState<Subscription>) => {
      set({ subscription });
    },
    setRecord: (record: AsyncState<Record>) => {
      set({ record });
    },
    setDevice: (device: AsyncState<Device>) => {
      set({ device });
    },
    setJobRun: (jobRun: AsyncState<JobRun>) => {
      set({ jobRun });
    },
    setProject: (project: AsyncState<Project>) => {
      set({ project });
    },
    setRecordCustomFieldSchema: (recordCustomFieldSchema: CustomFieldSchema) => {
      set({ recordCustomFieldSchema });
    },
    setDeviceCustomFieldSchema: (deviceCustomFieldSchema: CustomFieldSchema) => {
      set({ deviceCustomFieldSchema });
    },
    setCoordinatorConfig: (coordinatorConfig: CoordinatorConfig) => {
      set({ coordinatorConfig });
    },
    setColinkApi: (colinkApi: ReturnType<typeof DevicesApiFactory>) => {
      set({ colinkApi });
    },

    refreshOrganization: () => {
      set({ reloadOrganizationTrigger: get().reloadOrganizationTrigger + 1 });
    },
    refreshSubscription: () => {
      set({ reloadSubscriptionTrigger: get().reloadSubscriptionTrigger + 1 });
    },
    refreshProject: () => {
      set({ reloadProjectTrigger: get().reloadProjectTrigger + 1 });
    },
    refreshDevice: () => {
      set({ reloadDeviceTrigger: get().reloadDeviceTrigger + 1 });
    },
    refreshRecord: () => {
      set({ reloadRecordTrigger: get().reloadRecordTrigger + 1 });
    },
    refreshJobRun: () => {
      set({ reloadJobRunTrigger: get().reloadJobRunTrigger + 1 });
    },
    refreshRecordCustomFieldSchema: () => {
      set({ reloadRecordCustomFieldSchemaTrigger: get().reloadRecordCustomFieldSchemaTrigger + 1 });
    },
    refreshDeviceCustomFieldSchema: () => {
      set({ reloadDeviceCustomFieldSchemaTrigger: get().reloadDeviceCustomFieldSchemaTrigger + 1 });
    },

    resetCoreDataStore: () => {
      set(defaultCoreDataStore);
    },

    getEnableList: () => {
      const { dataSource, project, externalInitConfig } = get();

      return {
        event:
          dataSource?.type === "connection" && dataSource.id === "coscene-data-platform"
            ? "ENABLE"
            : "DISABLE",
        playlist:
          dataSource?.type === "connection" && dataSource.id === "coscene-data-platform"
            ? "ENABLE"
            : "DISABLE",
        task: project.value != undefined ? "ENABLE" : "DISABLE",
        layoutSync:
          externalInitConfig?.warehouseId && externalInitConfig.projectId ? "ENABLE" : "DISABLE",
        recordInfo:
          dataSource?.type === "connection" && dataSource.id === "coscene-data-platform"
            ? "ENABLE"
            : "DISABLE",
      };
    },
  }));
}

export default function CoreDataProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const [store] = useState(CreateCoreDataStore);

  return <CoreDataContext.Provider value={store}>{children}</CoreDataContext.Provider>;
}
