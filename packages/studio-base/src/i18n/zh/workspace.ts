// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const workspace: Partial<TypeOptions["resources"]["workspace"]> = {
  events: "事件",
  panel: "面板",
  performance: "性能",
  problems: "问题",
  studioLogs: "日志",
  topics: "话题",
  variables: "变量",
  extensions: "插件",
  invalidDomain: "仅支持播放{{domain}}的数据",
  recordInfo: "记录信息",
  outboundTrafficLimitReached: "组织流量使用已耗尽",
  outboundTrafficLimitReachedDesc: "组织流量使用已耗尽，如需继续使用，请增购流量或升级订阅计划。",
  iKnow: "我知道了",
  upgradeSubscriptionPlan: "升级订阅计划",
};
