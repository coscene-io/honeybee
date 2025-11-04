// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const stateTransitions: Partial<TypeOptions["resources"]["stateTransitions"]> = {
  addSeries: "添加序列",
  arrayError: "该路径解析出多个值",
  clickToAddSeries: "点击以添加序列",
  collapseAllSeries: "全部折叠",
  deleteSeries: "删除序列",
  expandAllSeries: "全部展开",
  general: "常规",
  insertSeries: "插入序列",
  label: "图例名称",
  max: "最大",
  maxXError: "X 最大值必须大于 X 最小值。",
  min: "最小",
  messagePath: "消息路径",
  series: "序列",
  seriesDefaultName: "序列 {{index}}",
  showPoints: "显示点",
  showPointsHelp: "为每条状态变化消息显示一个点",
  syncWithOtherPlots: "与其他图表同步",
  secondsRange: "范围（秒）",
  timestamp: "时间戳",
  timestampHeaderStamp: "消息头时间戳",
  timestampReceiveTime: "接收时间",
  xAxis: "X 轴",
};
