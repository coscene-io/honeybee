// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { CircularProgress, Stack, Typography, Select, MenuItem } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { TaskStateItem } from "@foxglove/studio-base/components/Tasks/TasksList/components/TaskStateItem";
import {
  AssigneeFilterType,
  getAssigneeFilter,
  setAssigneeFilter,
  getAssigneeDisplayName,
  getTaskStateFilter,
  setTaskStateFilter,
  TaskStateType,
  taskStateOptions,
} from "@foxglove/studio-base/components/Tasks/TasksList/utils/taskFilterUtils";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";

import TaskView from "./components/TaskView";

const useStyles = makeStyles()((theme) => ({
  root: {
    backgroundColor: theme.palette.background.paper,
  },
  line: {
    backgroundColor: theme.palette.divider,
  },
  taskStateSelector: {
    "& .MuiSelect-select": {
      paddingBottom: "4px",
      paddingTop: "4px",
    },
  },
}));

const selectProjectTasks = (store: TaskStore) => store.projectTasks;
const selectProjectTasksFilter = (store: TaskStore) => store.projectTasksFilter;
const selectSetProjectTasksFilter = (store: TaskStore) => store.setProjectTasksFilter;
const selectUser = (store: UserStore) => store.user;

export function TasksList(): React.JSX.Element {
  const { t } = useTranslation("task");

  const projectTasks = useTasks(selectProjectTasks);
  const projectTasksFilter = useTasks(selectProjectTasksFilter);
  const setProjectTasksFilter = useTasks(selectSetProjectTasksFilter);
  const user = useCurrentUser(selectUser);

  const currentUserId = user?.userId ?? "";

  // 从过滤器字符串解析当前的过滤条件
  const currentAssigneeFilter = useMemo(() => {
    return getAssigneeFilter(projectTasksFilter, currentUserId);
  }, [projectTasksFilter, currentUserId]);

  // 处理过滤器变更
  const handleAssigneeFilterChange = (newAssigneeFilter: AssigneeFilterType) => {
    const newFilter = setAssigneeFilter(projectTasksFilter, newAssigneeFilter, currentUserId);
    setProjectTasksFilter(newFilter);
  };

  const currentTaskStateFilter = useMemo(() => {
    return getTaskStateFilter(projectTasksFilter);
  }, [projectTasksFilter]);

  const handleTaskStateFilterChange = (newTaskStateFilter: TaskStateType[]) => {
    const newFilter = setTaskStateFilter(projectTasksFilter, newTaskStateFilter);
    setProjectTasksFilter(newFilter);
  };

  // 准备选项数据
  const assigneeOptions: AssigneeFilterType[] = ["assignedToMe", "assignerIsMe"];

  const { classes, cx } = useStyles();

  return (
    <Stack className={classes.root} overflow="auto" paddingX={2}>
      <Stack
        style={{
          minHeight: 50,
          position: "sticky",
          top: 0,
          padding: "8px 0",
        }}
        flexDirection="row"
        gap={2}
        alignItems="center"
      >
        <Select
          size="small"
          value={currentAssigneeFilter}
          onChange={(event) => {
            handleAssigneeFilterChange(event.target.value as AssigneeFilterType);
          }}
          variant="filled"
        >
          {assigneeOptions.map((option) => (
            <MenuItem key={option} value={option}>
              {getAssigneeDisplayName(option, t)}
            </MenuItem>
          ))}
        </Select>

        <Select
          size="small"
          multiple
          value={currentTaskStateFilter}
          onChange={(event) => {
            handleTaskStateFilterChange(event.target.value as TaskStateType[]);
          }}
          variant="filled"
          renderValue={(selected) => {
            const selectedArray = Array.isArray(selected) ? selected : [selected];
            return selectedArray.map((option, index) => {
              return <TaskStateItem key={`${option}-${index}`} state={option} />;
            });
          }}
          className={cx(currentTaskStateFilter.length > 0 && classes.taskStateSelector)}
          MenuProps={{
            slotProps: {
              list: {
                dense: true,
              },
              paper: {
                style: {
                  maxHeight: 240,
                  overflow: "auto",
                },
              },
            },
          }}
        >
          {taskStateOptions.map((option) => (
            <MenuItem key={option} value={option}>
              <TaskStateItem state={option} />
            </MenuItem>
          ))}
        </Select>
      </Stack>
      {projectTasks.loading && (
        <Stack flex="auto" padding={2} height="100%" alignItems="center" justifyContent="center">
          <CircularProgress />
        </Stack>
      )}
      {projectTasks.value && projectTasks.value.length === 0 && (
        <Stack flex="auto" padding={2} height="100%" alignItems="center" justifyContent="center">
          <Typography align="center" color="text.secondary">
            {t("noContent")}
          </Typography>
        </Stack>
      )}

      {projectTasks.value && projectTasks.value.length > 0 && (
        <Stack flexDirection="row">
          <Stack
            marginLeft={0}
            marginRight={1.5}
            gap={0.5}
            width={12}
            marginTop={0.5}
            alignItems="center"
          >
            <Stack
              borderRadius="50%"
              width={12}
              height={12}
              style={{
                backgroundColor: "#3b82f6",
              }}
            />
            <Stack width="1px" height="15px" className={classes.line} />
          </Stack>

          <Typography variant="button" gutterBottom>
            {t("generalTasks")}
          </Typography>
        </Stack>
      )}

      <Stack paddingBottom={10} flex={1}>
        {projectTasks.value?.map((task) => {
          return <TaskView key={task.name} task={task} />;
        })}

        {projectTasks.value && projectTasks.value.length > 0 && (
          <Stack flex="auto" padding={2} height="100%" alignItems="center" justifyContent="center">
            <Typography align="center" color="text.secondary">
              {t("allLoaded")}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
