// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const cosWebsocket: Partial<TypeOptions["resources"]["cosWebsocket"]> = {
  websocketSSLError: "WebSocket SSL 错误",
  websocketSSLErrorDesc:
    '默认情况下，Chrome 阻止安全的 <code>https://</code> 页面连接到不安全的 <code>ws://</code> WebSocket 服务器。要允许连接，请为此页面启用 "不安全的脚本"。',
  websocketSSLErrorDesc2: '单击地址栏末尾的盾牌图标，然后单击 "加载不安全的脚本"。',
};
