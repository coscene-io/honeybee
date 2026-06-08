// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Project } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { Task } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/resources/task_pb";
import { Box, Card, CircularProgress, Tab, Tabs, Typography } from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";
import { AssignedCard } from "@foxglove/studio-base/components/Tasks/AssignedCard";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { UserStore, useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { BinaryOperator, CosQuery, SerializeOption } from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

const useStyles = makeStyles()((theme) => ({
  panel: {
    minWidth: 350,
    flex: 1,
    backgroundColor: theme.palette.background.paper,
    overflow: "hidden",
  },
  header: {
    padding: theme.spacing(0, 2, 0, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  tabs: {
    minHeight: 40,
    "& .MuiTabs-indicator": {
      height: 2,
    },
  },
  tab: {
    minHeight: 40,
    padding: theme.spacing(1, 2),
    fontSize: 14,
    textTransform: "none",
    fontWeight: 500,
  },
  content: {
    padding: theme.spacing(1),
    maxHeight: 400,
    overflow: "auto",
  },
  sectionHeader: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(1, 1, 0.5, 1),
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: theme.palette.text.secondary,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing(4),
  },
  emptyContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(4),
    color: theme.palette.text.secondary,
  },
  loadedIndicator: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(2),
    fontSize: 14,
    color: theme.palette.text.secondary,
  },
}));

type TaskPanelTab = "assignee" | "assigner";

interface TaskWithProject {
  task: Task;
  project?: Project;
}

const selectUser = (store: UserStore) => store.user;

function getTaskStateColor(state: TaskStateEnum_TaskState): string {
  switch (state) {
    case TaskStateEnum_TaskState.PROCESSING:
      return "#2563eb"; // blue-600
    case TaskStateEnum_TaskState.PENDING:
      return "#ea580c"; // orange-600
    default:
      return "#6b7280"; // gray-500
  }
}

export function TaskPanel(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("task");
  const [activeTab, setActiveTab] = useState<TaskPanelTab>("assignee");
  const consoleApi = useConsoleApi();
  const user = useCurrentUser(selectUser);

  const getTaskStateDisplayName = (state: TaskStateEnum_TaskState): string => {
    switch (state) {
      case TaskStateEnum_TaskState.PROCESSING:
        return t("processing");
      case TaskStateEnum_TaskState.PENDING:
        return t("pending");
      default:
        return "";
    }
  };

  // 构建查询过滤器
  const createFilter = useCallback((tab: TaskPanelTab, userId: string): string => {
    const defaultFilter = CosQuery.Companion.empty();
    defaultFilter.setField(
      QueryFields.CATEGORY,
      [BinaryOperator.EQ],
      [TaskCategoryEnum_TaskCategory[TaskCategoryEnum_TaskCategory.COMMON]],
    );

    defaultFilter.setListField(QueryFields.STATE, BinaryOperator.EQ, [
      TaskStateEnum_TaskState[TaskStateEnum_TaskState.PROCESSING],
      TaskStateEnum_TaskState[TaskStateEnum_TaskState.PENDING],
    ]);

    if (tab === "assignee") {
      defaultFilter.setField(QueryFields.ASSIGNEE, [BinaryOperator.EQ], [userId]);
    } else {
      defaultFilter.setField(QueryFields.ASSIGNER, [BinaryOperator.EQ], [userId]);
    }

    return defaultFilter.toQueryString(new SerializeOption(false));
  }, []);

  // 获取任务列表
  const tasksState = useAsync(async () => {
    if (!user?.userId) {
      return [];
    }

    const filter = createFilter(activeTab, user.userId);
    const response = await consoleApi.listTasks({
      orderBy: "assigned_time desc",
      parent: "",
      filter,
      pageSize: 1000,
    });

    return response.tasks;
  }, [activeTab, user?.userId, createFilter, consoleApi]);

  // 获取项目信息
  const projectsState = useAsync(async () => {
    if (!tasksState.value || tasksState.value.length === 0) {
      return [];
    }

    const projectIds = Array.from(
      new Set(
        tasksState.value
          .map((task) => task.name.split("/tasks/")[0]?.split("/").pop())
          .filter((id): id is string => id != undefined),
      ),
    );

    if (projectIds.length === 0) {
      return [];
    }

    const filter = CosQuery.Companion.empty();
    filter.setListField("id", BinaryOperator.EQ, projectIds);

    const response = await consoleApi.listUserProjects({
      userId: "current",
      pageSize: 1000,
      filter: filter.toQueryString(new SerializeOption(false)),
      currentPage: 0,
    });

    return response.userProjects;
  }, [tasksState.value, consoleApi]);

  // 组合任务和项目数据
  const { processingTasks, pendingTasks } = useMemo(() => {
    if (!tasksState.value || !projectsState.value) {
      return { processingTasks: [], pendingTasks: [] };
    }

    const tasksWithProjects: TaskWithProject[] = tasksState.value.map((task) => {
      const projectName = task.name.split("/tasks/")[0];
      const project = projectsState.value?.find((p) => p.name === projectName);
      return { task, project };
    });

    const processingTasks = tasksWithProjects.filter(
      ({ task }) => task.state === TaskStateEnum_TaskState.PROCESSING,
    );
    const pendingTasks = tasksWithProjects.filter(
      ({ task }) => task.state === TaskStateEnum_TaskState.PENDING,
    );

    return { processingTasks, pendingTasks };
  }, [tasksState.value, projectsState.value]);

  const renderTaskSection = (
    tasks: TaskWithProject[],
    state: TaskStateEnum_TaskState,
  ): React.JSX.Element | undefined => {
    if (tasks.length === 0) {
      return undefined;
    }

    return (
      <Box>
        <div className={classes.sectionHeader}>
          <div className={classes.sectionTitle}>
            <Box
              className={classes.statusDot}
              style={{ backgroundColor: getTaskStateColor(state) }}
            />
            {getTaskStateDisplayName(state)}
          </div>
        </div>
        <Stack gap={1}>
          {tasks.map(({ task, project }) => (
            <AssignedCard key={task.name} task={task} project={project} />
          ))}
        </Stack>
      </Box>
    );
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: TaskPanelTab) => {
    setActiveTab(newValue);
  };

  const isLoading = tasksState.loading || projectsState.loading;
  const hasData = processingTasks.length > 0 || pendingTasks.length > 0;

  return (
    <Stack gap={1} fullHeight>
      <Typography variant="h5" gutterBottom>
        {t("assignedToMe")}
      </Typography>
      <Card className={classes.panel} elevation={0}>
        <div className={classes.header}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            className={classes.tabs}
            variant="fullWidth"
          >
            <Tab className={classes.tab} label={t("assignedToMe")} value="assignee" />
            <Tab className={classes.tab} label={t("assignerIsMe")} value="assigner" />
          </Tabs>
        </div>
        <div className={classes.content}>
          {isLoading && (
            <div className={classes.loadingContainer}>
              <CircularProgress size={24} />
            </div>
          )}
          {!isLoading && !hasData && (
            <div className={classes.emptyContainer}>
              <Typography variant="body2">{t("noContent")}</Typography>
            </div>
          )}
          {!isLoading && hasData && (
            <Stack gap={2}>
              {renderTaskSection(processingTasks, TaskStateEnum_TaskState.PROCESSING)}
              {renderTaskSection(pendingTasks, TaskStateEnum_TaskState.PENDING)}
              <div className={classes.loadedIndicator}>
                <Typography variant="body2">{t("allLoaded")}</Typography>
              </div>
            </Stack>
          )}
        </div>
      </Card>
    </Stack>
  );
}
