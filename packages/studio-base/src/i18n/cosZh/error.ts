// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const cosError: Partial<TypeOptions["resources"]["cosError"]> = {
  loginExpired: "登录已过期，请重新登录",
  blankAuthToken: "请求中的 auth token 为空",
  currentUrlNotSupported: "当前 URL 不支持",
  insecureWebSocketConnection: "不安全的 WebSocket 连接",
  insecureWebSocketConnectionMessage:
    "请检查 WebSocket 服务器 {{url}} 是否可访问，并且支持协议版本 {{version}}。",
  checkNetworkConnection: "请检查您正在使用的设备或机器人的网络状态。",
  checkFoxgloveBridge: "请检查您的机器人是否已安装了 <docLink>coBridge</docLink>",
  contactUs: "如果以上方法都无法解决问题，请联系我们。",
  connectionFailed: "连接失败",
  inactivePage: "页面不活跃",
  inactivePageDescription: "页面已经不活跃很长时间，连接已断开。<btn>重新连接</btn>",
  repetitiveConnection: "重复的连接",
  repeatedConnectionDesc:
    "同一时间只能有一个人连接到同一个机器人。当前有用户正在连接，请稍后刷新并重试。",
  fileFormatUnsupported: "不支持当前文件格式",
  unauthorized: "暂无权限",

  SEMANTIC_LIB_ERROR: "semantic-lib 内部错误",
  GET_JOBRUN_FROM_DPS: "从data platform 获取 jobrun 失败",
  GET_PROJECT_FROM_DPS: "从data platform 获取 project 信息失败",
  GET_FILES_FROM_DPS: "从data platform 获取 Files 失败",
  GET_RECORD_FROM_DPS: "从data platform 获取 record 失败",
  ILLEGAL_REQUEST_TIMESTAMP: "非法时间戳",
  ILLEGAL_ARGUMENT: "非法参数",
  PARSE_MEDIA_BUFFER_FAILED: "解析media buffer失败",
  GENERATE_MEDIA_FAILED: "生成media失败",
  GENERATE_DATA_INTERPRETATION_FAILED: "生成data interpretation失败",
  FILE_MEDIA_LOST: "media 丢失, 正在异步生成, 稍后再试",
  READ_MEDIA_FILE_FAILED: "读取media文件失败",
  BLANK_AUTH_TOKEN: "auth为空",
  INVALID_TOKEN: "token不合法",
  TOKEN_PERMISSION_DENIED: "token被拒绝",
  UNKNOWN_AUTH_ERROR: "未知Token错误",
  GET_RESPONSE_FROM_BFF: "从bff获取信息失败",
  USE_FOR_ALWAYS_FAIL: "仅alwaysFail接口触发该error code",
  UNKNOWN_ERROR: "其他错误",
};
