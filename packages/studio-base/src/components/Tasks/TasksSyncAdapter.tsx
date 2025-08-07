// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useEffect } from "react";
import { useAsync } from "react-use";

import { setDefaultFilter } from "@foxglove/studio-base/components/Tasks/TasksList/utils/taskFilterUtils";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { TaskStore, useTasks } from "@foxglove/studio-base/context/TasksContext";
import { CosQuery, SerializeOption } from "@foxglove/studio-base/util/coscene/cosel";

const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;

const selectSetCustomFieldSchema = (store: TaskStore) => store.setCustomFieldSchema;
const selectSetOrgTasks = (store: TaskStore) => store.setOrgTasks;
const selectSetProjectTasks = (store: TaskStore) => store.setProjectTasks;
const selectOrgTasksFilter = (store: TaskStore) => store.orgTasksFilter;
const selectProjectTasksFilter = (store: TaskStore) => store.projectTasksFilter;
const selectSetProjectTasksFilter = (store: TaskStore) => store.setProjectTasksFilter;
const selectReloadTrigger = (store: TaskStore) => store.reloadTrigger;

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

export function TasksSyncAdapter(): ReactNull {
  const externalInitConfig = useCoreData(selectExternalInitConfig);

  const consoleApi = useConsoleApi();

  const loginStatus = useCurrentUser(selectLoginStatus);
  const user = useCurrentUser(selectUser);

  const orgTasksFilter = useTasks(selectOrgTasksFilter);
  const projectTasksFilter = useTasks(selectProjectTasksFilter);
  const setProjectTasksFilter = useTasks(selectSetProjectTasksFilter);
  const setCustomFieldSchema = useTasks(selectSetCustomFieldSchema);
  const setOrgTasks = useTasks(selectSetOrgTasks);
  const setProjectTasks = useTasks(selectSetProjectTasks);
  const reloadTrigger = useTasks(selectReloadTrigger);

  useAsync(async () => {
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return;
    }
    // get task custom field schema
    const customFieldSchema = await consoleApi.getTaskCustomFieldSchema(
      `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`,
    );
    setCustomFieldSchema(customFieldSchema);
  }, [externalInitConfig, consoleApi, setCustomFieldSchema]);

  const projectTasks = useAsync(async () => {
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return;
    }
    let defaultFilter = projectTasksFilter;
    if (projectTasksFilter === "") {
      defaultFilter = setDefaultFilter(user?.userId ?? "");

      setProjectTasksFilter(defaultFilter);
    }
    const projectTasks = await consoleApi.listTasks({
      orderBy: "create_time DESC",
      parent: `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`,
      filter: CosQuery.Companion.deserialize(defaultFilter).toQueryString(
        new SerializeOption(false),
      ),
      pageSize: 1000,
    });
    return projectTasks.tasks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    externalInitConfig?.warehouseId,
    externalInitConfig?.projectId,
    projectTasksFilter,
    consoleApi,
    user?.userId,
    setProjectTasksFilter,
    reloadTrigger, // Trigger to reload project tasks when reloadProjectTasks() is called
  ]);

  useEffect(() => {
    setProjectTasks(projectTasks);
  }, [projectTasks, setProjectTasks]);

  // if user is login, get org tasks
  const orgTasks = useAsync(async () => {
    if (loginStatus !== "alreadyLogin") {
      return;
    }

    // get org tasks
    const orgTasks = await consoleApi.listTasks({
      orderBy: "create_time DESC",
      parent: "",
      pageSize: 1000,
      filter: orgTasksFilter,
    });

    return orgTasks.tasks;
  }, [loginStatus, consoleApi, orgTasksFilter]);

  useEffect(() => {
    setOrgTasks(orgTasks);
  }, [orgTasks, setOrgTasks]);

  return ReactNull;
}
