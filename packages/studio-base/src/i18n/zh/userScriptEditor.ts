// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const userScriptEditor: Partial<TypeOptions["resources"]["userScriptEditor"]> = {
  autoFormatOnSave: "保存时自动格式化",
  welcomeDescription:
    "欢迎使用用户脚本！<br/>可以先阅读<link>文档</link>，或者直接创建一个新的脚本。",
  newScript: "新建脚本",
  readonlySuffix: " （只读）",
  scriptNamePlaceholder: "脚本名称",
  goBack: "返回",
  scriptsTabTooltip: "脚本（{{count}}）",
  utilitiesTabTooltip: "工具",
  templatesTabTooltip: "模板",
  scriptsHeader: "脚本",
  untitledScript: "未命名脚本",
  rename: "重命名",
  delete: "删除",
  collapse: "收起",
  templatesHeader: "模板",
  templatesSubheader: "从这些模板创建脚本，点击任意模板即可生成新脚本。",
  utilitiesHeader: "工具",
  utilitiesSubheader:
    '可使用以下语法在脚本中导入任意模块：<pre>import { ... } from "./pointClouds.ts".</pre>',
  alertsTab: "警报",
  logsTab: "日志",
  clearLogs: "清空日志",
  saveShortcutHint: "Ctrl/Cmd + S",
  saved: "已保存",
  save: "保存",
  noAlerts: "暂无警报。",
  noLogs: "暂无日志。",
  invokeLogHint: "在节点代码中调用<code>log(someValue)</code>即可在此查看输出。",
  saveCurrentNode: "保存当前脚本",
  loadingEditor: "正在加载用户脚本编辑器",
};
