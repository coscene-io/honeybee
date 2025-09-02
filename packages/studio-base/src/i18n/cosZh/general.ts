// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const cosGeneral: Partial<TypeOptions["resources"]["cosGeneral"]> = {
  coScene: "coScene",
  apply: "使用",
  refresh: "刷新",
  name: "名称",
  cancel: "取消",
  delete: "删除",
  ok: "确定",
  search: "搜索",
  project: "项目",
  save: "保存",
  userGuide: "用户指引",
  done: "完成",
  seekBackward: "后退",
  pause: "暂停",
  play: "播放",
  seekForward: "前进",
  seekStep: "步长",
  loopPlayback: "循环播放",
  invalidSeekStep: "步长需大于 1e-9 秒且小于 1 小时，已重置为 0.1 秒。",
  playbackSpeed: "播放速度",
};
