// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const cosGuide: Partial<TypeOptions["resources"]["cosGuide"]> = {
  playbackRecord: "播放记录",
  clickToStartPlaying: "点击开始播放",
  threeDeeView: "三维视图",
  threeDeeViewDesc: "展示激光点云，运动状态，地图等信息",
  liveVideo: "实时视频",
  liveVideoDesc: "展示摄像头信息",
  log: "日志",
  logDesc: "机器日志，实时滚动播放",
  planningInformation: "规划信息",
  planningInformationDesc: "地图与路径规划",
  dispatchSpeed: "下发速度",
  dispatchSpeedDesc: "机器速度曲线图",
  originalMessage: "原始消息",
  originalMessageDesc: "机器原始数据",
  createMoment: "创建一刻",
  createMomentDesc: "点击创建“一刻”，标记发生故障的关键帧",
  createMomentFormDesc: "在弹窗中填写一刻的名称、持续时间、描述等信息，即可完成一刻的创建",
  createTask: "创建任务",
  createTaskDesc:
    "在弹窗中填写任务的名称、描述、经办人等信息，即完成任务的创建；默认“经办人”为您自己",
  previousStep: "上一步",
  nextStep: "下一步",
  skipAll: "跳过全部",
};
