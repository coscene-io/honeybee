// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { TypeOptions } from "i18next";

export const rawMessages: Partial<TypeOptions["resources"]["rawMessages"]> = {
  toggleDiff: "切换差异",
  expandAll: "全部展开",
  collapseAll: "全部折叠",
  previousFrame: "上一帧（↑）",
  nextFrame: "下一帧（↓）",
  noPreviousMatchingFrame: "未找到上一条匹配帧",
  noNextMatchingFrame: "未找到下一条匹配帧",
  searchingPreviousMatchingFrame: "正在查找上一条匹配帧…",
  searchingNextMatchingFrame: "正在查找下一条匹配帧…",
  diffMethod: "对比方式",
  previousMessage: "上一条消息",
  custom: "自定义",
  noTopicSelected: "未选择话题",
  waitingForNextMessage: "等待下一条消息…",
  waitingToDiff: "正在等待对比「{{topicPath}}」和「{{diffTopicPath}}」的下一条消息",
  noDifferenceFound: "未发现差异",
  general: "通用",
  fontSize: "字体大小",
  auto: "自动",
};
