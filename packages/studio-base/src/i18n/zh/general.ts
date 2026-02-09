// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

// Generic global translation
export const general: Partial<TypeOptions["resources"]["general"]> = {
  foxglove: "Foxglove",
  learnMore: "了解更多",
  on: "开",
  off: "关",
  auto: "自动",
  from: "来自",
  project: "项目",
  viz: "可视化",
  shadowMode: "影子模式",
  realtimeViz: "实时可视化",
  testing: "批量测试",
  onlineData: "在线数据",
  pleaseSelect: "请选择",
  pleaseEnter: "请输入",
  clearButtonLabel: "清除",
  okButtonLabel: "确定",
  unknownField: "未知字段",
  sec: "秒",
  coScene: "coScene",
  apply: "使用",
  refresh: "刷新",
  name: "名称",
  cancel: "取消",
  delete: "删除",
  ok: "确定",
  search: "搜索",
  save: "保存",
  userGuide: "用户指引",
  done: "完成",
  seekBackward: "后退",
  pause: "暂停",
  play: "播放",
  seekForward: "前进",
  seekStepDescription: "步长，暂停时，使用前进和后退按钮控制回放的进退时间",
  loopPlayback: "循环播放",
  invalidSeekStep: "步长需大于等于 1e-6 秒且小于等于 1 小时，已重置为 0.1 秒。",
  playbackSpeed: "播放速度",
};
