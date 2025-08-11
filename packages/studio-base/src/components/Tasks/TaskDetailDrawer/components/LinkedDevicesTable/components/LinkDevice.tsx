// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListProjectDevicesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/device_pb";
import { LinkTaskWrapper } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/task_pb";
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Box } from "@mui/material";
import { useState, useCallback, useEffect } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { CosQuery } from "@foxglove/studio-base/util/coscene";

import DeviceTableFilter from "./DeviceTableFilter";
import DevicesTable from "./DevicesTable";

const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;
const selectProject = (store: CoreDataStore) => store.project;

const useStyles = makeStyles()((theme) => ({
  dialogContent: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
    paddingBottom: theme.spacing(1),
    paddingTop: theme.spacing(1),
    width: "100%",
  },
  tableContainer: {
    flex: 1,
    minHeight: "400px",
    marginTop: theme.spacing(-1),
  },
}));

export default function LinkDevice({
  taskName,
  getLinkedDevices,
}: {
  taskName: string;
  getLinkedDevices: () => Promise<ListProjectDevicesResponse | undefined>;
}): React.ReactElement {
  const { classes } = useStyles();
  const { t } = useTranslation("task");
  const { t: tGeneral } = useTranslation("cosGeneral");
  const [addDeviceDialogOpen, setAddDeviceDialogOpen] = useState<boolean>(false);
  const [filter, setFilter] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const project = useCoreData(selectProject);
  const consoleApi = useConsoleApi();

  // 获取设备列表
  const [listDevicesState, getDevices] = useAsyncFn(async () => {
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return new ListProjectDevicesResponse();
    }

    const response = await consoleApi.listProjectDevices({
      warehouseId: externalInitConfig.warehouseId,
      projectId: externalInitConfig.projectId,
      filter: CosQuery.Companion.deserialize(filter),
      pageSize,
      currentPage,
    });

    return response;
  }, [
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    consoleApi,
    filter,
    pageSize,
    currentPage,
  ]);

  // 当过滤器、分页参数变化时重新获取数据
  useEffect(() => {
    if (addDeviceDialogOpen) {
      void getDevices();
    }
  }, [filter, pageSize, currentPage, getDevices, addDeviceDialogOpen]);

  const handleOpenDialog = useCallback(() => {
    setAddDeviceDialogOpen(true);
    // 重置状态
    setCurrentPage(0);
    setSelectedRowIds([]);
    // 获取初始数据
    void getDevices();
  }, [getDevices]);

  const handleCloseDialog = useCallback(() => {
    setAddDeviceDialogOpen(false);
  }, []);

  const handleSelectionChange = useCallback((selectedIds: string[]) => {
    setSelectedRowIds(selectedIds);
  }, []);

  const handleConfirm = useCallback(async () => {
    const linkTasks: LinkTaskWrapper[] = selectedRowIds.map(
      (id) =>
        new LinkTaskWrapper({
          task: taskName,
          target: { value: id, case: "device" },
        }),
    );

    try {
      await consoleApi.linkTasks({
        project: project.value?.name,
        linkTasks,
      });
      await getLinkedDevices();
      toast.success(t("addLinkedDeviceSuccess"));
      handleCloseDialog();
    } catch (error) {
      console.error(error);
      toast.error(t("addLinkedDeviceFailed"));
    }
  }, [
    selectedRowIds,
    taskName,
    consoleApi,
    project.value?.name,
    getLinkedDevices,
    handleCloseDialog,
    t,
  ]);

  return (
    <>
      <Button variant="contained" color="primary" onClick={handleOpenDialog}>
        {t("addLink")}
      </Button>

      <Dialog
        open={addDeviceDialogOpen}
        onClose={handleCloseDialog}
        maxWidth="xl"
        fullWidth
        slotProps={{
          paper: {
            style: { height: "80vh" },
          },
        }}
      >
        <DialogTitle>{t("addLinkedDevice")}</DialogTitle>
        <DialogContent className={classes.dialogContent}>
          <DeviceTableFilter filter={filter} setFilter={setFilter} />
          <Box className={classes.tableContainer}>
            <DevicesTable
              linkedDevicesResponse={listDevicesState.value ?? new ListProjectDevicesResponse()}
              pageSize={pageSize}
              currentPage={currentPage}
              setPageSize={setPageSize}
              setCurrentPage={setCurrentPage}
              onSelectionChange={handleSelectionChange}
              disableBatchAction={true}
              disableSwitchSource={true}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="inherit">
            {tGeneral("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color="primary"
            disabled={selectedRowIds.length === 0}
          >
            {tGeneral("ok")} ({selectedRowIds.length})
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
