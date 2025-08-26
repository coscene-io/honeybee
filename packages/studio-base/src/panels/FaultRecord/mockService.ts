// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { StartRecordReq, StopRecordReq, CommonRsp } from "./types";

// Mock服务延迟时间（毫秒）
const MOCK_DELAY = 1000;

// 模拟网络延迟
const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// 模拟开始录制服务调用
export async function mockStartRecord(req: StartRecordReq): Promise<CommonRsp> {
  console.log("[Mock] 开始录制请求:", req);
  
  // 模拟网络延迟
  await delay(MOCK_DELAY);
  
  // 模拟成功响应
  const response: CommonRsp = {
    code: 0, // 0表示成功
    msg: `录制已开始 - Action: ${req.action_name}, 准备时长: ${req.preparation_duration_s}s, 录制时长: ${req.record_duration_s}s`,
  };
  
  console.log("[Mock] 开始录制响应:", response);
  return response;
}

// 模拟停止录制服务调用
export async function mockStopRecord(req: StopRecordReq): Promise<CommonRsp> {
  console.log("[Mock] 停止录制请求:", req);
  
  // 模拟网络延迟
  await delay(MOCK_DELAY);
  
  // 模拟成功响应
  const response: CommonRsp = {
    code: 0, // 0表示成功
    msg: `录制已停止 - Action: ${req.action_name}`,
  };
  
  
  console.log("[Mock] 停止录制响应:", response);
  return response;
}

// 模拟错误响应（用于测试错误处理）
export async function mockStartRecordWithError(req: StartRecordReq): Promise<CommonRsp> {
  console.log("[Mock] 开始录制请求（模拟错误）:", req);
  
  await delay(MOCK_DELAY);
  
  const response: CommonRsp = {
    code: 1, // 非0表示错误
    msg: "录制启动失败：设备忙碌",
  };
  
  console.log("[Mock] 开始录制响应（错误）:", response);
  return response;
}

export async function mockStopRecordWithError(req: StopRecordReq): Promise<CommonRsp> {
  console.log("[Mock] 停止录制请求（模拟错误）:", req);
  
  await delay(MOCK_DELAY);
  
  const response: CommonRsp = {
    code: 1, // 非0表示错误
    msg: "录制停止失败：未找到活动录制",
  };
  
  console.log("[Mock] 停止录制响应（错误）:", response);
  return response;
}

// 导出mock服务接口
export const mockService = {
  startRecord: mockStartRecord,
  stopRecord: mockStopRecord,
  startRecordWithError: mockStartRecordWithError,
  stopRecordWithError: mockStopRecordWithError,
};