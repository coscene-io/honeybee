// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Box, Card, CardActionArea, Divider, Tooltip, Typography } from "@mui/material";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useTasks } from "@foxglove/studio-base/context/TasksContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";

const useStyles = makeStyles()((theme) => ({
  taskCard: {
    height: 64,
    width: "100%",
    overflow: "hidden",
    borderRadius: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
  taskCardClickable: {
    cursor: "pointer",
    "&:hover": {
      "& .task-title": {
        color: theme.palette.primary.main,
      },
    },
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  taskMeta: {
    fontSize: 12,
    color: theme.palette.text.secondary,
    lineHeight: 1.2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  divider: {
    margin: `0 ${theme.spacing(1)}`,
    height: 12,
    alignSelf: "center",
  },
}));

interface AssignedCardProps {
  task: Task;
  project?: Project;
  onClick?: () => void;
}

function getTaskStateColor(state: TaskStateEnum_TaskState): string {
  switch (state) {
    case TaskStateEnum_TaskState.PROCESSING:
      return "#2563eb"; // blue-600
    case TaskStateEnum_TaskState.PENDING:
      return "#ea580c"; // orange-600
    case TaskStateEnum_TaskState.SUCCEEDED:
      return "#16a34a"; // green-600
    default:
      return "#6b7280"; // gray-500
  }
}

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;
const selectSetBaseInfo = (store: CoSceneBaseStore) => store.setBaseInfo;

export function AssignedCard({ task, project, onClick }: AssignedCardProps): React.JSX.Element {
  const { t } = useTranslation("task");
  const { classes, cx } = useStyles();
  const { dialogActions, sidebarActions } = useWorkspaceActions();

  const baseInfo = useBaseInfo(selectBaseInfo);
  const setBaseInfo = useBaseInfo(selectSetBaseInfo);
  const consoleApi = useConsoleApi();

  const setViewingTask = useTasks((store) => store.setViewingTask);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      const newBaseInfo = {
        ...baseInfo.value,
        projectId: task.name.split("/")[3] ?? "",
        warehouseId: task.name.split("/")[1] ?? "",
      };
      setBaseInfo({
        value: newBaseInfo,
        loading: false,
      });
      void consoleApi.setApiBaseInfo(newBaseInfo);
      setViewingTask(task);
      sidebarActions.left.selectItem("tasks");
      dialogActions.dataSource.close();
    }
  };

  const formattedDate = task.createTime ? dayjs(task.createTime.toDate()).format("YYYY-MM-DD") : "";

  return (
    <Card className={classes.taskCard} elevation={0}>
      <CardActionArea
        className={cx({ [classes.taskCardClickable]: onClick != undefined })}
        onClick={handleClick}
        style={{ height: "100%", padding: 12 }}
      >
        <Stack style={{ height: "100%" }} justifyContent="space-between">
          <Tooltip title={task.title} placement="top" arrow>
            <Typography className={cx(classes.taskTitle, "task-title")} noWrap>
              {task.title}
            </Typography>
          </Tooltip>
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Box
              className={classes.statusDot}
              style={{ backgroundColor: getTaskStateColor(task.state) }}
            />
            <Typography className={classes.taskMeta} noWrap>
              #{String(task.number)}
            </Typography>
            <Divider orientation="vertical" className={classes.divider} />
            <Typography className={classes.taskMeta} noWrap>
              {t("createTime")}: {formattedDate}
            </Typography>
            {project && (
              <>
                <Divider orientation="vertical" className={classes.divider} />
                <Tooltip title={project.displayName} placement="bottom" arrow>
                  <Typography className={classes.taskMeta} noWrap>
                    {project.displayName}
                  </Typography>
                </Tooltip>
              </>
            )}
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
