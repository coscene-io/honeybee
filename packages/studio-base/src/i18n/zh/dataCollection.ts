// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const dataCollection: Partial<TypeOptions["resources"]["dataCollection"]> = {
  startCollection: "开始采集",
  endCollection: "结束采集",
  cancelCollection: "取消采集",
  requestDetails: "请求详情",
  collectionLog: "采集日志",
  connectToDataSource: "请先连接支持调用服务的数据源",
  configureService: "请先在面板设置中配置服务",
  dispatching: "分发中",
  startUpload: "开始上传",
  saveToRecord: "数据将保存到记录",
  progressLink: "进度链接",
  projectNameNotSet: "项目名称未设置",
  noPermissionToCreateTask: "您没有权限创建任务",
  endingCollection: "正在结束采集",
  cancellingCollection: "取消采集",
  unknownButtonType: "未知按钮类型",
  startCollectionSuccess: "开始采集成功",
  startCollectionFail: "开始采集失败",
  endCollectionSuccess: "结束采集成功",
  endCollectionFail: "结束采集失败",
  cancelCollectionSuccess: "取消采集成功",
  cancelCollectionFail: "取消采集失败",
  errorNoFilesMatched: "没有匹配的文件",
  checkFileDeleted: "检查文件是否已删除",
  fileUploaded: "文件上传完成",
  processing: "文件上传中",
  cancelled: "已取消",
  pleaseLoginToUseThisPanel: "请登录后使用此面板",
  loading: "加载中...",
  onlySupportRealTimeVisualization: "当前面板仅支持实时可视化",
  projectName: "项目名称",
  recordLabels: "记录标签",
  buttons: "按钮",
  showRequest: "显示请求",
  color: "颜色",
  serviceName: "服务名称",
  taskStatePending: "任务等待中",
  pendingUploadFiles: "待上传文件数",
  uploadFileFail: "上传文件失败",
  attemptedToPublishWithoutValidCoSceneWebSocketConnection:
    "尝试在没有有效的 coScene WebSocket 连接的情况下发布",
  triedToPublishOnTopicThatHasNotBeenAdvertisedBefore: "尝试在未被广告的主题 '{{topic}}' 上发布",
  autoLinkedTask: "已自动关联到任务",
  dataSaveLocation: "数据保存位置",
  autoLinkToTask: "自动关联到任务",
  clickTaskInPanel: "请在我的任务面板中点亮任务",
  clearTaskLink: "清空任务关联",
  taskLinkFailed: "任务关联失败",
};
