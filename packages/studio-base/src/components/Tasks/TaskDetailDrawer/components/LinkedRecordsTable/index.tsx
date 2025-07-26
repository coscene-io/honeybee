// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListRecordsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { Stack, Box } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import LinkRecord from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedRecordsTable/components/LinkRecord";
import RecordTable from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedRecordsTable/components/RecordTable";
import RecordTableFilter from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedRecordsTable/components/RecordTableFilter";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const useStyles = makeStyles()(() => ({
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
}));

const selectProject = (store: CoSceneBaseStore) => store.project;

export default function LinkedRecordsTable({
  taskName,
  linkedRecords,
  getLinkedRecords,
  pageSize,
  currentPage,
  setPageSize,
  setCurrentPage,
  filter,
  setFilter,
}: {
  taskName: string;
  linkedRecords: ListRecordsResponse;
  getLinkedRecords: () => Promise<ListRecordsResponse | undefined>;
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

  const handleUnlinkRecord = useCallback(
    async (selectedRowIds: string[]) => {
      await consoleApi.unlinkTasks({
        project: project.value?.name,
        unlinkTasks: selectedRowIds.map((id) => ({
          task: taskName,
          target: { value: id, case: "record" },
        })),
      });
      await getLinkedRecords();
    },
    [consoleApi, project.value?.name, taskName, getLinkedRecords],
  );

  return (
    <Box className={classes.container}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" flex={1}>
          <RecordTableFilter filter={filter} setFilter={setFilter} />
        </Stack>
        <LinkRecord taskName={taskName} getLinkedRecords={getLinkedRecords} />
      </Stack>
      <RecordTable
        listRecordsResponse={linkedRecords}
        pageSize={pageSize}
        currentPage={currentPage}
        setPageSize={setPageSize}
        setCurrentPage={setCurrentPage}
        onBatchAction={handleUnlinkRecord}
        batchActionButtonText={t("unlinkRecord")}
      />
    </Box>
  );
}
