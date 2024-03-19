// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const cosError: Partial<TypeOptions["resources"]["cosError"]> = {
  loginExpired: "登录已过期，请重新登录",
  getFilesFromLocalCacheError: "获取本地缓存文件失败",
  revisionIsNull: "未传入版本号",
  getFilesFromDpsError: "从 DPS 中获取文件列表失败",
  noFileToRead: "没有可读取的文件",
  illegalRequestTimestamp: "非法的请求时间段",
  illegalArgument: "非法参数",
  semanticLibError: "semanticLib 抛出异常",
  parseMediaFileFailed: "解析媒体文件失败",
  parseDataInterpretationFailed: "解析数据解释失败",
  blankAuthToken: "请求中的 auth token 为空",
  invalidToken: "无效的 token",
  permissionDenied: "没有权限执行验证操作",
  unknownAuthError: "未知的验证权限问题",
  generateMediaFailed: "生成媒体失败",
  useForAlwaysFail: "用于测试的接口，总是失败",
  unknownError: "未知错误",
  currentUrlNotSupported: "当前 URL 不支持",
  insecureWebSocketConnection: "不安全的 WebSocket 连接",
  insecureWebSocketConnectionMessage:
    "请检查 WebSocket 服务器 {{url}} 是否可访问，并且支持协议版本 {{version}}。",
  checkNetworkConnection: "请检查您正在使用的设备或机器人的网络状态。",
  checkFoxgloveBridge: "请检查您的机器人是否已安装了 <docLink>foxglove_bridge</docLink>",
  contactUs: "如果以上方法都无法解决问题，请联系我们。",
  connectionFailed: "连接失败",
};
