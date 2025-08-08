// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// export { default as TaskDetailDrawer } from "./TaskDetailDrawer";

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Drawer, Typography, IconButton, Box, Stack, Chip, Tabs, Tab } from "@mui/material";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import LinkedDevicesTable from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedDevicesTable";
import LinkedRecordsTable from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedRecordsTable";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";
import { CosQuery } from "@foxglove/studio-base/util/coscene";
import { BinaryOperator, SerializeOption } from "@foxglove/studio-base/util/coscene/cosel";
import { QueryFields } from "@foxglove/studio-base/util/queries";

const selectPlay = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectEnableRepeat = (ctx: MessagePipelineContext) => ctx.enableRepeatPlayback;
const selectViewingTask = (store: TaskStore) => store.viewingTask;
const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;
const selectSetViewingTask = (store: TaskStore) => store.setViewingTask;

const useStyles = makeStyles<{ showPlaybackControls: boolean }>()(
  (theme, { showPlaybackControls }) => ({
    drawer: {
      width: "73%",
      boxSizing: "border-box",
      top: 48, // AppBar height offset
      height: showPlaybackControls
        ? "calc(100% - 48px - 80px)" // Adjust height to account for AppBar and PlaybackControls
        : "calc(100% - 48px)", // Only account for AppBar when PlaybackControls is not shown
    },
    content: {
      padding: theme.spacing(2),
      height: "100%",
      display: "flex",
      flexDirection: "column",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.spacing(0.5),
      flexShrink: 0,
    },
    tabs: {
      borderBottom: `1px solid ${theme.palette.divider}`,
      flexShrink: 0,
    },
    tableContainer: {
      flex: 1,
      minHeight: 0,
      marginTop: theme.spacing(1),
    },
  }),
);

export default function TaskDetailDrawer(): React.ReactElement {
  // Check if PlaybackControls should be displayed based on the same conditions as in Workspace.tsx
  const play = useMessagePipeline(selectPlay);
  const pause = useMessagePipeline(selectPause);
  const seek = useMessagePipeline(selectSeek);
  const enableRepeat = useMessagePipeline(selectEnableRepeat);

  const showPlaybackControls =
    play != undefined && pause != undefined && seek != undefined && enableRepeat != undefined;

  const { classes } = useStyles({ showPlaybackControls });
  const viewingTask = useTasks(selectViewingTask);
  const setViewingTask = useTasks(selectSetViewingTask);
  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const [tabValue, setTabValue] = useState(0);
  const { t } = useTranslation("task");

  const consoleApi = useConsoleApi();

  const handleClose = () => {
    setViewingTask(undefined);
  };

  const [recordFilter, setRecordFilter] = useState<undefined | string>(undefined);
  const [deviceFilter, setDeviceFilter] = useState<undefined | string>(undefined);

  const [recordPageSize, setRecordPageSize] = useState(10);
  const [recordCurrentPage, setRecordCurrentPage] = useState(0);

  const [devicePageSize, setDevicePageSize] = useState(10);
  const [deviceCurrentPage, setDeviceCurrentPage] = useState(0);

  const [linkedRecords, getLinkedRecords] = useAsyncFn(async () => {
    if (
      recordFilter == undefined ||
      externalInitConfig?.projectId == undefined ||
      externalInitConfig.warehouseId == undefined
    ) {
      return;
    }

    const projectName = `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`;

    const res = await consoleApi.listRecord({
      projectName,
      pageSize: recordPageSize,
      filter: CosQuery.Companion.deserialize(recordFilter).toQueryString(
        new SerializeOption(false),
      ),
      currentPage: recordCurrentPage,
    });

    return res;
  }, [
    recordFilter,
    externalInitConfig?.projectId,
    externalInitConfig?.warehouseId,
    consoleApi,
    recordPageSize,
    recordCurrentPage,
  ]);

  const [linkedDevices, getLinkedDevices] = useAsyncFn(async () => {
    if (
      deviceFilter == undefined ||
      externalInitConfig?.projectId == undefined ||
      externalInitConfig.warehouseId == undefined
    ) {
      return;
    }

    const res = await consoleApi.listProjectDevices({
      filter: CosQuery.Companion.deserialize(deviceFilter),
      pageSize: devicePageSize,
      currentPage: deviceCurrentPage,
      warehouseId: externalInitConfig.warehouseId,
      projectId: externalInitConfig.projectId,
    });

    return res;
  }, [
    deviceFilter,
    externalInitConfig?.projectId,
    externalInitConfig?.warehouseId,
    consoleApi,
    devicePageSize,
    deviceCurrentPage,
  ]);

  useEffect(() => {
    if (viewingTask == undefined) {
      // 重置过滤器状态，确保下次选择任务时能触发数据获取
      setRecordFilter(undefined);
      setDeviceFilter(undefined);
      return;
    }

    const defaultRecordFilter = CosQuery.Companion.empty();
    defaultRecordFilter.setField(
      QueryFields.TASK_ID,
      [BinaryOperator.EQ],
      [viewingTask.name.split("/").pop() ?? ""],
    );

    const recordFilterStr: string = defaultRecordFilter.serialize();
    setRecordFilter(recordFilterStr);

    const defaultDeviceFilter = CosQuery.Companion.empty();
    defaultDeviceFilter.setField(
      QueryFields.TASK_ID,
      [BinaryOperator.EQ],
      [viewingTask.name.split("/").pop() ?? ""],
    );

    const deviceFilterStr: string = defaultDeviceFilter.serialize();
    setDeviceFilter(deviceFilterStr);
  }, [viewingTask]);

  // 当过滤器变化时自动获取数据
  useEffect(() => {
    if (recordFilter != undefined) {
      void getLinkedRecords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordFilter, recordPageSize, recordCurrentPage]); // 故意不包含 getLinkedRecords 以避免循环依赖

  useEffect(() => {
    if (deviceFilter != undefined) {
      void getLinkedDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceFilter, devicePageSize, deviceCurrentPage]); // 故意不包含 getLinkedDevices 以避免循环依赖

  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open={viewingTask != undefined}
      hideBackdrop
      slotProps={{
        paper: {
          className: classes.drawer,
        },
      }}
    >
      <Box className={classes.content}>
        <Box className={classes.header}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Chip label={`#${viewingTask?.number}`} size="small" />
            <Typography variant="h6">{viewingTask?.title}</Typography>
          </Stack>
          <IconButton onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        {viewingTask && (
          <Box>
            <Tabs
              value={tabValue}
              onChange={(_, value: number) => {
                setTabValue(value);
              }}
              className={classes.tabs}
            >
              <Tab
                label={`${t("linkedRecords")}(${linkedRecords.value?.totalSize ?? 0})`}
                value={0}
              />
              <Tab
                label={`${t("linkedDevices")}(${linkedDevices.value?.totalSize ?? 0})`}
                value={1}
              />
            </Tabs>
          </Box>
        )}
        <Box className={classes.tableContainer}>
          {tabValue === 0 && linkedRecords.value && (
            <LinkedRecordsTable
              taskName={viewingTask?.name ?? ""}
              linkedRecords={linkedRecords.value}
              getLinkedRecords={getLinkedRecords}
              pageSize={recordPageSize}
              currentPage={recordCurrentPage}
              setPageSize={setRecordPageSize}
              setCurrentPage={setRecordCurrentPage}
              setFilter={setRecordFilter}
              filter={recordFilter}
              loading={linkedRecords.loading}
            />
          )}
          {tabValue === 1 && linkedDevices.value && (
            <LinkedDevicesTable
              taskName={viewingTask?.name ?? ""}
              linkedDevices={linkedDevices.value}
              getLinkedDevices={getLinkedDevices}
              pageSize={devicePageSize}
              currentPage={deviceCurrentPage}
              setPageSize={setDevicePageSize}
              setCurrentPage={setDeviceCurrentPage}
              filter={deviceFilter}
              setFilter={setDeviceFilter}
            />
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
