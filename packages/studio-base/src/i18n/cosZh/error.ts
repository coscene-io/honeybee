// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const cosError: Partial<TypeOptions["resources"]["cosError"]> = {
  loginExpired: "登录已过期，请重新登录",
  getFilesFromLocalCacheError: "获取本地缓存文件失败",
  revisionIsNull: "未传入版本号",
  getFilesFromDpsError: "从DPS中获取文件列表失败",
  noFileToRead: "没有可读取的文件",
  illegalRequestTimestamp: "非法的请求时间段",
  illegalArgument: "非法参数",
  semanticLibError: "semanticLib抛出异常",
  parseMediaFileFailed: "解析媒体文件失败",
  parseDataInterpretationFailed: "解析数据解释失败",
  blankAuthToken: "请求中的auth token为空",
  invalidToken: "无效的token",
  permissionDenied: "没有权限执行验证操作",
  unknownAuthError: "未知的验证权限问题",
  generateMediaFailed: "生成媒体失败",
  useForAlwaysFail: "用于测试的接口，总是失败",
  unknownError: "未知错误",
  currentUrlNotSupported: "当前URL不支持",
};
