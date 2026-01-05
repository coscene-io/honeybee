// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const cosSettings: Partial<TypeOptions["resources"]["cosSettings"]> = {
  high: "高",
  mid: "中",
  low: "低",
  original: "原始值",
  quality: "画质与帧率优化",
  willTakeEffectOnTheNextStartup: "设置已更新，重启 coStudio 后生效 <Link>立即重启</Link>",
  relativeTime: "相对时间",
  absoluteTime: "绝对时间",
  off: "关",
  on: "开",
  auto: "自动",
  understandFrameRateOptimization: "了解帧率优化",
  selectProjectSources: "选择项目资源",
  domain: "域名",
  domainDescription: "配置或切换域名",
  example: "示例",
  invalidDomain: "无效的 URL。必须以 https:// 开头，且以 coscene.io 或 coscene.cn 结尾",
};
