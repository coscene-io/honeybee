// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// 开始录制请求接口
export interface StartRecordReq {
  action_name: string;
  preparation_duration_s: number;
  record_duration_s: number;
}

// 停止录制请求接口
export interface StopRecordReq {
  action_name: string;
}

// 通用响应接口
export interface CommonRsp {
  code: number;
  msg: string;
}

// 录制状态
export type RecordingState = "idle" | "starting" | "recording" | "stopping";

// Action Name 配置
export interface ActionNameConfig {
  value: string;
  label: string;
}

// Action特定的duration配置
export interface ActionDurationConfig {
  preparationDuration: number;
  recordDuration: number;
}

// 面板状态
export interface PanelState {
  recordingState: RecordingState;
  selectedActionName: string;
  actionDurations: Record<string, ActionDurationConfig>; // Action特定的配置
  logs: LogLine[];
}

// 日志行
export interface LogLine {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
  type?: string;
}

// Action info returned by GetActionList service
export interface ActionInfo {
  mode: string;
  action_name: string;
  method?: string; // 触发方式说明，可选字段
  preparation_duration_s: number;
  record_duration_s: number;
  max_record_duration_s?: number; // 最大允许录制时长，可选字段
  topics: string[];
  is_enable: boolean;
  is_auto_upload: boolean;
}

// ROS服务接口已移除，不再使用
