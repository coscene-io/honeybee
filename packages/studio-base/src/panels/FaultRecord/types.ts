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
export type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping';

// Action Name 配置
export interface ActionNameConfig {
  value: string;
  label: string;
}

// 时长配置
export interface DurationConfig {
  preparation_duration_s: number;
  record_duration_s: number;
}

// 面板配置
export interface Config {
  actionNames: ActionNameConfig[];
  durations: DurationConfig;
  startRecordService: string;
  stopRecordService: string;
}

// 面板状态
export interface PanelState {
  recordingState: RecordingState;
  selectedActionName: string;
  preparationDuration: number;
  recordDuration: number;
  logs: LogLine[];
}

// 日志行
export interface LogLine {
  id: string;
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  type?: string;
}

// ROS服务接口
export interface RosService {
  startRecord(req: StartRecordReq): Promise<CommonRsp>;
  stopRecord(req: StopRecordReq): Promise<CommonRsp>;
  callService(serviceName: string, params: any): Promise<any>;
}

// Mock服务接口
export interface MockService {
  mockStartRecord(req: StartRecordReq): Promise<CommonRsp>;
  mockStopRecord(req: StopRecordReq): Promise<CommonRsp>;
}