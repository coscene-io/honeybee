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
  selectedRowsCount: "共选择了 {{count}} 行",
  batchOperation: "批量操作",
  recordName: "名称",
  labels: "标签",
  deviceId: "设备 ID",
  deviceName: "设备名称",
  creator: "创建者",
  createTime: "创建时间",
  updateTime: "更新时间",
  confirmVizTargetRecord: "进入记录回放",
  confirmVizTargetRecordDescription:
    "切换后，页面将打断当前的操作，进入 {{recordTitle}} 的数据回放，确认进入吗？",
  enterImmediately: "立即进入",
  clearAllFilters: "清除所有过滤器",
  confirmVizTargetDevice: "进入设备实时可视化",
  confirmVizTargetDeviceDescription:
    "切换后，页面将打断当前的操作，进入 {{deviceTitle}} 的设备实时可视化，确认进入吗？",
  switchImmediately: "立即切换",
  linkedRecords: "关联记录",
  linkedDevices: "关联设备",
  unlinkRecord: "取消关联",
  playRecord: "播放记录",
  copyRecordId: "复制记录ID",
  copySuccess: "复制成功",
  addLinkedRecord: "添加关联记录",
  addLinkedRecordSuccess: "添加关联记录成功",
  addLinkedRecordFailed: "添加关联记录失败",
  visualizeDevice: "可视化设备",
  addLink: "添加关联",
  addLinkedDevice: "添加关联设备",
  addLinkedDeviceSuccess: "添加关联设备成功",
  addLinkedDeviceFailed: "添加关联设备失败",
  assignee: "经办人",
  allLoaded: "已经加载全部",
  taskFocused: "数据采集面板上传的记录将自动关联到任务 #{{number}}",
};
