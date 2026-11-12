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

  layout1: {
    overflow: "auto",
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
  },

  layout2: {
    flexDirection: "row",
    gap: theme.spacing(1),
    alignItems: "center",
  },

  layout3: {
    flex: "auto",
    padding: theme.spacing(2),
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  layout4: {
    flex: "auto",
    padding: theme.spacing(2),
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  layout5: {
    color: theme.palette.text.secondary,
  },

  layout6: {
    flexDirection: "row",
  },

  layout7: {
    marginLeft: theme.spacing(0),
    marginRight: theme.spacing(1.5),
    gap: theme.spacing(0.5),
    width: 12,
    marginTop: theme.spacing(0.5),
    alignItems: "center",
  },

  layout8: {
    borderRadius: "50%",
    width: 12,
    height: 12,
  },

  layout9: {
    width: "1px",
    height: "15px",
  },

  layout10: {
    paddingBottom: theme.spacing(10),
    flex: 1,
  },

  layout11: {
    flex: "auto",
    padding: theme.spacing(2),
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  layout12: {
    color: theme.palette.text.secondary,
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
    <Stack className={cx(classes.root, classes.layout1)}>
      <Stack
        style={{
          position: "sticky",
          top: 0,
          padding: "8px 0",
        }}
        className={classes.layout2}
      >
        <Select
          size="small"
          value={currentAssigneeFilter}
          onChange={(event) => {
            handleAssigneeFilterChange(event.target.value);
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
          className={cx({ [classes.taskStateSelector]: currentTaskStateFilter.length > 0 })}
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
        <Stack className={classes.layout3}>
          <CircularProgress />
        </Stack>
      )}
      {projectTasks.value?.length === 0 && (
        <Stack className={classes.layout4}>
          <Typography align="center" className={classes.layout5}>
            {t("noContent")}
          </Typography>
        </Stack>
      )}

      {projectTasks.value && projectTasks.value.length > 0 && (
        <Stack className={classes.layout6}>
          <Stack className={classes.layout7}>
            <Stack
              style={{
                backgroundColor: "#3b82f6",
              }}
              className={classes.layout8}
            />
            <Stack className={cx(classes.line, classes.layout9)} />
          </Stack>

          <Typography variant="button" gutterBottom>
            {t("generalTasks")}
          </Typography>
        </Stack>
      )}

      <Stack className={classes.layout10}>
        {projectTasks.value?.map((task) => {
          return <TaskView key={task.name} task={task} />;
        })}

        {projectTasks.value && projectTasks.value.length > 0 && (
          <Stack className={classes.layout11}>
            <Typography align="center" className={classes.layout12}>
              {t("allLoaded")}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
