// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const map: Partial<TypeOptions["resources"]["map"]> = {
  general: "通用",
  topics: "话题",
  enabled: "启用",
  coloring: "着色",
  automatic: "自动",
  custom: "自定义",
  color: "颜色",
  tileLayer: "瓦片图层",
  layerMap: "地图",
  satellite: "卫星",
  customMapTileUrl: "自定义地图瓦片 URL",
  maxTileLevel: "最大瓦片级别",
  maxTileLevelHelp:
    "自定义地图源支持的最高缩放级别。详见 https://leafletjs.com/examples/zoom-levels/",
  off: "关",
  followTopic: "跟随话题",
  invalidPlaceholder: "无效占位符 {{placeholder}}",
  waitingForFirstGpsPoint: "正在等待第一个 GPS 点…",
};
