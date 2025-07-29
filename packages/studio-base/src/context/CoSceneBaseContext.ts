// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { CustomFieldSchema } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";
import { ParamsFile } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";

export type BaseInfo = {
  warehouseId: string;
  projectId: string;
  recordId?: string;
  jobRunsDisplayName?: string;
  jobRunsId?: string;
  workflowRunsId?: string;
  files?: Array<ParamsFile>;
  jobRunsSerialNumber?: string;

  reloadProjectTrigger: number;
  reloadRecordTrigger: number;
};

export type CoordinatorConfig = {
  org_id: string;
  enabled: boolean;
  target_server: string;
  proxy_server: string;
  public_ip: string;
};

export type CoSceneBaseStore = {
  dataSource?: {
    id: string;
    type: "connection" | "file" | "sample";
  };
  baseInfo?: BaseInfo;

  organization: AsyncState<Organization>;
  project: AsyncState<Project>;
  record: AsyncState<Record>;

  recordCustomFieldSchema?: CustomFieldSchema;
  deviceCustomFieldSchema?: CustomFieldSchema;
  coordinatorConfig?: CoordinatorConfig;
  colinkApi?: ReturnType<typeof DevicesApiFactory>;

  reloadProjectTrigger: number;
  reloadRecordTrigger: number;
  setBaseInfo: (baseInfo: BaseInfo) => void;
  setDataSource: (dataSource: { id: string; type: "connection" | "file" | "sample" }) => void;
  setRecord: (record: AsyncState<Record>) => void;
  setProject: (project: AsyncState<Project>) => void;
  setOrganization: (organization: AsyncState<Organization>) => void;

  refreshRecord: () => void;
  refreshProject: () => void;

  // schema
  setRecordCustomFieldSchema: (recordCustomFieldSchema: CustomFieldSchema) => void;
  setDeviceCustomFieldSchema: (deviceCustomFieldSchema: CustomFieldSchema) => void;
  setCoordinatorConfig: (coordinatorConfig: CoordinatorConfig) => void;
  setColinkApi: (colinkApi: ReturnType<typeof DevicesApiFactory>) => void;

  getEnableList: () => {
    event: "ENABLE" | "DISABLE";
    playlist: "ENABLE" | "DISABLE";
    uploadLocalFile: "ENABLE" | "DISABLE";
  };
};

export const CoSceneBaseContext = createContext<undefined | StoreApi<CoSceneBaseStore>>(undefined);

export function useBaseInfo<T>(selector: (store: CoSceneBaseStore) => T): T {
  const context = useGuaranteedContext(CoSceneBaseContext);
  return useStore(context, selector);
}
