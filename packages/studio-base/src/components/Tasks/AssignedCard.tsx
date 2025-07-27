// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Box, Card, CardActionArea, Divider, Tooltip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { fromDate } from "@foxglove/rostime";
import Stack from "@foxglove/studio-base/components/Stack";
import { useTasks } from "@foxglove/studio-base/context/TasksContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks/useAppTimeFormat";

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

export function AssignedCard({ task, project, onClick }: AssignedCardProps): React.JSX.Element {
  const { t } = useTranslation("task");
  const { classes, cx } = useStyles();
  const { formatTime } = useAppTimeFormat();

  const setViewingTask = useTasks((store) => store.setViewingTask);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      setViewingTask(task);
    }
  };

  const formattedDate = task.createTime ? formatTime(fromDate(task.createTime.toDate())) : "";

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
