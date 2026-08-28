// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const publish: Partial<TypeOptions["resources"]["publish"]> = {
  topic: "话题",
  messageSchema: "消息 schema",
  editingMode: "编辑模式",
  button: "按钮",
  title: "标题",
  tooltip: "提示",
  color: "颜色",
  topicCannotBeEmpty: "话题不能为空",
  messageSchemaCannotBeEmpty: "消息 schema 不能为空",
  schemaNameNotFound: "未找到 schema 名称",
  connectToPublishableSource: "请连接到支持发布的数据源",
  configureTopicAndSchema: "请在面板设置中配置话题和消息 schema",
  messageMustBeObjectNotArray: "消息内容必须是对象，不能是数组",
  messageMustBeObjectNotNull: "消息内容必须是对象，不能为 null",
  messageMustBeObjectNotType: "消息内容必须是对象，不能是「{{type}}」",
  enterValidJsonMessage: "请输入有效的 JSON 消息内容",
  enterMessageJsonPlaceholder: "以 JSON 输入消息内容",
};
