// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const callService: Partial<TypeOptions["resources"]["callService"]> = {
  serviceName: "服务名称",
  layout: "布局",
  vertical: "垂直",
  horizontal: "水平",
  button: "按钮",
  title: "标题",
  tooltip: "提示",
  color: "颜色",
  serviceCannotBeEmpty: "服务不能为空",
  callServicePlaceholder: "调用服务 {{serviceName}}",
  connectToServiceSource: "请连接到支持调用服务的数据源",
  configureService: "请在面板设置中配置服务",
  requestMustBeObjectNotArray: "请求内容必须是对象，不能是数组",
  requestMustBeObjectNotNull: "请求内容必须是对象，不能为 null",
  requestMustBeObjectNotType: "请求内容必须是对象，不能是「{{type}}」",
  enterValidJsonRequest: "请输入有效的 JSON 请求内容",
  enterServiceRequestPlaceholder: "以 JSON 输入服务请求",
  dataSourceDoesNotAllowCallingServices: "当前数据源不允许调用服务",
  request: "请求",
  response: "响应",
  callingService: "正在调用 {{serviceName}}...",
};
