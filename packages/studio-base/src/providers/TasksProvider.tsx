// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CustomFieldSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Task } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/resources/task_pb";
import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import { TasksContext, TaskStore } from "@foxglove/studio-base/context/TasksContext";

function createTasksStore() {
  return createStore<TaskStore>((set, get) => ({
    projectTasks: { loading: false, value: [] },
    focusedTask: undefined,
    viewingTask: undefined,
    customFieldSchema: undefined,
    projectTasksFilter: "",
    reloadTrigger: 0,
    setProjectTasks: (tasks: AsyncState<Task[]>) => {
      set({ projectTasks: tasks });
    },
    setFocusedTask: (task: Task | undefined) => {
      set({ focusedTask: task });
    },
    setViewingTask: (task: Task | undefined) => {
      set({ viewingTask: task });
    },
    setProjectTasksFilter: (filter: string) => {
      set({ projectTasksFilter: filter });
    },
    setCustomFieldSchema: (customFieldSchema: CustomFieldSchema | undefined) => {
      set({ customFieldSchema });
    },
    reloadProjectTasks: () => {
      set({ reloadTrigger: get().reloadTrigger + 1 });
    },
  }));
}

export default function TasksProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  const [store] = useState(createTasksStore);

  return <TasksContext.Provider value={store}>{children}</TasksContext.Provider>;
}
