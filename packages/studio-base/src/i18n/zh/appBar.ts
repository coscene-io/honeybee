// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const appBar: Partial<TypeOptions["resources"]["appBar"]> = {
  about: "关于",
  addPanel: "添加面板",
  documentation: "文档",
  exploreSampleData: "探索样本数据",
  exportLayoutToFile: "导出布局到文件……",
  extensions: "扩展",
  file: "文件",
  help: "帮助",
  hideLeftSidebar: "隐藏左侧边栏",
  hideRightSidebar: "隐藏右侧边栏",
  importLayoutFromFile: "通过文件导入布局……",
  joinOurSlack: "加入我们的 Slack",
  joinSlackCommunity: "加入 Slack 社区",
  noDataSource: "没有数据源",
  open: "打开……",
  openConnection: "打开连接……",
  openLocalFile: "打开本地文件……",
  recentDataSources: "最近使用的数据源",
  settings: "设置",
  showLeftSidebar: "显示左侧边栏",
  showRightSidebar: "显示右侧边栏",
  signIn: "登录",
  signOut: "登出",
  unknown: "未知",
  userProfile: "用户资料",
  view: "查看",
  viewData: "查看数据",
  viewOurDocs: "查看我们的文档",
  profile: "个人资料",
  mediaGeneratingTips:
    "media 文件生成中，生成完成后刷新页面即可播放（{{successfulCount}}/{{totalCount}}）",
  mediaSuccessfulGeneration:
    "已将所有 media 文件生成，刷新页面即可播放全部文件 ({{count}}/{{count}})",
  mediaGenerationError: "存在 media 生成失败的文件，请删除对应文件后重试",
  loadingTips: "正在全速加载播放数据，请稍候...",
  layoutGuideliens: "新建「布局」自定义你的可视化视图，或直接使用组织共享布局",
  toSetupLayout: "前往设置布局",
  noMoreTips: "不再提示",
  loginSuccess: "登录成功",
  uploadTo: "上传到",
  uploadingFile: "文件上传中",
  uploadFileFailed: "上传文件失败",
  toCreateProject: "前往云端创建项目",
  createRecord: "创建记录",
  selectRecord: "选择现有记录",
  recordName: "记录名称",
  recordDescription: "记录描述",
  create: "创建",
  copyRecordLink: "复制记录链接",
  copyRecordLinkSuccess: "复制成功, 请在浏览器中打开",
  loginFirst: "上传文件需要先登录 coScene 账号",
  clickToUpload: "点击上传文件",
  openInBrowser: "在浏览器中打开",
  reUpload: "重新上传",
  createRecordAndUpload: "创建记录并上传",
  openInCoStudio: "在 coStudio 中打开",
  openInCoStudioPrompt:
    "将在 coStudio 中打开当前页面，请确认已经安装 coStudio，或者点击此处<download>下载</download>，并允许打开外部链接",
  openByCoStudio: "通过 coStudio 打开",
  doNotShowAgain: "不再提示",
  autoDisconnectionTips:
    "检测到长时间无操作，可视化即将自动断连，如需继续使用请保持活跃状态 {{time}}",
  networkConnection: "网络连接",
  localNetworkConnection: "局域网连接",
  colinkRemoteConnection: "coLink 远程连接",
};
