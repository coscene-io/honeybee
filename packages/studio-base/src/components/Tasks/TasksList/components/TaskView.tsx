// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { alpha, Stack, Select, MenuItem, Button } from "@mui/material";
import { useRef } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Avatar from "@foxglove/studio-base/components/Avatar";
import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import {
  getTaskStateDisplayName,
  taskStateOptions,
  TaskStateType,
} from "@foxglove/studio-base/components/Tasks/TasksList/utils/taskFilterUtils";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";

const useStyles = makeStyles<void, "taskSelected">()((theme, _params) => ({
  line: {
    backgroundColor: theme.palette.divider,
  },
  ring: {
    height: "8px",
    width: "8px",
    borderRadius: "14px",
    border: "2px solid",
  },
  taskTitle: {
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
  task: {
    wordBreak: "break-all",
    flexDirection: "column",
    cursor: "pointer",
    padding: "12px",
    borderRadius: "4px",
    backgroundColor: theme.palette.background.default,
    "&:hover": {
      backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
    },
    // 当按钮或其他交互元素被hover时，取消父容器的hover效果
    "&:has(button:hover), &:has(.MuiSelect-root:hover)": {
      backgroundColor: theme.palette.background.default,
    },
  },
  taskSelected: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.activatedOpacity),
    boxShadow: `0 0 0 1px ${theme.palette.info.main}`,
  },
}));

const selectFocusedTask = (store: TaskStore) => store.focusedTask;
const selectSetFocusedTask = (store: TaskStore) => store.setFocusedTask;
const selectSetViewingTask = (store: TaskStore) => store.setViewingTask;
const selectReloadProjectTasks = (store: TaskStore) => store.reloadProjectTasks;
const selectCustomFieldSchema = (store: TaskStore) => store.customFieldSchema;

export default function TaskView(params: { task: Task }): React.JSX.Element {
  const { t } = useTranslation("task");

  const { task } = params;

  const scrollRef = useRef<HTMLDivElement>(ReactNull);

  const { classes, cx } = useStyles();

  const focusedTask = useTasks(selectFocusedTask);

  const setFocusedTask = useTasks(selectSetFocusedTask);
  const setViewingTask = useTasks(selectSetViewingTask);
  const reloadProjectTasks = useTasks(selectReloadProjectTasks);

  const customFieldSchema = useTasks(selectCustomFieldSchema);

  const consoleApi = useConsoleApi();

  const handleUpdateTaskState = async (state: TaskStateType) => {
    try {
      await consoleApi.updateTask({
        task: {
          name: task.name,
          state,
        },
        updateMask: { paths: ["state"] },
      });
      reloadProjectTasks();
      toast.success(t("updateTaskStateSuccess"));
    } catch (error) {
      console.error(error);
      toast.error(t("updateTaskStateFailed"));
    }
  };

  return (
    <Stack flexDirection="row" ref={scrollRef}>
      <Stack marginLeft={0} marginRight={1.5} gap={0.5} alignItems="center">
        <Stack width="1px" height="5px" className={classes.line} />
        <div
          className={classes.ring}
          style={{
            borderColor: "#3b82f6",
          }}
        />
        <Stack width="1px" flex="1" className={classes.line} />
      </Stack>

      <Stack flex={1} gap={1}>
        <Stack flex={1} width="0" marginTop={1}>
          <Stack className={classes.taskTitle}>#{Number(task.number)}</Stack>
        </Stack>

        <Stack
          data-testid="sidebar-event"
          className={cx(classes.task, {
            [classes.taskSelected]: focusedTask != undefined && focusedTask.name === task.name,
          })}
          onClick={() => {
            setFocusedTask(task);
            toast.success(t("taskFocused", { number: task.number }));
          }}
          gap={1.5}
        >
          <Stack>{task.title}</Stack>
          <Stack flexDirection="row" justifyContent="space-between" alignItems="center">
            <Select
              size="small"
              value={task.state}
              onChange={(event) => {
                void handleUpdateTaskState(event.target.value as TaskStateType);
              }}
              variant="filled"
              style={{ minWidth: 120 }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {taskStateOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {getTaskStateDisplayName(option, t)}
                </MenuItem>
              ))}
            </Select>

            <Avatar
              userName={task.assignee}
              renderTitle={(userInfo) => {
                return (
                  <Stack>
                    <Stack>{`${t("assignee")}: ${userInfo?.nickname}`}</Stack>
                  </Stack>
                );
              }}
            />
          </Stack>

          {/* <Divider />
          <Stack
            flexDirection="row"
            gap={1}
            alignItems="center"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Stack flex={1} flexDirection="row" gap={0.5} justifyContent="center">
              <Stack>
                <ArticleIcon style={{ fontSize: 16 }} />
              </Stack>
              <Stack justifyContent="space-between">
                <Stack>关联记录</Stack>
                <Stack>0</Stack>
              </Stack>
            </Stack>
            <Divider orientation="vertical" flexItem />
            <Stack flex={1} flexDirection="row" gap={0.5} justifyContent="center">
              <Stack>
                <DevicesIcon style={{ fontSize: 16 }} />
              </Stack>
              <Stack justifyContent="space-between">
                <Stack>关联设备</Stack>
                <Stack>0</Stack>
              </Stack>
            </Stack>
            <Divider orientation="vertical" flexItem />
            <Stack flex={1} flexDirection="row" gap={0.5} justifyContent="center">
              <Stack>
                <TaskIcon style={{ fontSize: 16 }} />
              </Stack>
              <Stack justifyContent="space-between">
                <Stack>关联任务</Stack>
                <Stack>0</Stack>
              </Stack>
            </Stack>
          </Stack>
          <Divider /> */}

          <Stack paddingTop={2} gap={2}>
            {/* custom field */}
            <CustomFieldValuesFields
              variant="secondary"
              properties={customFieldSchema?.properties ?? []}
              customFieldValues={task.customFieldValues}
              readonly
              ignoreProperties
            />
          </Stack>

          {/* view detail */}
          <Stack>
            <Button
              variant="outlined"
              color="primary"
              onClick={(e) => {
                e.stopPropagation();
                setViewingTask(task);
              }}
            >
              {t("viewDetail")}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Stack>
  );
}
