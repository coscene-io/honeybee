// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { TFunction } from "i18next";

import { BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

export type AssigneeFilterType = "assignedToMe" | "assignerIsMe";

export function setDefaultFilter(currentUserId: string): string {
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

  defaultFilter.setField(QueryFields.ASSIGNEE, [BinaryOperator.EQ], [currentUserId]);
  defaultFilter.setField(QueryFields.ASSIGNER, [BinaryOperator.EQ], []);

  return defaultFilter.serialize();
}

/**
 * 从过滤器字符串中获取用户角色过滤条件，默认为assignedToMe
 */
export function getAssigneeFilter(filterString: string, currentUserId: string): AssigneeFilterType {
  if (!filterString) {
    return "assignedToMe"; // 默认为分派给我的
  }

  try {
    const query = CosQuery.Companion.deserialize(filterString);

    const assigneeValue = query.getField(QueryFields.ASSIGNEE, BinaryOperator.EQ);
    const assignerValue = query.getField(QueryFields.ASSIGNER, BinaryOperator.EQ);

    if (assigneeValue === currentUserId) {
      return "assignedToMe";
    }

    if (assignerValue === currentUserId) {
      return "assignerIsMe";
    }

    return "assignedToMe"; // 默认为分派给我的
  } catch {
    return "assignedToMe";
  }
}

/**
 * 设置用户角色过滤条件到过滤器字符串
 */
export function setAssigneeFilter(
  currentFilterString: string,
  assigneeFilter: AssigneeFilterType,
  currentUserId: string,
): string {
  let defaultFilter = CosQuery.Companion.empty();

  if (currentFilterString) {
    defaultFilter = CosQuery.Companion.deserialize(currentFilterString);
  }

  // 设置用户角色过滤
  if (assigneeFilter === "assignedToMe") {
    defaultFilter.setField(QueryFields.ASSIGNEE, [BinaryOperator.EQ], [currentUserId]);
    defaultFilter.setField(QueryFields.ASSIGNER, [BinaryOperator.EQ], []);
  } else {
    defaultFilter.setField(QueryFields.ASSIGNER, [BinaryOperator.EQ], [currentUserId]);
    defaultFilter.setField(QueryFields.ASSIGNEE, [BinaryOperator.EQ], []);
  }

  return defaultFilter.serialize();
}

/**
 * 获取用户角色过滤显示文本
 */
export function getAssigneeDisplayName(
  assigneeFilter: AssigneeFilterType,
  t: TFunction<"task">,
): string {
  switch (assigneeFilter) {
    case "assignedToMe":
      return t("assignedToMe");
    case "assignerIsMe":
      return t("assignerIsMe");
    default:
      return t("assignedToMe");
  }
}

export type TaskStateType =
  | TaskStateEnum_TaskState.PENDING
  | TaskStateEnum_TaskState.PROCESSING
  | TaskStateEnum_TaskState.SUCCEEDED;

export const taskStateOptions: TaskStateType[] = [
  TaskStateEnum_TaskState.PENDING,
  TaskStateEnum_TaskState.PROCESSING,
  TaskStateEnum_TaskState.SUCCEEDED,
];

/**
 * 从过滤器字符串中获取任务状态过滤条件
 */
export function getTaskStateFilter(filterString: string): TaskStateType[] {
  if (!filterString) {
    return [];
  }

  const query = CosQuery.Companion.deserialize(filterString);
  const stateValues = query.getListField(QueryFields.STATE, BinaryOperator.EQ);

  if (stateValues != undefined && stateValues.length > 0) {
    const stateFilter = stateValues
      .map((state) => TaskStateEnum_TaskState[state as keyof typeof TaskStateEnum_TaskState])
      .filter((state): state is TaskStateType => taskStateOptions.includes(state as TaskStateType));

    return stateFilter;
  }

  return [];
}

/**
 * 设置任务状态过滤条件到过滤器字符串
 */
export function setTaskStateFilter(
  currentFilterString: string,
  taskStates: TaskStateType[],
): string {
  let defaultFilter = CosQuery.Companion.empty();

  if (currentFilterString) {
    defaultFilter = CosQuery.Companion.deserialize(currentFilterString);
  }

  // 设置任务状态过滤
  const stateStrings = taskStates.map((state) => TaskStateEnum_TaskState[state]);
  defaultFilter.setListField(QueryFields.STATE, BinaryOperator.EQ, stateStrings);

  return defaultFilter.serialize();
}

export function getTaskStateDisplayName(
  taskState: TaskStateEnum_TaskState,
  t: TFunction<"task">,
): string {
  switch (taskState) {
    case TaskStateEnum_TaskState.PENDING:
      return t("pending");
    case TaskStateEnum_TaskState.PROCESSING:
      return t("processing");
    case TaskStateEnum_TaskState.SUCCEEDED:
      return t("succeeded");
    default:
      return "";
  }
}
