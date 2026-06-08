// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const CoSceneErrors: { [key: number]: string } = {
  // semantic-lib 内部错误
  1000: "SEMANTIC_LIB_ERROR",

  // 从data platform 获取 jobrun 失败
  1100: "GET_JOBRUN_FROM_DPS",
  // 从data platform 获取 project 信息失败
  1101: "GET_PROJECT_FROM_DPS",
  // 从data platform 获取 Files 失败
  1102: "GET_FILES_FROM_DPS",
  // 从data platform 获取 record 失败
  1103: "GET_RECORD_FROM_DPS",

  // 非法时间戳
  1200: "ILLEGAL_REQUEST_TIMESTAMP",
  // 非法参数
  1201: "ILLEGAL_ARGUMENT",

  // 解析media buffer失败
  1300: "PARSE_MEDIA_BUFFER_FAILED",
  // 生成media失败
  1301: "GENERATE_MEDIA_FAILED",
  // 生成data interpretation失败
  1302: "GENERATE_DATA_INTERPRETATION_FAILED",
  // media 丢失, 正在异步生成, 稍后再试
  1303: "FILE_MEDIA_LOST",
  // 读取media文件失败
  1304: "READ_MEDIA_FILE_FAILED",

  // auth为空
  1400: "BLANK_AUTH_TOKEN",
  // token不合法
  1401: "INVALID_TOKEN",
  // token被拒绝
  1402: "TOKEN_PERMISSION_DENIED",
  // 未知Token错误
  1403: "UNKNOWN_AUTH_ERROR",

  // 从bff获取信息失败
  1500: "GET_RESPONSE_FROM_BFF",

  // 仅alwaysFail接口触发该error code
  9900: "USE_FOR_ALWAYS_FAIL",
  // 其他错误
  9901: "UNKNOWN_ERROR",
};
