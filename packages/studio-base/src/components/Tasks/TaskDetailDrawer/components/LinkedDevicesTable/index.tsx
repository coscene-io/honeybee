// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListProjectDevicesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/device_pb";
import { Box, Stack } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import DeviceTableFilter from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedDevicesTable/components/DeviceTableFilter";
import DevicesTable from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedDevicesTable/components/DevicesTable";
import LinkDevice from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedDevicesTable/components/LinkDevice";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

// 扩展Footer组件的props接口
declare module "@mui/x-data-grid" {
  interface FooterPropsOverrides {
    onButtonClick?: (selectedRows: string[]) => void;
  }
}

const useStyles = makeStyles()(() => ({
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
}));

const selectProject = (store: CoSceneBaseStore) => store.project;

export default function LinkedDevicesTable({
  taskName,
  linkedDevices,
  getLinkedDevices,
  pageSize,
  currentPage,
  setPageSize,
  setCurrentPage,
  filter,
  setFilter,
}: {
  taskName: string;
  linkedDevices: ListProjectDevicesResponse;
  getLinkedDevices: () => Promise<ListProjectDevicesResponse | undefined>;
  pageSize: number;
  currentPage: number;
  setPageSize: (pageSize: number) => void;
  setCurrentPage: (currentPage: number) => void;
  filter: string | undefined;
  setFilter: (filter: string) => void;
}): React.ReactElement {
  const { classes } = useStyles();
  const consoleApi = useConsoleApi();
  const project = useBaseInfo(selectProject);
  const { t } = useTranslation("task");

  const handleUnlinkDevice = useCallback(
    async (selectedRowIds: string[]) => {
      await consoleApi.unlinkTasks({
        project: project.value?.name,
        unlinkTasks: selectedRowIds.map((id) => ({
          task: taskName,
          target: { value: id, case: "device" },
        })),
      });
      await getLinkedDevices();
    },
    [consoleApi, project.value?.name, taskName, getLinkedDevices],
  );

  return (
    <Box className={classes.container}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" flex={1}>
          <DeviceTableFilter filter={filter} setFilter={setFilter} />
        </Stack>
        <LinkDevice taskName={taskName} getLinkedDevices={getLinkedDevices} />
      </Stack>
      <DevicesTable
        linkedDevicesResponse={linkedDevices}
        pageSize={pageSize}
        currentPage={currentPage}
        setPageSize={setPageSize}
        setCurrentPage={setCurrentPage}
        onBatchAction={handleUnlinkDevice}
        batchActionButtonText={t("unlinkRecord")}
      />
    </Box>
  );
}
