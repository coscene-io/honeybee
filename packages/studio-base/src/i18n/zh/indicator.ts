// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const indicator: Partial<TypeOptions["resources"]["indicator"]> = {
  messagePath: "消息路径",
  style: "样式",
  bulb: "指示灯",
  background: "背景",
  rules: "规则",
  addRule: "添加规则",
  deleteRule: "删除规则",
  moveUp: "上移",
  moveDown: "下移",
  addRuleAbove: "在上方添加规则",
  addRuleBelow: "在下方添加规则",
  comparison: "比较",
  comparisonWith: "比较值",
  equalTo: "等于",
  lessThan: "小于",
  lessThanOrEqualTo: "小于或等于",
  greaterThan: "大于",
  greaterThanOrEqualTo: "大于或等于",
  color: "颜色",
  label: "标签",
  otherwise: "否则",
  fallbackColorHelp: "当没有其他规则匹配时使用的颜色",
  fallbackLabelHelp: "当没有其他规则匹配时使用的标签",
};
