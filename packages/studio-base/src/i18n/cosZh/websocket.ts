// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const cosWebsocket: Partial<TypeOptions["resources"]["cosWebsocket"]> = {
  websocketSSLError: "WebSocket SSL 错误",
  websocketSSLErrorDesc:
    '默认情况下，Chrome 阻止安全的 <code>https://</code> 页面连接到不安全的 <code>ws://</code> WebSocket 服务器。要允许连接，请为此页面启用 "不安全的脚本"。',
  websocketSSLErrorDesc2: '单击地址栏末尾的盾牌图标，然后单击 "加载不安全的脚本"。',
  note: "注意",
  connectionOccupied:
    "当前设备<strong>{{deviceName}}</strong>的实时可视化正在被用户<strong>{{username}}</strong>使用，继续查看可能会影响他人。您确定要继续吗？",
  confirm: "继续",
  cancel: "取消",
  notification: "通知",
  vizIsTkenNow:
    "当前设备<strong>{{deviceName}}</strong>的实时可视化已被用户<strong>{{username}}</strong>接管，您已自动登出。",
  reconnetDesc: "如果需要，请重新连接。",
  reconnect: "重新连接",
  IKnow: "我知道了",
  vizIsDisconnected: "实时可视化已断开",
  inactivePageDescription:
    "页面已长达 {{time}} 分钟无操作，为节省流量消耗，实时可视化已自动断开连接。",
  exitAndClosePage: "退出并关闭页面",
  lanAvailable: "有局域网可用",
  lanConnectionPrompt: "检测到你与当前设备处于同一局域网，可使用局域网连接设备，提高网络速度",
  switchNow: "立即切换",
  keepCurrent: "保持现状",
};
