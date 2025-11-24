// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CustomFieldSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Task } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/resources/task_pb";
import { createContext } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type TaskStore = {
  // All tasks in the organization
  orgTasks: AsyncState<Task[]>;
  // Filter for organization tasks
  orgTasksFilter: string;

  // All tasks in current project
  projectTasks: AsyncState<Task[]>;
  // Filter for project tasks
  projectTasksFilter: string;

  // Focused task
  focusedTask: Task | undefined;
  // Task being viewed
  viewingTask: Task | undefined;

  // task custom field schema
  customFieldSchema: CustomFieldSchema | undefined;

  // Trigger counter for reloading project tasks
  reloadTrigger: number;

  setOrgTasks: (tasks: AsyncState<Task[]>) => void;
  setOrgTasksFilter: (filter: string) => void;

  setProjectTasks: (tasks: AsyncState<Task[]>) => void;
  setProjectTasksFilter: (filter: string) => void;

  setFocusedTask: (task: Task | undefined) => void;
  setViewingTask: (task: Task | undefined) => void;

  setCustomFieldSchema: (customFieldSchema: CustomFieldSchema | undefined) => void;

  reloadProjectTasks: () => void;
};

export const TasksContext = createContext<undefined | StoreApi<TaskStore>>(undefined);

export function useTasks<T>(selector: (store: TaskStore) => T): T {
  const context = useGuaranteedContext(TasksContext);
  return useStore(context, selector);
}
