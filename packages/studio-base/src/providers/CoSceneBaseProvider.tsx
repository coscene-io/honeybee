// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { CustomFieldSchema } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import {
  CoSceneBaseStore,
  BaseInfo,
  CoSceneBaseContext,
  CoordinatorConfig,
} from "@foxglove/studio-base/context/CoSceneBaseContext";
import { DevicesApiFactory } from "@foxglove/studio-base/services/api/CoLink";

function CreateBaseStore() {
  return createStore<CoSceneBaseStore>((set, get) => ({
    dataSource: undefined,
    baseInfo: undefined,
    // monitor loading param to refresh record/project info
    organization: { loading: true, value: undefined },
    record: { loading: true, value: undefined },
    project: { loading: true, value: undefined },
    coordinatorConfig: undefined,
    colinkApi: undefined,
    reloadProjectTrigger: 0,
    reloadRecordTrigger: 0,

    setBaseInfo: (baseInfo: BaseInfo) => {
      set({ baseInfo });
    },
    setDataSource: (dataSource: { id: string; type: "connection" | "file" | "sample" }) => {
      set({ dataSource });
    },
    getEnableList: () => {
      const { dataSource } = get();

      return {
        event:
          dataSource?.type === "connection" && dataSource.id === "coscene-data-platform"
            ? "ENABLE"
            : "DISABLE",
        playlist:
          dataSource?.type === "connection" && dataSource.id === "coscene-data-platform"
            ? "ENABLE"
            : "DISABLE",
        uploadLocalFile: dataSource?.type === "file" ? "ENABLE" : "DISABLE",
      };
    },
    setRecord: (record: AsyncState<Record>) => {
      set({ record });
    },
    setProject: (project: AsyncState<Project>) => {
      set({ project });
    },
    setOrganization: (organization: AsyncState<Organization>) => {
      set({ organization });
    },

    refreshRecord: () => {
      set({ reloadRecordTrigger: get().reloadRecordTrigger + 1 });
    },
    refreshProject: () => {
      set({ reloadProjectTrigger: get().reloadProjectTrigger + 1 });
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
  }));
}

export default function CoSceneBaseProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const [store] = useState(CreateBaseStore);

  return <CoSceneBaseContext.Provider value={store}>{children}</CoSceneBaseContext.Provider>;
}
