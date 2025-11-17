// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const appSettings: Partial<TypeOptions["resources"]["appSettings"]> = {
  about: "关于",
  advanced: "高级",
  askEachTime: "每次询问",
  colorScheme: "配色方案",
  dark: "暗色",
  debugModeDescription: "启用调试 coScene 的面板和功能",
  desktopApp: "桌面应用",
  displayTimestampsIn: "显示时间戳在",
  experimentalFeatures: "实验性功能",
  experimentalFeaturesDescription: "这些功能不稳定，不建议日常使用。",
  extensions: "扩展",
  followSystem: "跟随系统",
  general: "通用",
  language: "语言",
  layoutDebugging: "布局调试",
  layoutDebuggingDescription: "显示用于开发和调试布局存储的额外控件。",
  light: "亮色",
  noExperimentalFeatures: "目前没有实验性的功能。",
  openLinksIn: "打开链接",
  ros: "ROS",
  settings: "设置",
  timestampFormat: "时间戳格式",
  webApp: "网页应用",
  contact: "联系我们",
  legal: "法律",
  licenseTerms: "许可证条款",
  privacyPolicy: "隐私政策",
  termsOfService: "服务条款",
  security: "安全",
  updates: "自动更新",
  automaticallyInstallUpdates: "自动安装更新",
  tfCompatibilityMode: "TF 兼容模式",
  on: "开",
  off: "关",
  tfCompatibilityModeHelp:
    "启用此模式后，坐标系名称将删除 '/' 前缀，以兼容 tf2 的坐标系名称。 <Link>详细信息</Link>",
  inactivityTimeout: "实时可视化自动断连时长",
  inactivityTimeoutDescription: "设置实时可视化在页面无操作后的自动断连时长",
  seconds: "秒",
  minutes: "分钟",
  neverDisconnect: "永不断连",
  retentionWindowMs: "实时可视化缓存时长",
  noCache: "不缓存",
  retentionWindowNextEffectiveNotice: "设置已更新，将在下次连接时生效 <Link>立即重连</Link>",
  retentionWindowDescription: "缓存指定时间长度的数据，用于回放已播的实时数据",
  autoConnectToLan: "实时可视化自动连接局域网",
  autoConnectToLanDescription: "检测到与设备处于同一局域网时，自动连接局域网地址，无需手动确认",
  isRenderAllTabs: "渲染所有标签",
  isRenderAllTabsDescription:
    "是否渲染所有标签，包括未打开的标签, 开启后会提升标签页打开速度，但是会占用更多内存",
};
