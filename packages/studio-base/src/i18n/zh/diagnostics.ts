// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const diagnostics: Partial<TypeOptions["resources"]["diagnostics"]> = {
  general: "通用",
  topic: "话题",
  sortByLevel: "按级别排序",
  staleTimeout: "过期超时",
  staleTimeoutHelp: "若在指定秒数内未收到新的诊断消息，条目将被标记为过期",
  secondsPlaceholder: "{{seconds}} 秒",
  numericPrecision: "数值精度",
  topicNotAvailable: "话题 {{topic}} 不可用",
  waitingForDiagnosticsFrom: "正在等待来自 {{name}} 的诊断",
  noDiagnosticNodeSelected: "未选择诊断节点",
  waitingForMessages: "正在等待 {{topic}} 消息",
  noMatches: "无匹配项",
  waitingForDiagnostics: "正在等待诊断…",
};
