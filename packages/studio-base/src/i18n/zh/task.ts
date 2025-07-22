// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const task: Partial<TypeOptions["resources"]["task"]> = {
  generalTasks: "通用任务",
  noContent: "暂无内容",
  assignedToMe: "指派给我的",
  assignerIsMe: "待我审核的",
  viewDetail: "查看详情",
  pending: "待处理",
  processing: "处理中",
  succeeded: "已完成",
  updateTaskStateSuccess: "更新任务状态成功",
  updateTaskStateFailed: "更新任务状态失败",
};
